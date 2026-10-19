import { assertSubmissionReviewAccess } from "./access-control";
import { jsonValue, readSequenceWork } from "./learning-sequence-types";
import type { PlatformDatabase } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";
import { isWorkload, TRIAL_KIND_LABELS, TRIAL_METHOD_LABELS, type TrialEntry, type TrialKind, type TrialMethod } from "./trial-types";

type RecordRow = {
  id: string; sequence_id: string; kind: TrialKind; method: TrialMethod | null; minutes: number | null;
  reference_submission_id: string | null; reference_title: string | null; note: string; created_by: string;
  created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null;
};
type SequenceRow = { id: string; baseline_submission_id: string; baseline_snapshot_json: string; student_user_id: string; assignment_id: string };

async function assertTrialAccess(db: PlatformDatabase, context: PlatformContext, sequenceId: string) {
  if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden");
  const group = await db.prepare("SELECT * FROM learning_sequences WHERE id=? AND tenant_id=?")
    .bind(sequenceId, context.tenantId).first<SequenceRow>();
  if (!group) throw new Error("sequence_not_found");
  // 监护人的可读权限不能用于记录其他班级的内部试用情况；离班后仍可记录退出原因。
  await assertSubmissionReviewAccess(db, context, group.baseline_submission_id);
  return group;
}

export async function readTrialEntries(db: PlatformDatabase, context: PlatformContext): Promise<TrialEntry[]> {
  const admin = context.roles.includes("admin");
  if (!admin && !context.roles.includes("teacher")) return [];
  const rows = await db.prepare(`SELECT r.*,ls.title AS sequenceTitle,s.display_name AS studentName,c.name AS className,u.display_name AS teacherName
    FROM learning_trial_records r JOIN learning_sequences ls ON ls.id=r.sequence_id AND ls.tenant_id=r.tenant_id
    JOIN assignments a ON a.id=ls.assignment_id AND a.tenant_id=ls.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
    JOIN users s ON s.id=ls.student_user_id JOIN users u ON u.id=r.created_by
    WHERE r.tenant_id=? AND (?=1 OR (c.teacher_user_id=? AND (r.created_by=? OR r.kind IN ('not_completed','withdrawn','no_improvement'))))
    ORDER BY r.created_at DESC,r.rowid DESC`)
    .bind(context.tenantId, admin ? 1 : 0, context.userId, context.userId)
    .all<RecordRow & { sequenceTitle: string; studentName: string; className: string; teacherName: string }>();
  return rows.results.map((row) => ({
    id: row.id, sequenceId: row.sequence_id, sequenceTitle: row.sequenceTitle, studentName: row.studentName, className: row.className,
    kind: row.kind, method: row.method, minutes: row.minutes, referenceSubmissionId: row.reference_submission_id, referenceTitle: row.reference_title,
    note: row.note, teacherName: row.teacherName, createdAt: row.created_at, voidedAt: row.voided_at, voidReason: row.void_reason,
    canVoid: !row.voided_at && (admin || row.created_by === context.userId),
  }));
}

export async function createTrialRecord(db: PlatformDatabase, context: PlatformContext, input: {
  id: string; sequenceId: string; kind: string; method?: unknown; minutes?: unknown; referenceSubmissionId?: string | null; note: string;
}) {
  const group = await assertTrialAccess(db, context, input.sequenceId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new Error("invalid_trial_record_id");
  if (!Object.hasOwn(TRIAL_KIND_LABELS, input.kind)) throw new Error("invalid_trial_kind");
  if (!input.note.trim() || input.note.length > 2000) throw new Error("invalid_trial_note");
  const workload = isWorkload(input.kind);
  if (workload) {
    if (typeof input.method !== "string" || !Object.hasOwn(TRIAL_METHOD_LABELS, input.method)) throw new Error("invalid_trial_method");
    if (typeof input.minutes !== "number" || !Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes > 1440) throw new Error("invalid_trial_minutes");
  } else if (input.method != null || input.minutes != null) throw new Error("invalid_trial_observation");
  const method = workload ? input.method as TrialMethod : null;
  const minutes = workload ? input.minutes as number : null;
  const referenceId = input.referenceSubmissionId || null;
  let referenceTitle: string | null = null;
  if (referenceId) {
    const work = await db.prepare(`SELECT sequence_snapshot_json FROM submissions WHERE id=? AND tenant_id=?
      AND assignment_id=? AND student_user_id=? AND (id=? OR sequence_id=?)`)
      .bind(referenceId, context.tenantId, group.assignment_id, group.student_user_id, group.baseline_submission_id, group.id)
      .first<{ sequence_snapshot_json: string }>();
    if (!work) throw new Error("invalid_trial_reference");
    referenceTitle = referenceId === group.baseline_submission_id
      ? jsonValue<{ title?: string }>(group.baseline_snapshot_json, {}).title ?? null : readSequenceWork(work.sequence_snapshot_json)?.title ?? null;
    if (!referenceTitle) throw new Error("invalid_trial_reference");
  }
  const saved = () => db.prepare("SELECT * FROM learning_trial_records WHERE id=? AND tenant_id=?").bind(input.id, context.tenantId).first<RecordRow>();
  const match = (row: RecordRow) => row.sequence_id === input.sequenceId && row.created_by === context.userId && row.kind === input.kind
    && row.method === method && row.minutes === minutes && row.reference_submission_id === referenceId && row.note === input.note;
  const existing = await saved();
  if (existing) {
    if (!match(existing)) throw new Error("trial_record_id_conflict");
    return { id: existing.id };
  }
  try {
    await db.batch([
      db.prepare(`INSERT INTO learning_trial_records (id,tenant_id,sequence_id,kind,method,minutes,reference_submission_id,reference_title,note,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(input.id, context.tenantId, input.sequenceId, input.kind, method, minutes, referenceId, referenceTitle, input.note, context.userId),
      db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,'trial_record.created','trial_record',?,?)")
        .bind(crypto.randomUUID(), context.tenantId, context.userId, input.id, JSON.stringify({ sequenceId: input.sequenceId, kind: input.kind })),
    ]);
  } catch (error) {
    const concurrent = await saved();
    if (concurrent) {
      if (!match(concurrent)) throw new Error("trial_record_id_conflict");
      return { id: concurrent.id };
    }
    if (error instanceof Error && error.message.includes("learning_trial_records.id")) throw new Error("trial_record_id_conflict");
    throw error;
  }
  return { id: input.id };
}

export async function voidTrialRecord(db: PlatformDatabase, context: PlatformContext, input: { id: string; reason: string }) {
  const saved = () => db.prepare("SELECT * FROM learning_trial_records WHERE id=? AND tenant_id=?").bind(input.id, context.tenantId).first<RecordRow>();
  const record = await saved();
  if (!record) throw new Error("trial_record_not_found");
  await assertTrialAccess(db, context, record.sequence_id);
  if (!context.roles.includes("admin") && record.created_by !== context.userId) throw new Error("forbidden");
  if (!input.reason.trim() || input.reason.length > 1000) throw new Error("invalid_trial_void_reason");
  if (!record.voided_at) await db.batch([
    db.prepare("UPDATE learning_trial_records SET voided_at=CURRENT_TIMESTAMP,voided_by=?,void_reason=? WHERE id=? AND tenant_id=? AND voided_at IS NULL")
      .bind(context.userId, input.reason, input.id, context.tenantId),
    db.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
      SELECT ?,?,?,'trial_record.voided','trial_record',?,? WHERE changes()>0`)
      .bind(crypto.randomUUID(), context.tenantId, context.userId, input.id, JSON.stringify({ reason: input.reason })),
  ]);
  const result = await saved();
  if (result?.void_reason !== input.reason) throw new Error("trial_record_already_voided");
  return { id: input.id, voided: true };
}
