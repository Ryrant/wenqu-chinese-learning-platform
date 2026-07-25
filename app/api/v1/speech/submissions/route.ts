import { env } from "cloudflare:workers";
import { platformApiError, platformContext } from "../../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "student");
    const form = await request.formData();
    const audio = form.get("audio");
    const assignmentId = String(form.get("assignmentId") ?? "");
    const reference = String(form.get("reference") ?? "").slice(0, 500);
    if (!(audio instanceof File) || !assignmentId || audio.size < 200 || audio.size > 12 * 1024 * 1024) return Response.json({ error: "invalid_audio_submission" }, { status: 400 });
    const assignment = await context.db.prepare("SELECT a.id FROM assignments a WHERE a.id=? AND a.tenant_id=? AND a.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=a.tenant_id AND e.class_id=a.class_id AND e.student_user_id=? AND e.status='active')").bind(assignmentId, context.tenantId, context.userId).first();
    if (!assignment) return Response.json({ error: "published_assignment_not_found" }, { status: 404 });
    const id = crypto.randomUUID();
    const safeType = audio.type || "audio/webm";
    const objectKey = `${context.tenantId}/submissions/${id}/recording.webm`;
    await (env as unknown as { CONTENT: R2Bucket }).CONTENT.put(objectKey, audio.stream(), { httpMetadata: { contentType: safeType }, customMetadata: { tenantId: context.tenantId, studentUserId: context.userId, reference } });
    await context.db.batch([
      context.db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,asset_key,confidence,review_status) VALUES (?,?,?,?,?,0,'human_review')").bind(id, context.tenantId, assignmentId, context.userId, objectKey),
      context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, context.userId, "submission.audio_uploaded", "submission", id, JSON.stringify({ bytes: audio.size, contentType: safeType })),
    ]);
    return Response.json({ id, reviewStatus: "human_review", message: "录音已安全保存。语音评分服务未配置，已转教师人工复核。" }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
