import { chunkText, contentProcessingError, extractText, type ExtractedText } from "../../../../../lib/content-processing";
import { ensurePlatformRuntime } from "../../../../../lib/platform-runtime";
import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { discardFailedUpload } from "../../../../../lib/upload-cleanup";

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
    const storage = (await ensurePlatformRuntime()).storage;
    if (!storage) return Response.json({ error: "storage_unavailable" }, { status: 503 });
    try {
      await storage.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { tenantId: context.tenantId, uploadedBy: context.userId } });
      let extracted: ExtractedText;
      try {
        extracted = await extractText(file);
      } catch (error) {
        const message = contentProcessingError(error);
        if (!message) throw error;
        await context.db.batch([
          context.db.prepare("INSERT INTO source_documents (id,tenant_id,title,object_key,media_type,rights_status,processing_status,processing_error,version,created_by) VALUES (?,?,?,?,?,?, 'failed',?,1,?)").bind(id, context.tenantId, file.name.slice(0, 200), objectKey, file.type, rightsStatus, message, context.userId),
          context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, context.userId, "source.uploaded", "source_document", id, JSON.stringify({ fileName: safeName, size: file.size, rightsStatus, error: message })),
        ]);
        return Response.json({ id, status: "failed", error: message }, { status: 201 });
      }
      const chunks = chunkText({ tenantId: context.tenantId, sourceDocumentId: id, text: extracted.text });
      await context.db.batch([
        context.db.prepare("INSERT INTO source_documents (id,tenant_id,title,object_key,media_type,rights_status,processing_status,version,created_by) VALUES (?,?,?,?,?,?, 'processed',1,?)").bind(id, context.tenantId, file.name.slice(0, 200), objectKey, file.type, rightsStatus, context.userId),
        ...chunks.map((chunk) => context.db.prepare("INSERT INTO knowledge_chunks (id,tenant_id,source_document_id,content,metadata_json,published) VALUES (?,?,?,?,?,0)").bind(chunk.id, chunk.tenantId, chunk.sourceDocumentId, chunk.content, chunk.metadataJson)),
        context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, context.userId, "source.processed", "source_document", id, JSON.stringify({ fileName: safeName, size: file.size, rightsStatus, chunkCount: chunks.length, extractionKind: extracted.kind })),
      ]);
      return Response.json({ id, status: "processed", next: "rights_review" }, { status: 201 });
    } catch (error) {
      await discardFailedUpload(storage, objectKey, error);
      throw error;
    }
  } catch (error) { return platformApiError(error); }
}
