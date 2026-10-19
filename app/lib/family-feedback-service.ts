import { readFamilyPlan } from "./family-task";
import { ALTERNATIVE_LABELS, INSTRUCTION_LABELS, OPERATION_LABELS, PARTICIPATION_LABELS, feedbackReasonRequired, type FeedbackFields, type FeedbackSnapshot, type FeedbackTask, type FeedbackView, type FamilyFeedbackData } from "./family-feedback-types";
import type { PlatformContext } from "./platform-store";

type TaskRow = { id: string; student_user_id: string; assignment_id: string | null; classId: string | null; className: string | null; studentName: string;
  title: string; detail: string; objective_id: string | null; objectiveTitle: string | null; assignmentTitle: string | null; family_plan_json: string; status: string };
type FeedbackRow = { id: string; family_task_id: string; student_user_id: string; assignment_id: string | null; class_id: string | null; task_revision: number; task_snapshot_json: string;
  participation: FeedbackFields["participation"]; instructions: FeedbackFields["instructions"]; operation_help: FeedbackFields["operationHelp"]; alternative: FeedbackFields["alternative"];
  note: string; created_by: string; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null };

function snapshot(row: TaskRow): FeedbackSnapshot {
  return { version: 1, title: row.title, detail: row.detail, objectiveId: row.objective_id, objectiveTitle: row.objectiveTitle,
    assignmentTitle: row.assignmentTitle, plan: readFamilyPlan(row.family_plan_json) };
}
const taskSelect = `SELECT lr.*,a.class_id AS classId,c.name AS className,u.display_name AS studentName,lo.title AS objectiveTitle,a.title AS assignmentTitle
  FROM learning_recommendations lr JOIN users u ON u.id=lr.student_user_id
  LEFT JOIN assignments a ON a.id=lr.assignment_id AND a.tenant_id=lr.tenant_id
  LEFT JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
  LEFT JOIN learning_objectives lo ON lo.id=lr.objective_id AND lo.tenant_id=lr.tenant_id`;
function guardianClause(alias: string) { return `EXISTS (SELECT 1 FROM guardian_student_links gl WHERE gl.tenant_id=${alias}.tenant_id AND gl.student_user_id=${alias}.student_user_id AND gl.guardian_user_id=? AND gl.status='active')`; }
async function assertGuardian(context: PlatformContext, studentId: string) {
  if (!context.roles.includes("guardian")) throw new Error("forbidden");
  if (!await context.db.prepare("SELECT id FROM guardian_student_links WHERE tenant_id=? AND guardian_user_id=? AND student_user_id=? AND status='active'")
    .bind(context.tenantId, context.userId, studentId).first()) throw new Error("forbidden");
}

export async function readFamilyFeedback(context: PlatformContext, view: FeedbackView, studentId?: string): Promise<FamilyFeedbackData> {
  const admin = context.roles.includes("admin");
  if (view === "guardian") { if (!studentId) throw new Error("invalid_student_id"); await assertGuardian(context, studentId); }
  else if (!admin && !context.roles.includes("teacher")) throw new Error("forbidden");
  const taskAccess = view === "guardian" ? `lr.student_user_id=? AND ${guardianClause("lr")}` : "(?=1 OR c.teacher_user_id=?)";
  const recordAccess = view === "guardian" ? `f.student_user_id=? AND ${guardianClause("f")}` : "(?=1 OR c.teacher_user_id=?)";
  const args = view === "guardian" ? [studentId, context.userId] : [admin ? 1 : 0, context.userId];
  const [tasks, entries] = await Promise.all([
    context.db.prepare(`${taskSelect} WHERE lr.tenant_id=? AND lr.source_type='family' AND ${taskAccess} ORDER BY lr.created_at DESC,lr.rowid DESC`)
      .bind(context.tenantId, ...args).all<TaskRow>(),
    context.db.prepare(`SELECT f.*,c.name AS className,s.display_name AS studentName,u.display_name AS authorName
      FROM family_usability_feedback f JOIN users s ON s.id=f.student_user_id JOIN users u ON u.id=f.created_by
      LEFT JOIN classes c ON c.id=f.class_id AND c.tenant_id=f.tenant_id
      WHERE f.tenant_id=? AND ${recordAccess} ORDER BY f.created_at DESC,f.rowid DESC`)
      .bind(context.tenantId, ...args).all<FeedbackRow & { className: string | null; studentName: string; authorName: string }>(),
  ]);
  return { tasks: tasks.results.map((row): FeedbackTask => ({ id: row.id, studentId: row.student_user_id, studentName: row.studentName, classId: row.classId,
    className: row.className, revision: readFamilyPlan(row.family_plan_json)?.revision ?? 0, status: row.status, snapshot: snapshot(row) })),
  entries: entries.results.map((row) => ({ id: row.id, taskId: row.family_task_id, studentId: row.student_user_id, studentName: row.studentName,
    classId: row.class_id, className: row.className, revision: row.task_revision, snapshot: JSON.parse(row.task_snapshot_json) as FeedbackSnapshot,
    participation: row.participation, instructions: row.instructions, operationHelp: row.operation_help, alternative: row.alternative, note: row.note,
    authorName: row.authorName, createdAt: row.created_at, voidedAt: row.voided_at, voidReason: row.void_reason,
    canVoid: !row.voided_at && (admin || (view === "guardian" && row.created_by === context.userId)) })), generatedAt: new Date().toISOString() };
}

export async function recordFamilyFeedback(context: PlatformContext, input: { id: string; taskId: string; revision: number } & FeedbackFields) {
  if (!context.roles.includes("guardian")) throw new Error("forbidden");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new Error("invalid_family_feedback_id");
  if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error("invalid_family_feedback_revision");
  if (!Object.hasOwn(PARTICIPATION_LABELS, input.participation) || !Object.hasOwn(INSTRUCTION_LABELS, input.instructions)
    || !Object.hasOwn(OPERATION_LABELS, input.operationHelp) || !Object.hasOwn(ALTERNATIVE_LABELS, input.alternative)) throw new Error("invalid_family_feedback_fields");
  if (typeof input.note !== "string" || input.note.length > 1500 || (feedbackReasonRequired(input) && !input.note.trim())) throw new Error("invalid_family_feedback_note");
  const { db, tenantId, userId } = context;
  const saved = () => db.prepare("SELECT * FROM family_usability_feedback WHERE id=? AND tenant_id=?").bind(input.id, tenantId).first<FeedbackRow>();
  async function recover(row: FeedbackRow) {
    await assertGuardian(context, row.student_user_id);
    if (row.created_by !== userId || row.family_task_id !== input.taskId || row.task_revision !== input.revision || row.participation !== input.participation
      || row.instructions !== input.instructions || row.operation_help !== input.operationHelp || row.alternative !== input.alternative || row.note !== input.note) throw new Error("family_feedback_id_conflict");
    if (row.voided_at) throw new Error("family_feedback_already_voided");
    return { id: row.id };
  }
  const existing = await saved(); if (existing) return recover(existing);
  const task = await db.prepare(`${taskSelect} WHERE lr.id=? AND lr.tenant_id=? AND lr.source_type='family' AND ${guardianClause("lr")}`)
    .bind(input.taskId, tenantId, userId).first<TaskRow>();
  if (!task) throw new Error("family_task_not_found");
  if ((readFamilyPlan(task.family_plan_json)?.revision ?? 0) !== input.revision) throw new Error("family_feedback_task_changed");
  try { await db.batch([
    // 提交时固定看到的任务版本与原班级；任务后续改名或改关联不会转移历史反馈权限。
    db.prepare(`INSERT INTO family_usability_feedback
      (id,tenant_id,family_task_id,student_user_id,assignment_id,class_id,task_revision,task_snapshot_json,participation,instructions,operation_help,alternative,note,created_by)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM learning_recommendations lr WHERE lr.id=? AND lr.tenant_id=? AND lr.source_type='family'
        AND lr.student_user_id=? AND lr.assignment_id IS ? AND lr.objective_id IS ? AND lr.family_plan_json=? AND lr.title=? AND lr.detail=? AND ${guardianClause("lr")}`)
      .bind(input.id, tenantId, task.id, task.student_user_id, task.assignment_id, task.classId, input.revision, JSON.stringify(snapshot(task)),
        input.participation, input.instructions, input.operationHelp, input.alternative, input.note, userId,
        task.id, tenantId, task.student_user_id, task.assignment_id, task.objective_id, task.family_plan_json, task.title, task.detail, userId),
    db.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
      SELECT ?,?,?,'family_feedback.created','family_feedback',?,? WHERE changes()>0`)
      .bind(crypto.randomUUID(), tenantId, userId, input.id, JSON.stringify({ taskId: task.id, revision: input.revision })),
  ]); } catch (error) {
    const concurrent = await saved(); if (concurrent) return recover(concurrent);
    if (error instanceof Error && error.message.includes("family_usability_feedback.id")) throw new Error("family_feedback_id_conflict");
    throw error;
  }
  const result = await saved();
  if (!result) { await assertGuardian(context, task.student_user_id); throw new Error("family_feedback_task_changed"); }
  return recover(result);
}

export async function voidFamilyFeedback(context: PlatformContext, input: { id: string; reason: string }) {
  const { db, tenantId, userId } = context;
  const saved = () => db.prepare("SELECT * FROM family_usability_feedback WHERE id=? AND tenant_id=?").bind(input.id, tenantId).first<FeedbackRow>();
  const entry = await saved(); if (!entry) throw new Error("family_feedback_not_found");
  const admin = context.roles.includes("admin");
  if (!admin) { await assertGuardian(context, entry.student_user_id); if (entry.created_by !== userId) throw new Error("forbidden"); }
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) throw new Error("invalid_family_feedback_reason");
  if (!entry.voided_at) await db.batch([
    db.prepare(`UPDATE family_usability_feedback AS f SET voided_at=CURRENT_TIMESTAMP,voided_by=?,void_reason=?
      WHERE id=? AND tenant_id=? AND voided_at IS NULL AND (?=1 OR ${guardianClause("f")})`).bind(userId, input.reason, input.id, tenantId, admin ? 1 : 0, userId),
    db.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
      SELECT ?,?,?,'family_feedback.voided','family_feedback',?,? WHERE changes()>0`).bind(crypto.randomUUID(), tenantId, userId, input.id, JSON.stringify({ reason: input.reason })),
  ]);
  const result = await saved();
  if (!result?.voided_at) throw new Error("forbidden");
  if (result.void_reason !== input.reason) throw new Error("family_feedback_already_voided");
  return { id: input.id, voided: true };
}
