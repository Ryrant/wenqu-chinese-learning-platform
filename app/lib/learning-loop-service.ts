import { blendMastery, calculateDiagnosticScores, isRecommendationDue, matchesDiagnosticItemSet } from "./learning-loop";
import type { PlatformContext } from "./platform-store";

type DiagnosticAnswerInput = { itemId: string; selectedOption: number };
type RecommendationSource = "diagnostic" | "teacher" | "family" | "system";

const tomorrowIso = () => new Date(Date.now() + 86400000).toISOString();

export async function assertGuardianStudentAccess(db: D1Database, context: PlatformContext, studentUserId: string) {
  if (context.roles.includes("admin")) return;
  const link = await db.prepare(`SELECT id FROM guardian_student_links
    WHERE tenant_id=? AND guardian_user_id=? AND student_user_id=? AND status='active'`)
    .bind(context.tenantId, context.userId, studentUserId)
    .first();
  if (!link) throw new Error("forbidden");
}

export async function assertTeacherStudentAccess(db: D1Database, context: PlatformContext, studentUserId: string) {
  if (context.roles.includes("admin")) return;
  const enrollment = await db.prepare(`SELECT e.id FROM enrollments e
    JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id
    WHERE e.tenant_id=? AND e.student_user_id=? AND e.status='active' AND c.teacher_user_id=?`)
    .bind(context.tenantId, studentUserId, context.userId)
    .first();
  if (!enrollment) throw new Error("forbidden");
}

export async function updateMasteryEvidence(db: D1Database, input: {
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

export async function submitDiagnostic(db: D1Database, context: PlatformContext, input: { level: string; answers: DiagnosticAnswerInput[] }) {
  if (!input.answers.length || input.answers.length > 30) throw new Error("invalid_diagnostic_answers");
  const unique = new Map(input.answers.map((answer) => [answer.itemId, answer]));
  if (unique.size !== input.answers.length || [...unique.values()].some((answer) => !Number.isInteger(answer.selectedOption) || answer.selectedOption < 0 || answer.selectedOption > 3)) {
    throw new Error("invalid_diagnostic_answers");
  }
  const rows = await db.prepare(`SELECT id,objective_id AS objectiveId,prompt,correct_option AS correctOption
    FROM diagnostic_items WHERE tenant_id=? AND level=? AND status='active'
    ORDER BY sort_order,created_at,id`)
    .bind(context.tenantId, input.level)
    .all<{ id: string; objectiveId: string; prompt: string; correctOption: number }>();
  if (!rows.results.length || !matchesDiagnosticItemSet(rows.results.map((item) => item.id), [...unique.keys()])) {
    throw new Error("invalid_diagnostic_answers");
  }

  const attemptId = crypto.randomUUID();
  const evidence = rows.results.map((item) => ({
    objectiveId: item.objectiveId,
    isCorrect: unique.get(item.id)!.selectedOption === Number(item.correctOption),
  }));
  const score = evidence.filter((item) => item.isCorrect).length / evidence.length;
  await db.batch([
    db.prepare(`INSERT INTO diagnostic_attempts (id,tenant_id,student_user_id,level,score,status)
      VALUES (?,?,?,?,?,'completed')`).bind(attemptId, context.tenantId, context.userId, input.level, score),
    ...rows.results.map((item) => {
      const selectedOption = unique.get(item.id)!.selectedOption;
      return db.prepare(`INSERT INTO diagnostic_answers (id,tenant_id,attempt_id,item_id,selected_option,is_correct)
        VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), context.tenantId, attemptId, item.id, selectedOption, selectedOption === Number(item.correctOption) ? 1 : 0);
    }),
  ]);

  const objectiveScores = calculateDiagnosticScores(evidence);
  for (const [objectiveId, result] of Object.entries(objectiveScores)) {
    await updateMasteryEvidence(db, {
      tenantId: context.tenantId,
      studentUserId: context.userId,
      objectiveId,
      score: result.score,
      evidenceCount: result.evidenceCount,
    });
  }
  for (const item of rows.results.filter((row) => unique.get(row.id)!.selectedOption !== Number(row.correctOption))) {
    await db.prepare(`INSERT INTO learning_recommendations
      (id,tenant_id,student_user_id,objective_id,source_type,source_id,title,detail,due_at,status,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,'pending',?)
      ON CONFLICT(tenant_id,student_user_id,source_type,source_id)
      DO UPDATE SET status='pending',due_at=excluded.due_at,completed_at=NULL`)
      .bind(crypto.randomUUID(), context.tenantId, context.userId, item.objectiveId, "diagnostic", item.id, `错题复习：${item.prompt.slice(0, 60)}`, "重新作答诊断错题，答对后完成。", new Date().toISOString(), context.userId)
      .run();
  }
  return { attemptId, score, objectiveScores, incorrectCount: evidence.filter((item) => !item.isCorrect).length };
}

export async function answerReviewItem(db: D1Database, context: PlatformContext, input: { recommendationId: string; selectedOption: number }) {
  if (!Number.isInteger(input.selectedOption) || input.selectedOption < 0 || input.selectedOption > 3) throw new Error("invalid_selected_option");
  const row = await db.prepare(`SELECT lr.id,lr.objective_id AS objectiveId,lr.due_at AS dueAt,di.correct_option AS correctOption
    FROM learning_recommendations lr
    JOIN diagnostic_items di ON di.id=lr.source_id AND di.tenant_id=lr.tenant_id
    WHERE lr.id=? AND lr.tenant_id=? AND lr.student_user_id=? AND lr.source_type='diagnostic' AND lr.status='pending'`)
    .bind(input.recommendationId, context.tenantId, context.userId)
    .first<{ id: string; objectiveId: string; dueAt: string | null; correctOption: number }>();
  if (!row) throw new Error("review_item_not_found");
  if (!isRecommendationDue(row.dueAt)) throw new Error("review_not_due");
  const correct = input.selectedOption === Number(row.correctOption);
  const nextDueAt = correct ? null : tomorrowIso();
  await db.prepare(`UPDATE learning_recommendations
    SET status=?,due_at=?,completed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id=? AND tenant_id=? AND student_user_id=?`)
    .bind(correct ? "completed" : "pending", nextDueAt, correct ? 1 : 0, row.id, context.tenantId, context.userId)
    .run();
  await updateMasteryEvidence(db, {
    tenantId: context.tenantId,
    studentUserId: context.userId,
    objectiveId: row.objectiveId,
    score: correct ? 1 : 0,
  });
  return { id: row.id, correct, status: correct ? "completed" : "pending", dueAt: nextDueAt };
}

async function createRecommendation(db: D1Database, input: {
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

export async function createIntervention(db: D1Database, context: PlatformContext, input: {
  studentUserId: string;
  objectiveId: string;
  title: string;
  detail: string;
  dueAt?: string | null;
}) {
  await assertTeacherStudentAccess(db, context, input.studentUserId);
  const objective = await db.prepare("SELECT id FROM learning_objectives WHERE id=? AND tenant_id=? AND status='active'")
    .bind(input.objectiveId, context.tenantId).first();
  if (!objective) throw new Error("objective_not_found");
  const id = await createRecommendation(db, { tenantId: context.tenantId, studentUserId: input.studentUserId, objectiveId: input.objectiveId, sourceType: "teacher", title: input.title, detail: input.detail, dueAt: input.dueAt, createdBy: context.userId });
  return { id, status: "pending" };
}

export async function createFamilyTask(db: D1Database, context: PlatformContext, input: {
  studentUserId: string;
  title: string;
  detail: string;
  dueAt?: string | null;
}) {
  await assertGuardianStudentAccess(db, context, input.studentUserId);
  const id = await createRecommendation(db, { tenantId: context.tenantId, studentUserId: input.studentUserId, sourceType: "family", title: input.title, detail: input.detail, dueAt: input.dueAt, createdBy: context.userId });
  await db.prepare(`INSERT INTO notifications (id,tenant_id,user_id,title,detail,kind,scheduled_for)
    VALUES (?,?,?,?,?,'family_task',?)`)
    .bind(crypto.randomUUID(), context.tenantId, input.studentUserId, input.title, input.detail, input.dueAt ?? null)
    .run();
  return { id, status: "pending" };
}

export async function updateRecommendationStatus(db: D1Database, context: PlatformContext, input: { id: string; status: "pending" | "completed" }) {
  const row = await db.prepare(`SELECT id,student_user_id AS studentUserId,source_type AS sourceType,created_by AS createdBy
    FROM learning_recommendations WHERE id=? AND tenant_id=?`)
    .bind(input.id, context.tenantId)
    .first<{ id: string; studentUserId: string; sourceType: RecommendationSource; createdBy: string }>();
  if (!row) throw new Error("recommendation_not_found");
  if (!context.roles.includes("admin")) {
    if (context.roles.includes("student") && row.studentUserId === context.userId && row.sourceType !== "diagnostic") {
      // Diagnostic recommendations can only be completed by answering the review item.
    } else if (context.roles.includes("guardian") && row.sourceType === "family") {
      await assertGuardianStudentAccess(db, context, row.studentUserId);
    } else if (context.roles.includes("teacher") && row.sourceType === "teacher" && row.createdBy === context.userId) {
      await assertTeacherStudentAccess(db, context, row.studentUserId);
    } else {
      throw new Error("forbidden");
    }
  }
  await db.prepare(`UPDATE learning_recommendations SET status=?,
    completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id=? AND tenant_id=?`)
    .bind(input.status, input.status, input.id, context.tenantId).run();
  return { id: input.id, status: input.status };
}

export async function setClassEnrollments(db: D1Database, context: PlatformContext, input: { classId: string; studentUserIds: string[] }) {
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

export async function upsertLearningObjective(db: D1Database, context: PlatformContext, input: {
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
  return { id, ...input };
}

export async function upsertDiagnosticItem(db: D1Database, context: PlatformContext, input: {
  id?: string;
  objectiveId: string;
  level: string;
  prompt: string;
  options: string[];
  correctOption: number;
  explanation: string;
  status: "active" | "inactive";
}) {
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
    (id,tenant_id,objective_id,level,prompt,options_json,correct_option,explanation,status,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET objective_id=excluded.objective_id,level=excluded.level,prompt=excluded.prompt,
      options_json=excluded.options_json,correct_option=excluded.correct_option,explanation=excluded.explanation,
      status=excluded.status WHERE tenant_id=excluded.tenant_id`)
    .bind(id, context.tenantId, input.objectiveId, input.level, input.prompt, JSON.stringify(input.options.map((option) => option.trim())), input.correctOption, input.explanation, input.status, context.userId)
    .run();
  return { id, ...input };
}
