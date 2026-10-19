import { FEEDBACK_RESPONSE_LABELS, type FamilyFeedbackResponse, type FeedbackView } from "./family-feedback-types";
import type { PlatformContext } from "./platform-store";

type SourceRow = { id: string; family_task_id: string; student_user_id: string; class_id: string | null; task_snapshot_json: string; response_id: string | null; voided_at: string | null };
type ResponseRow = { id: string; feedback_id: string; kind: FamilyFeedbackResponse["kind"]; detail: string; created_by: string; created_at: string; voided_at: string | null; void_reason: string | null };
const admin = (context: PlatformContext) => context.roles.includes("admin");
async function sourceAccess(context: PlatformContext, id: string) {
  if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden");
  const source = await context.db.prepare(`SELECT f.* FROM family_usability_feedback f LEFT JOIN classes c ON c.id=f.class_id AND c.tenant_id=f.tenant_id
    WHERE f.id=? AND f.tenant_id=? AND (?=1 OR c.teacher_user_id=?)`)
    .bind(id, context.tenantId, admin(context) ? 1 : 0, context.userId).first<SourceRow>();
  if (!source) throw new Error("forbidden"); return source;
}
export async function readFeedbackResponses(context: PlatformContext, view: FeedbackView, feedbackIds: string[]): Promise<FamilyFeedbackResponse[]> {
  if (!feedbackIds.length) return [];
  // feedbackIds 必须来自同一次已授权的反馈读取，不能由客户端指定读取集合。
  const rows = await context.db.prepare(`SELECT r.*,u.display_name AS authorName FROM family_feedback_responses r JOIN users u ON u.id=r.created_by
    WHERE r.tenant_id=? AND r.feedback_id IN (SELECT value FROM json_each(?)) ORDER BY r.created_at DESC,r.rowid DESC`)
    .bind(context.tenantId, JSON.stringify(feedbackIds)).all<ResponseRow & { authorName: string }>();
  return rows.results.map((row) => ({ id: row.id, feedbackId: row.feedback_id, kind: row.kind, detail: row.detail, authorName: row.authorName,
    createdAt: row.created_at, voidedAt: row.voided_at, voidReason: row.void_reason,
    canVoid: view === "teaching" && !row.voided_at && (admin(context) || row.created_by === context.userId) }));
}
export async function recordFeedbackResponse(context: PlatformContext, input: { id: string; feedbackId: string; kind: string; detail: string }) {
  const source = await sourceAccess(context, input.feedbackId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) throw new Error("invalid_family_response_id");
  if (!Object.hasOwn(FEEDBACK_RESPONSE_LABELS, input.kind)) throw new Error("invalid_family_response_kind");
  if (typeof input.detail !== "string" || !input.detail.trim() || input.detail.length > 2000) throw new Error("invalid_family_response_detail");
  if (source.response_id) throw new Error("invalid_family_response_source");
  const { db, tenantId, userId } = context;
  const saved = () => db.prepare("SELECT * FROM family_feedback_responses WHERE id=? AND tenant_id=?").bind(input.id, tenantId).first<ResponseRow>();
  const recover = (row: ResponseRow) => {
    if (row.feedback_id !== source.id || row.created_by !== userId || row.kind !== input.kind || row.detail !== input.detail) throw new Error("family_response_id_conflict");
    if (row.voided_at) throw new Error("family_response_already_voided"); return { id: row.id };
  };
  const existing = await saved(); if (existing) return recover(existing);
  if (source.voided_at) throw new Error("family_feedback_already_voided");
  try { await db.batch([
    // 固定原反馈及其原班级，不因任务改版或更换关联而扩大任教权限。
    db.prepare(`INSERT INTO family_feedback_responses (id,tenant_id,feedback_id,kind,detail,created_by)
      SELECT ?,?,?,?,?,? FROM family_usability_feedback f LEFT JOIN classes c ON c.id=f.class_id AND c.tenant_id=f.tenant_id
      WHERE f.id=? AND f.tenant_id=? AND f.response_id IS NULL AND f.voided_at IS NULL AND f.family_task_id=? AND f.student_user_id=? AND f.class_id IS ? AND f.task_snapshot_json=? AND (?=1 OR c.teacher_user_id=?)`)
      .bind(input.id, tenantId, source.id, input.kind, input.detail, userId, source.id, tenantId, source.family_task_id, source.student_user_id, source.class_id, source.task_snapshot_json, admin(context) ? 1 : 0, userId),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,'family_response.created','family_response',?,? WHERE changes()>0")
      .bind(crypto.randomUUID(), tenantId, userId, input.id, JSON.stringify({ feedbackId: source.id, kind: input.kind })),
  ]); } catch (error) {
    const concurrent = await saved(); if (concurrent) { await sourceAccess(context, concurrent.feedback_id); return recover(concurrent); }
    if (error instanceof Error && error.message.includes("family_feedback_responses.id")) throw new Error("family_response_id_conflict"); throw error;
  }
  const result = await saved(); if (!result) { await sourceAccess(context, source.id); throw new Error("family_response_source_changed"); } return recover(result);
}
export async function voidFeedbackResponse(context: PlatformContext, input: { id: string; reason: string }) {
  const { db, tenantId, userId } = context;
  const saved = () => db.prepare("SELECT * FROM family_feedback_responses WHERE id=? AND tenant_id=?").bind(input.id, tenantId).first<ResponseRow>();
  const response = await saved(); if (!response) throw new Error("family_response_not_found");
  await sourceAccess(context, response.feedback_id);
  if (!admin(context) && response.created_by !== userId) throw new Error("forbidden");
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000) throw new Error("invalid_family_response_reason");
  await db.batch([
    db.prepare(`UPDATE family_feedback_responses AS r SET voided_at=CURRENT_TIMESTAMP,voided_by=?,void_reason=?
      WHERE r.id=? AND r.tenant_id=? AND r.voided_at IS NULL AND EXISTS (SELECT 1 FROM family_usability_feedback f LEFT JOIN classes c ON c.id=f.class_id AND c.tenant_id=f.tenant_id
        WHERE f.id=r.feedback_id AND f.tenant_id=r.tenant_id AND (?=1 OR (c.teacher_user_id=? AND r.created_by=?)))`)
      .bind(userId, input.reason, input.id, tenantId, admin(context) ? 1 : 0, userId, userId),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,'family_response.voided','family_response',?,? WHERE changes()>0")
      .bind(crypto.randomUUID(), tenantId, userId, input.id, JSON.stringify({ reason: input.reason })),
  ]);
  const result = await saved(); if (!result?.voided_at) throw new Error("forbidden");
  if (result.void_reason !== input.reason) throw new Error("family_response_already_voided"); return { id: input.id };
}
