import { blendMastery, calculateDiagnosticScores, isRecommendationDue, matchesDiagnosticItemSet } from "./learning-loop";
import type { PlatformDatabase } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";
import { assertDiagnosticMedia } from "./diagnostic-media";
import type { ChoiceSnapshot } from "./diagnostic-types";
import { suggestIntervention } from "./intervention-support";
import { createFamilyPlan, exchangePartner, readFamilyPlan, readFamilyWorkSnapshot } from "./family-task";
import { assertSubmissionReviewAccess } from "./access-control";

type DiagnosticAnswerInput = { itemId: string; selectedOption: number; revision: number };
type RecommendationSource = "diagnostic" | "teacher" | "family" | "system";

const tomorrowIso = () => new Date(Date.now() + 86400000).toISOString();

export async function assertGuardianStudentAccess(db: PlatformDatabase, context: PlatformContext, studentUserId: string) {
  if (context.roles.includes("admin")) return;
  const link = await db.prepare(`SELECT id FROM guardian_student_links
    WHERE tenant_id=? AND guardian_user_id=? AND student_user_id=? AND status='active'`)
    .bind(context.tenantId, context.userId, studentUserId)
    .first();
  if (!link) throw new Error("forbidden");
}

export async function assertTeacherStudentAccess(db: PlatformDatabase, context: PlatformContext, studentUserId: string) {
  if (context.roles.includes("admin")) return;
  const enrollment = await db.prepare(`SELECT e.id FROM enrollments e
    JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id
    WHERE e.tenant_id=? AND e.student_user_id=? AND e.status='active' AND c.teacher_user_id=?`)
    .bind(context.tenantId, studentUserId, context.userId)
    .first();
  if (!enrollment) throw new Error("forbidden");
}

export async function updateMasteryEvidence(db: PlatformDatabase, input: {
  tenantId: string;
  studentUserId: string;
  objectiveId: string;
  score: number;
  evidenceCount?: number;
}) {
  const previous = await db.prepare(`SELECT mastery,evidence_count AS evidenceCount FROM mastery_snapshots
    WHERE tenant_id=? AND student_user_id=? AND objective_id=? ORDER BY id DESC LIMIT 1`)
    .bind(input.tenantId, input.studentUserId, input.objectiveId)
    .first<{ mastery: number; evidenceCount: number }>();
  const next = blendMastery(previous ? Number(previous.mastery) : null, Number(previous?.evidenceCount ?? 0), input.score, input.evidenceCount ?? 1);
  await db.prepare(`INSERT INTO mastery_snapshots (tenant_id,student_user_id,objective_id,mastery,evidence_count)
    VALUES (?,?,?,?,?)`)
    .bind(input.tenantId, input.studentUserId, input.objectiveId, next.mastery, next.evidenceCount)
    .run();
  return next;
}

export function prepareMasteryEvidenceInsert(db: PlatformDatabase, input: {
  tenantId: string;
  studentUserId: string;
  objectiveId: string;
  score: number;
  evidenceCount?: number;
}) {
  const score = Math.max(0, Math.min(1, input.score));
  const evidenceCount = Math.max(1, input.evidenceCount ?? 1);
  return db.prepare(`INSERT INTO mastery_snapshots
    (tenant_id,student_user_id,objective_id,mastery,evidence_count)
    SELECT ?,?,?,
      CASE WHEN latest.id IS NULL THEN ? ELSE ROUND(latest.mastery*0.7 + ?*0.3,4) END,
      COALESCE(latest.evidence_count,0)+?
    FROM (SELECT 1) seed
    LEFT JOIN (
      SELECT id,mastery,evidence_count FROM mastery_snapshots
      WHERE tenant_id=? AND student_user_id=? AND objective_id=?
      ORDER BY id DESC LIMIT 1
    ) latest ON 1=1`)
    .bind(
      input.tenantId, input.studentUserId, input.objectiveId,
      score, score, evidenceCount,
      input.tenantId, input.studentUserId, input.objectiveId,
    );
}

export async function submitDiagnostic(db: PlatformDatabase, context: PlatformContext, input: { id?: string; level: string; answers: DiagnosticAnswerInput[] }) {
  if (input.id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new Error("invalid_diagnostic_attempt_id");
  if (!input.answers.length || input.answers.length > 30) throw new Error("invalid_diagnostic_answers");
  const unique = new Map(input.answers.map((answer) => [answer.itemId, answer]));
  if (unique.size !== input.answers.length || [...unique.values()].some((answer) => !Number.isInteger(answer.selectedOption) || answer.selectedOption < 0 || answer.selectedOption > 3)) {
    throw new Error("invalid_diagnostic_answers");
  }
  const readExisting = async () => {
    if (!input.id) return null;
    const existing = await db.prepare("SELECT tenant_id AS tenantId,student_user_id AS studentUserId,level,score FROM diagnostic_attempts WHERE id=?")
      .bind(input.id).first<{ tenantId: string; studentUserId: string; level: string; score: number }>();
    if (!existing) return null;
    if (existing.tenantId !== context.tenantId || existing.studentUserId !== context.userId || existing.level !== input.level) throw new Error("diagnostic_attempt_id_conflict");
    const answers = await db.prepare(`SELECT item_id AS itemId,selected_option AS selectedOption,is_correct AS isCorrect,
        json_extract(evidence_json,'$.revision') AS revision,json_extract(evidence_json,'$.objectiveId') AS objectiveId
      FROM diagnostic_answers WHERE attempt_id=? AND tenant_id=?`)
      .bind(input.id, context.tenantId).all<{ itemId: string; selectedOption: number; isCorrect: number; revision: number; objectiveId: string }>();
    if (answers.results.length !== unique.size || answers.results.some((item) => unique.get(item.itemId)?.selectedOption !== item.selectedOption || unique.get(item.itemId)?.revision !== item.revision)) throw new Error("diagnostic_attempt_id_conflict");
    const evidence = answers.results.map((item) => ({ objectiveId: item.objectiveId, isCorrect: !!item.isCorrect }));
    return { attemptId: input.id, score: existing.score, objectiveScores: calculateDiagnosticScores(evidence), incorrectCount: evidence.filter((item) => !item.isCorrect).length };
  };
  // 响应丢失后按原请求读取快照，题库后续改版也不能把一次提交记成两份证据。
  const existing = await readExisting();
  if (existing) return existing;
  const rows = await db.prepare(`WITH ranked AS (
      SELECT id,objective_id,prompt,correct_option,options_json,ability,media_id,revision,
        ROW_NUMBER() OVER (ORDER BY sort_order,created_at,id) AS rn
      FROM diagnostic_items WHERE tenant_id=? AND level=? AND status='active'
    ) SELECT r.id,r.objective_id AS objectiveId,r.prompt,r.correct_option AS correctOption,
        r.options_json AS optionsJson,r.ability,r.media_id AS mediaId,lo.title AS objectiveTitle,r.revision
      FROM ranked r JOIN learning_objectives lo ON lo.id=r.objective_id AND lo.tenant_id=? WHERE rn<=30 ORDER BY rn`)
    .bind(context.tenantId, input.level, context.tenantId)
    .all<{ id: string; objectiveId: string; prompt: string; correctOption: number; optionsJson: string; ability: "listening" | "reading"; mediaId: string | null; objectiveTitle: string; revision: number }>();
  if (!rows.results.length || !matchesDiagnosticItemSet(rows.results.map((item) => item.id), [...unique.keys()])) {
    throw new Error("invalid_diagnostic_answers");
  }
  // 题目 ID 不变也可能换题面；按学生实际作答的版本核验，不能把旧选择套到新选项。
  if (rows.results.some((item) => unique.get(item.id)!.revision !== item.revision)) throw new Error("invalid_diagnostic_revision");

  const attemptId = input.id ?? crypto.randomUUID();
  const evidence = rows.results.map((item) => ({
    objectiveId: item.objectiveId,
    isCorrect: unique.get(item.id)!.selectedOption === Number(item.correctOption),
  }));
  const score = evidence.filter((item) => item.isCorrect).length / evidence.length;
  const objectiveScores = calculateDiagnosticScores(evidence);
  const incorrectCount = evidence.filter((item) => !item.isCorrect).length;
  try {
    await db.batch([
      db.prepare(`INSERT INTO diagnostic_attempts (id,tenant_id,student_user_id,level,score,status)
        VALUES (?,?,?,?,?,'completed')`).bind(attemptId, context.tenantId, context.userId, input.level, score),
      ...rows.results.map((item) => {
        const selectedOption = unique.get(item.id)!.selectedOption;
        const snapshot: ChoiceSnapshot = { version: 1, revision: item.revision, ability: item.ability, objectiveId: item.objectiveId, objectiveTitle: item.objectiveTitle,
          prompt: item.prompt, options: JSON.parse(item.optionsJson), correctOption: Number(item.correctOption), mediaId: item.mediaId };
        return db.prepare(`INSERT INTO diagnostic_answers (id,tenant_id,attempt_id,item_id,selected_option,is_correct,evidence_json)
          VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), context.tenantId, attemptId, item.id, selectedOption, selectedOption === Number(item.correctOption) ? 1 : 0, JSON.stringify(snapshot));
      }),
      ...Object.entries(objectiveScores).map(([objectiveId, result]) => prepareMasteryEvidenceInsert(db, {
        tenantId: context.tenantId,
        studentUserId: context.userId,
        objectiveId,
        score: result.score,
        evidenceCount: result.evidenceCount,
      })),
      ...rows.results.filter((row) => unique.get(row.id)!.selectedOption !== Number(row.correctOption)).map((item) => db.prepare(`INSERT INTO learning_recommendations
        (id,tenant_id,student_user_id,objective_id,source_type,source_id,title,detail,due_at,status,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,'pending',?)
        ON CONFLICT(tenant_id,student_user_id,source_type,source_id)
        DO UPDATE SET objective_id=excluded.objective_id,title=excluded.title,detail=excluded.detail,status='pending',due_at=excluded.due_at,completed_at=NULL`)
        .bind(crypto.randomUUID(), context.tenantId, context.userId, item.objectiveId, "diagnostic", item.id, `错题复习：${item.prompt.slice(0, 60)}`, "重新作答诊断错题，答对后完成。", new Date().toISOString(), context.userId)),
      db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,'diagnostic.completed','diagnostic_attempt',?,?)")
        .bind(crypto.randomUUID(), context.tenantId, context.userId, attemptId, JSON.stringify({ score, incorrectCount })),
    ]);
  } catch (error) {
    const saved = await readExisting();
    if (saved) return saved;
    throw error;
  }
  return { attemptId, score, objectiveScores, incorrectCount };
}

export async function answerReviewItem(db: PlatformDatabase, context: PlatformContext, input: { recommendationId: string; selectedOption: number; revision?: number }) {
  if (!Number.isInteger(input.selectedOption) || input.selectedOption < 0 || input.selectedOption > 3) throw new Error("invalid_selected_option");
  const row = await db.prepare(`SELECT lr.id,lr.objective_id AS objectiveId,lr.due_at AS dueAt,di.correct_option AS correctOption,
      di.objective_id AS itemObjectiveId,di.revision,di.id AS itemId
    FROM learning_recommendations lr
    JOIN diagnostic_items di ON di.id=lr.source_id AND di.tenant_id=lr.tenant_id
    WHERE lr.id=? AND lr.tenant_id=? AND lr.student_user_id=? AND lr.source_type='diagnostic' AND lr.status='pending'`)
    .bind(input.recommendationId, context.tenantId, context.userId)
    .first<{ id: string; objectiveId: string; dueAt: string | null; correctOption: number; itemObjectiveId: string; revision: number; itemId: string }>();
  if (!row) throw new Error("review_item_not_found");
  if (!isRecommendationDue(row.dueAt)) throw new Error("review_not_due");
  if (!Number.isInteger(input.revision) || input.revision !== row.revision || row.objectiveId !== row.itemObjectiveId) throw new Error("review_item_changed");
  const correct = input.selectedOption === Number(row.correctOption);
  const nextDueAt = correct ? null : tomorrowIso();
  const updated = await db.prepare(`UPDATE learning_recommendations
    SET status=?,due_at=?,completed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id=? AND tenant_id=? AND student_user_id=? AND status='pending' AND due_at IS ?
      AND EXISTS (SELECT 1 FROM diagnostic_items di WHERE di.id=? AND di.tenant_id=learning_recommendations.tenant_id
        AND di.revision=? AND di.objective_id=learning_recommendations.objective_id)`)
    .bind(correct ? "completed" : "pending", nextDueAt, correct ? 1 : 0, row.id, context.tenantId, context.userId, row.dueAt, row.itemId, row.revision)
    .run();
  if (!updated.meta.changes) throw new Error("review_item_changed");
  await updateMasteryEvidence(db, {
    tenantId: context.tenantId,
    studentUserId: context.userId,
    objectiveId: row.objectiveId,
    score: correct ? 1 : 0,
  });
  return { id: row.id, correct, status: correct ? "completed" : "pending", dueAt: nextDueAt };
}

async function createRecommendation(db: PlatformDatabase, input: {
  tenantId: string;
  studentUserId: string;
  objectiveId?: string | null;
  sourceType: RecommendationSource;
  title: string;
  detail: string;
  dueAt?: string | null;
  createdBy: string;
}) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO learning_recommendations
    (id,tenant_id,student_user_id,objective_id,source_type,source_id,title,detail,due_at,status,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?)`)
    .bind(id, input.tenantId, input.studentUserId, input.objectiveId ?? null, input.sourceType, id, input.title, input.detail, input.dueAt ?? null, input.createdBy)
    .run();
  return id;
}

export async function createIntervention(db: PlatformDatabase, context: PlatformContext, input: {
  studentUserId: string;
  objectiveId: string;
  title: string;
  detail: string;
  dueAt?: string | null;
  evidenceKey?: string;
}) {
  await assertTeacherStudentAccess(db, context, input.studentUserId);
  const objective = await db.prepare("SELECT id FROM learning_objectives WHERE id=? AND tenant_id=? AND status='active'")
    .bind(input.objectiveId, context.tenantId).first();
  if (!objective) throw new Error("objective_not_found");
  if (input.evidenceKey !== undefined) {
    if (!input.detail.trim()) throw new Error("invalid_intervention_detail");
    const suggestion = await suggestIntervention(context, input.studentUserId, input.objectiveId);
    if (!suggestion.ready || input.evidenceKey !== suggestion.evidenceKey) throw new Error("support_evidence_changed");
    const sourceId = `support:${context.userId}:${suggestion.evidenceKey}`;
    const result = await db.prepare(`INSERT INTO learning_recommendations
      (id,tenant_id,student_user_id,objective_id,source_type,source_id,title,detail,due_at,status,created_by)
      VALUES (?,?,?,?,'teacher',?,?,?,?,'pending',?)
      ON CONFLICT(tenant_id,student_user_id,source_type,source_id) DO NOTHING`)
      .bind(crypto.randomUUID(), context.tenantId, input.studentUserId, input.objectiveId, sourceId, input.title,
        `${input.detail}\n\n【教师确认的选择依据】\n${suggestion.rationale}`, input.dueAt ?? null, context.userId).run();
    const saved = await db.prepare(`SELECT id,status FROM learning_recommendations
      WHERE tenant_id=? AND student_user_id=? AND source_type='teacher' AND source_id=?`)
      .bind(context.tenantId, input.studentUserId, sourceId).first<{ id: string; status: string }>();
    if (!saved) throw new Error("intervention_save_failed");
    return { ...saved, created: !!result.meta.changes };
  }
  const id = await createRecommendation(db, { tenantId: context.tenantId, studentUserId: input.studentUserId, objectiveId: input.objectiveId, sourceType: "teacher", title: input.title, detail: input.detail, dueAt: input.dueAt, createdBy: context.userId });
  return { id, status: "pending" };
}

export async function createFamilyTask(db: PlatformDatabase, context: PlatformContext, input: {
  studentUserId: string;
  assignmentId: string;
  objectiveId: string;
  title: string;
  detail: string;
  dueAt?: string | null;
  templateId?: string;
  partner?: string;
}) {
  await assertGuardianStudentAccess(db, context, input.studentUserId);
  await assertFamilyAssignment(db, context, input);
  const plan = createFamilyPlan(input.templateId, input.partner);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO learning_recommendations
      (id,tenant_id,student_user_id,objective_id,assignment_id,source_type,source_id,title,detail,due_at,status,created_by,family_plan_json)
      VALUES (?,?,?,?,?,'family',?,?,?,?,'pending',?,?)`)
      .bind(id, context.tenantId, input.studentUserId, input.objectiveId, input.assignmentId, id, input.title, input.detail, input.dueAt ?? null, context.userId, JSON.stringify(plan)),
    db.prepare(`INSERT INTO notifications (id,tenant_id,user_id,title,detail,kind,scheduled_for)
      VALUES (?,?,?,?,?,'family_task',?)`)
      .bind(crypto.randomUUID(), context.tenantId, input.studentUserId, input.title, input.detail, input.dueAt ?? null),
  ]);
  return { id, status: "pending" };
}

async function assertFamilyAssignment(db: PlatformDatabase, context: PlatformContext, input: { studentUserId: string; assignmentId: string; objectiveId: string }) {
  const assignment = await db.prepare(`SELECT a.id FROM assignments a
    JOIN assignment_objectives ao ON ao.tenant_id=a.tenant_id AND ao.assignment_id=a.id AND ao.objective_id=?
    JOIN learning_objectives lo ON lo.tenant_id=ao.tenant_id AND lo.id=ao.objective_id AND lo.status='active'
    WHERE a.id=? AND a.tenant_id=? AND a.status='published'
      AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=a.tenant_id AND e.class_id=a.class_id AND e.student_user_id=? AND e.status='active')`)
    .bind(input.objectiveId, input.assignmentId, context.tenantId, input.studentUserId).first();
  if (!assignment) throw new Error("invalid_family_assignment");
}

async function ownedFamilyTask(db: PlatformDatabase, context: PlatformContext, id: string) {
  const row = await db.prepare(`SELECT id,student_user_id AS studentUserId,created_by AS createdBy,family_plan_json AS familyPlanJson
    FROM learning_recommendations
    WHERE id=? AND tenant_id=? AND source_type='family' AND archived_at IS NULL`)
    .bind(id, context.tenantId)
    .first<{ id: string; studentUserId: string; createdBy: string; familyPlanJson: string }>();
  if (!row) throw new Error("family_task_not_found");
  if (!context.roles.includes("admin") && row.createdBy !== context.userId) throw new Error("forbidden");
  await assertGuardianStudentAccess(db, context, row.studentUserId);
  return row;
}

export async function updateFamilyTask(db: PlatformDatabase, context: PlatformContext, input: {
  id: string;
  assignmentId: string;
  objectiveId: string;
  title: string;
  detail: string;
  dueAt?: string | null;
  templateId?: string;
  partner?: string;
  revision?: number;
}) {
  const task = await ownedFamilyTask(db, context, input.id);
  await assertFamilyAssignment(db, context, { ...input, studentUserId: task.studentUserId });
  const previous = readFamilyPlan(task.familyPlanJson);
  if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 0)) throw new Error("invalid_family_revision");
  if (input.revision !== undefined && input.revision !== (previous?.revision ?? 0)) throw new Error("family_task_changed");
  const basePlan = input.templateId === undefined ? previous ?? createFamilyPlan() : createFamilyPlan(input.templateId, input.partner ?? previous?.partner);
  const plan = { ...basePlan, partner: exchangePartner(input.partner ?? basePlan.partner), revision: (previous?.revision ?? 0) + 1 };
  const result = await db.prepare(`UPDATE learning_recommendations
    SET title=?,detail=?,due_at=?,assignment_id=?,objective_id=?,family_plan_json=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND source_type='family' AND archived_at IS NULL AND family_plan_json=?
      AND ((assignment_id IS ? AND objective_id IS ?)
        OR NOT EXISTS (SELECT 1 FROM submissions s WHERE s.tenant_id=? AND s.family_task_id=?))`)
    .bind(input.title, input.detail, input.dueAt ?? null, input.assignmentId, input.objectiveId, JSON.stringify(plan), input.id, context.tenantId, task.familyPlanJson,
      input.assignmentId, input.objectiveId, context.tenantId, input.id)
    .run();
  if (!result.meta.changes) {
    const latest = await ownedFamilyTask(db, context, input.id);
    throw new Error(latest.familyPlanJson !== task.familyPlanJson ? "family_task_changed" : "family_task_has_submissions");
  }
  return { id: input.id, status: "updated" };
}

export async function confirmFamilySubmission(db: PlatformDatabase, context: PlatformContext, input: { submissionId: string; helpLevel: string }, teacherWitness = false) {
  if (!["independent", "prompted", "assisted"].includes(input.helpLevel)) throw new Error("invalid_family_help_level");
  const submission = await db.prepare(`SELECT s.student_user_id AS studentUserId,s.family_snapshot_json AS familySnapshotJson FROM submissions s
    JOIN learning_recommendations lr ON lr.tenant_id=s.tenant_id AND lr.id=s.family_task_id AND lr.source_type='family'
    WHERE s.id=? AND s.tenant_id=? AND lr.archived_at IS NULL`)
    .bind(input.submissionId, context.tenantId).first<{ studentUserId: string; familySnapshotJson: string }>();
  if (!submission) throw new Error("submission_not_found");
  if (teacherWitness) {
    await assertSubmissionReviewAccess(db, context, input.submissionId);
    const snapshot = readFamilyWorkSnapshot(submission.familySnapshotJson);
    if (!snapshot || snapshot.partner === "family") throw new Error("family_confirmation_required");
  } else await assertGuardianStudentAccess(db, context, submission.studentUserId);
  const result = await db.prepare(`UPDATE submissions SET family_help_level=?,family_confirmed_at=CURRENT_TIMESTAMP,family_confirmed_by=?,family_confirmation_role=?
    WHERE id=? AND tenant_id=? AND review_status!='reviewed'`)
    .bind(input.helpLevel, context.userId, teacherWitness ? "teacher" : "guardian", input.submissionId, context.tenantId).run();
  if (!result.meta.changes) throw new Error("submission_already_reviewed");
  return { submissionId: input.submissionId, helpLevel: input.helpLevel };
}

export async function archiveFamilyTask(db: PlatformDatabase, context: PlatformContext, id: string) {
  await ownedFamilyTask(db, context, id);
  // 与提交时的活动任务条件共同保证：并发归档不会留下无法确认或评分的作品。
  const result = await db.prepare(`UPDATE learning_recommendations
    SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND source_type='family' AND archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.tenant_id=? AND s.family_task_id=? AND s.review_status!='reviewed')`)
    .bind(id, context.tenantId, context.tenantId, id)
    .run();
  if (!result.meta.changes) throw new Error("family_submission_pending");
  return { id, status: "archived" };
}

export async function updateRecommendationStatus(db: PlatformDatabase, context: PlatformContext, input: { id: string; status: "pending" | "completed" }) {
  const row = await db.prepare(`SELECT id,student_user_id AS studentUserId,source_type AS sourceType,created_by AS createdBy
    FROM learning_recommendations WHERE id=? AND tenant_id=? AND archived_at IS NULL`)
    .bind(input.id, context.tenantId)
    .first<{ id: string; studentUserId: string; sourceType: RecommendationSource; createdBy: string }>();
  if (!row) throw new Error("recommendation_not_found");
  // 家长确认交流不等于语言能力达标；家庭任务由作品的教师评价完成。
  if (row.sourceType === "family" && input.status === "completed") throw new Error("family_review_required");
  if (!context.roles.includes("admin")) {
    if (context.roles.includes("student") && row.studentUserId === context.userId && row.sourceType !== "diagnostic" && row.sourceType !== "family") {
      // Diagnostic recommendations can only be completed by answering the review item.
    } else if (context.roles.includes("guardian") && row.sourceType === "family") {
      await assertGuardianStudentAccess(db, context, row.studentUserId);
    } else if (context.roles.includes("teacher") && row.sourceType === "teacher" && row.createdBy === context.userId) {
      await assertTeacherStudentAccess(db, context, row.studentUserId);
    } else {
      throw new Error("forbidden");
    }
  }
  await db.prepare(`UPDATE learning_recommendations SET status=?,updated_at=CURRENT_TIMESTAMP,
    completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id=? AND tenant_id=?`)
    .bind(input.status, input.status, input.id, context.tenantId).run();
  return { id: input.id, status: input.status };
}

export async function setClassEnrollments(db: PlatformDatabase, context: PlatformContext, input: { classId: string; studentUserIds: string[] }) {
  const uniqueStudents = [...new Set(input.studentUserIds)].filter(Boolean);
  const classRow = await db.prepare("SELECT id FROM classes WHERE id=? AND tenant_id=?").bind(input.classId, context.tenantId).first();
  if (!classRow) throw new Error("class_not_found");
  if (uniqueStudents.length) {
    const placeholders = uniqueStudents.map(() => "?").join(",");
    const students = await db.prepare(`SELECT DISTINCT rm.user_id AS userId FROM role_memberships rm
      JOIN users u ON u.id=rm.user_id AND u.status='active'
      WHERE rm.tenant_id=? AND rm.role='student' AND rm.status='active' AND rm.user_id IN (${placeholders})`)
      .bind(context.tenantId, ...uniqueStudents).all<{ userId: string }>();
    if (students.results.length !== uniqueStudents.length) throw new Error("invalid_student_ids");
  }
  await db.batch([
    db.prepare("UPDATE enrollments SET status='disabled' WHERE tenant_id=? AND class_id=?").bind(context.tenantId, input.classId),
    ...uniqueStudents.map((studentUserId) => db.prepare(`INSERT INTO enrollments (tenant_id,class_id,student_user_id,status)
      VALUES (?,?,?,'active') ON CONFLICT(tenant_id,class_id,student_user_id) DO UPDATE SET status='active'`)
      .bind(context.tenantId, input.classId, studentUserId)),
  ]);
  return { classId: input.classId, studentUserIds: uniqueStudents };
}

export async function upsertLearningObjective(db: PlatformDatabase, context: PlatformContext, input: {
  id?: string;
  code: string;
  title: string;
  skill: string;
  level: string;
  status: "active" | "inactive";
}) {
  if (input.id) {
    const existing = await db.prepare("SELECT id FROM learning_objectives WHERE id=? AND tenant_id=?").bind(input.id, context.tenantId).first();
    if (!existing) throw new Error("objective_not_found");
  }
  const id = input.id || crypto.randomUUID();
  await db.prepare(`INSERT INTO learning_objectives (id,tenant_id,code,title,skill,level,status)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET code=excluded.code,title=excluded.title,skill=excluded.skill,
      level=excluded.level,status=excluded.status WHERE tenant_id=excluded.tenant_id`)
    .bind(id, context.tenantId, input.code, input.title, input.skill, input.level, input.status)
    .run();
  return { ...input, id };
}

export async function upsertDiagnosticItem(db: PlatformDatabase, context: PlatformContext, input: {
  id?: string;
  objectiveId: string;
  level: string;
  prompt: string;
  options: string[];
  correctOption: number;
  explanation: string;
  status: "active" | "inactive";
  ability?: string;
  mediaId?: string | null;
}) {
  const ability = input.ability ?? "reading";
  if (ability !== "reading" && ability !== "listening") throw new Error("invalid_diagnostic_ability");
  if (ability === "listening" && !input.mediaId) throw new Error("invalid_diagnostic_media");
  if (input.mediaId) await assertDiagnosticMedia(context, input.mediaId, "audio");
  if (input.options.length !== 4 || input.options.some((option) => !option.trim()) || new Set(input.options.map((option) => option.trim())).size !== 4) throw new Error("invalid_diagnostic_options");
  if (!Number.isInteger(input.correctOption) || input.correctOption < 0 || input.correctOption > 3) throw new Error("invalid_correct_option");
  const objective = await db.prepare("SELECT id FROM learning_objectives WHERE id=? AND tenant_id=?")
    .bind(input.objectiveId, context.tenantId).first();
  if (!objective) throw new Error("objective_not_found");
  if (input.id) {
    const existing = await db.prepare("SELECT id FROM diagnostic_items WHERE id=? AND tenant_id=?").bind(input.id, context.tenantId).first();
    if (!existing) throw new Error("diagnostic_item_not_found");
  }
  const id = input.id || crypto.randomUUID();
  await db.prepare(`INSERT INTO diagnostic_items
    (id,tenant_id,objective_id,level,prompt,options_json,correct_option,explanation,status,created_by,ability,media_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET objective_id=excluded.objective_id,level=excluded.level,prompt=excluded.prompt,
      options_json=excluded.options_json,correct_option=excluded.correct_option,explanation=excluded.explanation,
      status=excluded.status,ability=excluded.ability,media_id=excluded.media_id,revision=diagnostic_items.revision+1 WHERE tenant_id=excluded.tenant_id`)
    .bind(id, context.tenantId, input.objectiveId, input.level, input.prompt, JSON.stringify(input.options.map((option) => option.trim())), input.correctOption, input.explanation, input.status, context.userId, ability, ability === "listening" ? input.mediaId : null)
    .run();
  return { ...input, id };
}
