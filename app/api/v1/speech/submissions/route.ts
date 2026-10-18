import { ensurePlatformRuntime } from "../../../../lib/platform-runtime";
import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { assertSubmissionTarget, createStudentSubmission } from "../../../../lib/submission-service";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "student");
    const form = await request.formData();
    const audio = form.get("audio");
    const assignmentId = String(form.get("assignmentId") ?? "");
    const reference = String(form.get("reference") ?? "").slice(0, 500);
    const familyTaskId = String(form.get("familyTaskId") ?? "") || null;
    const id = String(form.get("submissionId") ?? "") || crypto.randomUUID();
    if (!(audio instanceof File) || !assignmentId || audio.size < 200 || audio.size > 12 * 1024 * 1024 || !/^audio\//i.test(audio.type) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "invalid_audio_submission" }, { status: 400 });
    // 同一份录音重试上传时复用提交 ID，避免网络响应丢失后产生两份作品。
    const existing = await context.db.prepare("SELECT assignment_id AS assignmentId,student_user_id AS studentUserId,family_task_id AS familyTaskId,asset_key AS assetKey,review_status AS reviewStatus FROM submissions WHERE id=? AND tenant_id=?")
      .bind(id, context.tenantId).first<{ assignmentId: string; studentUserId: string; familyTaskId: string | null; assetKey: string | null; reviewStatus: string }>();
    if (existing) {
      if (existing.studentUserId !== context.userId || existing.assignmentId !== assignmentId || existing.familyTaskId !== familyTaskId || !existing.assetKey) throw new Error("submission_id_conflict");
      return Response.json({ id, reviewStatus: existing.reviewStatus, message: "这份录音已保存，无需重复提交。" }, { status: 200 });
    }
    const target = await assertSubmissionTarget(context.db, context, { assignmentId, familyTaskId });
    if (target.diagnosticMode === "writing") throw new Error("invalid_diagnostic_submission");
    const safeType = audio.type || "audio/webm";
    // 并发重传各自写入独立对象，不能覆盖另一请求已经关联的作品原件。
    const objectKey = `${context.tenantId}/submissions/${id}/${crypto.randomUUID()}.webm`;
    const storage = (await ensurePlatformRuntime()).storage;
    if (!storage) return Response.json({ error: "storage_unavailable" }, { status: 503 });
    await storage.put(objectKey, audio.stream(), { httpMetadata: { contentType: safeType }, customMetadata: { tenantId: context.tenantId, studentUserId: context.userId, reference } });
    await createStudentSubmission(context.db, context, { id, assignmentId, familyTaskId, assetKey: objectKey });
    return Response.json({ id, reviewStatus: "human_review", message: "录音已安全保存，等待教师人工评价。" }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
