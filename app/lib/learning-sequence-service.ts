import { assertSubmissionReviewAccess, submissionAccessClause } from "./access-control";
import type { WorkDiagnosticSnapshot } from "./diagnostic-types";
import { readFamilyWorkSnapshot } from "./family-task";
import { validateRubric } from "./learning-loop";
import { jsonValue, readReviewEvidence, readSequenceWork, SEQUENCE_STAGE_LABELS, type LearningSequence, type SequenceEvidence, type SequenceSource, type SequenceWorkSnapshot } from "./learning-sequence-types";
import type { PlatformDatabase } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";

type WorkRow = {
  id: string; assignment_id: string; student_user_id: string; studentName: string; assignmentTitle: string; assignmentStatus: string;
  text_answer: string | null; asset_key: string | null; score: number | null; feedback: string | null;
  created_at: string; reviewed_at: string | null; review_status: string; rubricJson: string; objectiveTitlesJson: string;
  diagnostic_snapshot_json: string; family_snapshot_json: string; family_help_level: string | null;
  sequence_id: string | null; sequence_stage: string | null; sequence_snapshot_json: string;
  evidenceJson: string | null; objectiveScoresJson: string | null; dimensionScoresJson: string | null;
};
type SequenceRow = {
  id: string; student_user_id: string; studentName: string; assignment_id: string; objective_id: string; objective_title: string;
  title: string; practice_prompt: string; transfer_prompt: string; transfer_context: string; rubric_json: string; medium: "text" | "audio"; baseline_snapshot_json: string;
};

async function workRows(db: PlatformDatabase, context: PlatformContext, filter: string, args: unknown[] = []) {
  const access = submissionAccessClause(context);
  return (await db.prepare(`SELECT s.*,a.title AS assignmentTitle,a.status AS assignmentStatus,a.rubric_json AS rubricJson,
    u.display_name AS studentName,sr.evidence_json AS evidenceJson,sr.objective_scores_json AS objectiveScoresJson,sr.dimension_scores_json AS dimensionScoresJson,
    (SELECT json_group_array(json_object('id',lo.id,'title',lo.title)) FROM assignment_objectives ao
      JOIN learning_objectives lo ON lo.tenant_id=ao.tenant_id AND lo.id=ao.objective_id
      WHERE ao.tenant_id=a.tenant_id AND ao.assignment_id=a.id) AS objectiveTitlesJson
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id JOIN users u ON u.id=s.student_user_id
    LEFT JOIN submission_reviews sr ON sr.id=(SELECT r.id FROM submission_reviews r
      WHERE r.tenant_id=s.tenant_id AND r.submission_id=s.id AND r.status='confirmed' ORDER BY r.rowid DESC LIMIT 1)
    WHERE s.tenant_id=? AND ${access.sql} AND (${filter}) ORDER BY s.created_at DESC,s.rowid DESC`)
    .bind(context.tenantId, ...access.args, ...args).all<WorkRow>()).results;
}

function evidence(row: WorkRow): SequenceEvidence {
  const review = readReviewEvidence(row.evidenceJson);
  const family = readFamilyWorkSnapshot(row.family_snapshot_json);
  const task = readSequenceWork(row.sequence_snapshot_json);
  const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(row.diagnostic_snapshot_json, {});
  const titles = review?.objectives ?? (family ? [{ id: family.objectiveId, title: family.objectiveTitle }] : diagnostic.objectives ?? jsonValue<Array<{ id: string; title: string }>>(row.objectiveTitlesJson, []));
  const scores = row.review_status === "reviewed" ? jsonValue<Array<{ objectiveId: string; score: number }>>(row.objectiveScoresJson, []) : [];
  return {
    id: row.id, title: task?.title ?? family?.title ?? diagnostic.title ?? row.assignmentTitle,
    prompt: task?.prompt ?? family?.detail ?? diagnostic.prompt ?? "", mediaId: diagnostic.mediaId ?? null,
    textAnswer: row.text_answer, hasAudio: !!row.asset_key, submittedAt: row.created_at, reviewedAt: row.reviewed_at,
    reviewed: row.review_status === "reviewed", score: row.review_status === "reviewed" ? row.score : null,
    feedback: row.review_status === "reviewed" ? row.feedback ?? "" : "",
    objectives: scores.map((item) => ({ id: item.objectiveId, title: titles.find((goal) => goal.id === item.objectiveId)?.title ?? item.objectiveId, score: item.score })),
    dimensions: row.review_status === "reviewed" ? jsonValue(row.dimensionScoresJson, []) : [],
    // 旧普通作品没有保存量规时，不能用当前作业补造历史评价依据。
    rubric: review?.rubric ?? family?.rubric ?? (diagnostic.version === 1 ? diagnostic.rubric ?? null : null),
    helpLevel: row.family_help_level === "prompted" || row.family_help_level === "assisted" ? row.family_help_level
      : review?.helpLevel ?? (row.family_help_level === "independent" ? "independent" : "unknown"),
    contextConfirmed: review?.contextConfirmed ?? false,
  };
}

function source(row: WorkRow): SequenceSource {
  const work = evidence(row);
  const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(row.diagnostic_snapshot_json, {});
  return { studentUserId: row.student_user_id, studentName: row.studentName, assignmentId: row.assignment_id, assignmentStatus: row.assignmentStatus,
    referenceRubric: work.rubric ?? diagnostic.rubric ?? jsonValue(row.rubricJson, []), work };
}

export async function createLearningSequence(db: PlatformDatabase, context: PlatformContext, input: {
  id?: string; baselineSubmissionId: string; objectiveId: string; title: string; practicePrompt: string; transferPrompt: string; transferContext: string;
}) {
  if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden");
  // 可读权限可能来自监护人等其他角色；发布任务必须另行验证本班教师权限。
  await assertSubmissionReviewAccess(db, context, input.baselineSubmissionId);
  const row = (await workRows(db, context, "s.id=? AND s.review_status='reviewed' AND a.status='published'", [input.baselineSubmissionId]))[0];
  if (!row) throw new Error("sequence_baseline_not_found");
  const baseline = source(row);
  const goal = baseline.work.objectives.find((item) => item.id === input.objectiveId);
  if (!goal) throw new Error("invalid_sequence_objective");
  const eligible = await db.prepare(`SELECT lo.id FROM learning_objectives lo WHERE lo.tenant_id=? AND lo.id=? AND lo.status='active'
    AND EXISTS (SELECT 1 FROM enrollments e JOIN assignments a ON a.class_id=e.class_id AND a.tenant_id=e.tenant_id
      WHERE e.tenant_id=lo.tenant_id AND e.student_user_id=? AND e.status='active' AND a.id=?)`)
    .bind(context.tenantId, input.objectiveId, row.student_user_id, row.assignment_id).first();
  if (!eligible) throw new Error("invalid_sequence_objective");
  if (input.practicePrompt.trim() === input.transferPrompt.trim()) throw new Error("invalid_sequence_context");
  const rubric = validateRubric(baseline.referenceRubric);
  const id = input.id ?? crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("invalid_sequence_id");
  async function existingResult() {
    const saved = await db.prepare("SELECT * FROM learning_sequences WHERE id=? AND tenant_id=?").bind(id, context.tenantId).first<SequenceRow & { created_by: string; baseline_submission_id: string }>();
    if (!saved) return null;
    if (saved.created_by !== context.userId || saved.baseline_submission_id !== input.baselineSubmissionId || saved.objective_id !== input.objectiveId
      || saved.title !== input.title || saved.practice_prompt !== input.practicePrompt || saved.transfer_prompt !== input.transferPrompt || saved.transfer_context !== input.transferContext) throw new Error("sequence_id_conflict");
    return { id };
  }
  const existing = await existingResult();
  if (existing) return existing;
  try { await db.batch([
    db.prepare(`INSERT INTO learning_sequences (id,tenant_id,student_user_id,assignment_id,objective_id,objective_title,
      baseline_submission_id,baseline_snapshot_json,title,practice_prompt,transfer_prompt,transfer_context,rubric_json,medium,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, context.tenantId, row.student_user_id, row.assignment_id, goal.id, goal.title, row.id, JSON.stringify(baseline.work),
        input.title, input.practicePrompt, input.transferPrompt, input.transferContext, JSON.stringify(rubric), row.asset_key ? "audio" : "text", context.userId),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,'learning_sequence.created','learning_sequence',?,?)")
      .bind(crypto.randomUUID(), context.tenantId, context.userId, id, JSON.stringify({ baselineSubmissionId: row.id, objectiveId: goal.id })),
  ]); } catch (error) {
    if (error instanceof Error && error.message.includes("learning_sequences.id")) {
      const saved = await existingResult(); if (saved) return saved;
    }
    throw error;
  }
  return { id };
}

export async function assertSequenceTarget(db: PlatformDatabase, context: PlatformContext, input: { assignmentId: string; sequenceId?: string | null; sequenceStage?: string; familyTaskId?: string | null }): Promise<SequenceWorkSnapshot | null> {
  if (!input.sequenceId && input.sequenceStage === undefined) return null;
  if (typeof input.sequenceId !== "string" || !input.sequenceId || (input.sequenceStage !== "practice" && input.sequenceStage !== "transfer") || input.familyTaskId) throw new Error("invalid_sequence_target");
  const row = await db.prepare("SELECT * FROM learning_sequences WHERE id=? AND tenant_id=? AND student_user_id=? AND assignment_id=?")
    .bind(input.sequenceId, context.tenantId, context.userId, input.assignmentId).first<SequenceRow>();
  if (!row) throw new Error("sequence_not_found");
  if (input.sequenceStage === "transfer") {
    const practice = await db.prepare("SELECT id FROM submissions WHERE tenant_id=? AND sequence_id=? AND student_user_id=? AND sequence_stage='practice' AND review_status='reviewed' LIMIT 1")
      .bind(context.tenantId, row.id, context.userId).first();
    if (!practice) throw new Error("sequence_practice_required");
  }
  return { version: 1, sequenceId: row.id, stage: input.sequenceStage, title: `${row.title} · ${SEQUENCE_STAGE_LABELS[input.sequenceStage]}`,
    prompt: input.sequenceStage === "practice" ? row.practice_prompt : row.transfer_prompt, context: row.transfer_context,
    objectiveId: row.objective_id, objectiveTitle: row.objective_title, rubric: JSON.parse(row.rubric_json), medium: row.medium };
}

export async function readSequenceWorkspace(db: PlatformDatabase, context: PlatformContext, focusedStudentId: string | null) {
  const access = submissionAccessClause(context);
  const filter = focusedStudentId ? " AND ls.student_user_id=?" : "";
  const rows = (await db.prepare(`SELECT ls.*,u.display_name AS studentName FROM learning_sequences ls
    JOIN submissions s ON s.id=ls.baseline_submission_id AND s.tenant_id=ls.tenant_id
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
    JOIN users u ON u.id=ls.student_user_id WHERE ls.tenant_id=? AND ${access.sql}${filter} ORDER BY ls.created_at DESC,ls.rowid DESC`)
    .bind(context.tenantId, ...access.args, ...(focusedStudentId ? [focusedStudentId] : [])).all<SequenceRow>()).results;
  const ids = rows.map((item) => item.id);
  const works = ids.length ? await workRows(db, context, `s.sequence_id IN (${ids.map(() => "?").join(",")})`, ids) : [];
  const learningSequences: LearningSequence[] = rows.map((row) => ({
    id: row.id, studentUserId: row.student_user_id, studentName: row.studentName, assignmentId: row.assignment_id,
    objectiveId: row.objective_id, objectiveTitle: row.objective_title, title: row.title, practicePrompt: row.practice_prompt,
    transferPrompt: row.transfer_prompt, transferContext: row.transfer_context, rubric: JSON.parse(row.rubric_json), medium: row.medium,
    baseline: JSON.parse(row.baseline_snapshot_json),
    practice: works.filter((work) => work.sequence_id === row.id && work.sequence_stage === "practice").map(evidence),
    transfer: works.filter((work) => work.sequence_id === row.id && work.sequence_stage === "transfer").map(evidence),
  }));
  const sequenceSources = context.roles.some((role) => role === "admin" || role === "teacher")
    ? (await workRows(db, context, "s.review_status='reviewed' AND a.status='published' AND (?=1 OR c.teacher_user_id=?)", [context.roles.includes("admin") ? 1 : 0, context.userId])).map(source).filter((item) => item.work.objectives.length)
    : [];
  return { learningSequences, sequenceSources };
}
