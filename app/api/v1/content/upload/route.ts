import { env } from "cloudflare:workers";
import { getDb } from "../../../../../db";
import { auditLogs, sourceDocuments } from "../../../../../db/schema";
import { apiError, requestContext } from "../../../../lib/request-context";

const allowed = new Set(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg", "audio/wav", "image/jpeg", "image/png", "text/plain"]);
const maxBytes = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const context = requestContext(request, { requireIdentity: true });
    const form = await request.formData();
    const file = form.get("file");
    const rightsStatus = String(form.get("rightsStatus") ?? "pending");
    if (!(file instanceof File)) return Response.json({ error: "file_required" }, { status: 400 });
    if (!allowed.has(file.type) || file.size > maxBytes) return Response.json({ error: "unsupported_or_oversized_file" }, { status: 415 });
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 120);
    const objectKey = `${context.tenantId}/sources/${id}/${safeName}`;
    const bucket = (env as unknown as { CONTENT: R2Bucket }).CONTENT;
    await bucket.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { tenantId: context.tenantId, uploadedBy: context.userId } });
    const db = getDb();
    await db.insert(sourceDocuments).values({ id, tenantId: context.tenantId, title: file.name.slice(0, 200), objectKey, mediaType: file.type, rightsStatus, processingStatus: "uploaded", createdBy: context.userId });
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), tenantId: context.tenantId, actorUserId: context.userId, action: "source.uploaded", targetType: "source_document", targetId: id, detailJson: JSON.stringify({ fileName: safeName, size: file.size, rightsStatus }) });
    return Response.json({ id, status: "uploaded", next: "rights_review" }, { status: 201 });
  } catch (error) { return apiError(error); }
}