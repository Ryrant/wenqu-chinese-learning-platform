import { env } from "cloudflare:workers";
import { platformApiError, platformContext } from "../../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "admin");
    const form = await request.formData();
    const file = form.get("file");
    const rightsStatus = String(form.get("rightsStatus") ?? "pending");
    const allowed = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg", "audio/wav", "audio/webm", "image/jpeg", "image/png", "text/plain"]);
    if (!(file instanceof File)) return Response.json({ error: "file_required" }, { status: 400 });
    if (!allowed.has(file.type) || file.size > 25 * 1024 * 1024) return Response.json({ error: "unsupported_or_oversized_file" }, { status: 415 });
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 120);
    const objectKey = `${context.tenantId}/sources/${id}/${safeName}`;
    const bucket = (env as unknown as { CONTENT: R2Bucket }).CONTENT;
    await bucket.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { tenantId: context.tenantId, uploadedBy: context.userId } });
    await context.db.batch([
      context.db.prepare("INSERT INTO source_documents (id,tenant_id,title,object_key,media_type,rights_status,processing_status,version,created_by) VALUES (?,?,?,?,?,?, 'uploaded',1,?)").bind(id, context.tenantId, file.name.slice(0, 200), objectKey, file.type, rightsStatus, context.userId),
      context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, context.userId, "source.uploaded", "source_document", id, JSON.stringify({ fileName: safeName, size: file.size, rightsStatus })),
    ]);
    return Response.json({ id, status: "uploaded", next: "rights_review" }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
