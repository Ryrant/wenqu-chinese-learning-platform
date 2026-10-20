import { chunkText, extractText, publishContent } from "../content-processing";
import { ensurePlatformRuntime } from "../platform-runtime";
import { requireText, audit, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const contentCommands = {
  review_content: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = requireText(body.id, "document_id");
    if (body.status !== "published" && body.status !== "rejected") return Response.json({ error: "invalid_content_review_status" }, { status: 400 });
    const next = body.status;
    const document = await db.prepare("SELECT processing_status AS processingStatus FROM source_documents WHERE id=? AND tenant_id=?").bind(id, tenantId).first<{ processingStatus: string }>();
    if (!document) return Response.json({ error: "document_not_found" }, { status: 404 });
    if (next === "published") {
      if (document.processingStatus !== "processed") return Response.json({ error: "document_not_publishable" }, { status: 409 });
      await publishContent(db, { tenantId, sourceDocumentId: id });
    } else {
      await db.batch([
        db.prepare("UPDATE source_documents SET processing_status='rejected',rights_status='pending' WHERE id=? AND tenant_id=?").bind(id, tenantId),
        db.prepare("UPDATE knowledge_chunks SET published=0 WHERE tenant_id=? AND source_document_id=?").bind(tenantId, id),
      ]);
    }
    await audit(db, tenantId, userId, "source.reviewed", "source_document", id, { status: next });
    return Response.json({ id, status: next });
  },

  reprocess_content: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = requireText(body.id, "document_id", 120);
    const document = await db.prepare(`SELECT id,title,object_key AS objectKey,media_type AS mediaType
        FROM source_documents WHERE id=? AND tenant_id=? AND archived_at IS NULL`)
      .bind(id, tenantId).first<{ id: string; title: string; objectKey: string | null; mediaType: string }>();
    if (!document?.objectKey) return Response.json({ error: "source_file_unavailable" }, { status: 409 });
    const storage = (await ensurePlatformRuntime()).storage;
    if (!storage) return Response.json({ error: "storage_unavailable" }, { status: 503 });
    const object = await storage.get(document.objectKey);
    if (!object) return Response.json({ error: "source_file_unavailable" }, { status: 404 });
    try {
      const file = new File([await object.arrayBuffer()], document.title, { type: document.mediaType });
      const extracted = await extractText(file);
      const chunks = chunkText({ tenantId, sourceDocumentId: id, text: extracted.text });
      await db.batch([
        db.prepare("DELETE FROM knowledge_chunks WHERE tenant_id=? AND source_document_id=?").bind(tenantId, id),
        ...chunks.map((chunk) => db.prepare("INSERT INTO knowledge_chunks (id,tenant_id,source_document_id,content,metadata_json,published) VALUES (?,?,?,?,?,0)").bind(chunk.id, chunk.tenantId, chunk.sourceDocumentId, chunk.content, chunk.metadataJson)),
        db.prepare("UPDATE source_documents SET processing_status='processed',processing_error=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?").bind(id, tenantId),
      ]);
      await audit(db, tenantId, userId, "source.reprocessed", "source_document", id, { chunkCount: chunks.length });
      return Response.json({ id, status: "processed", chunkCount: chunks.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "content_processing_failed";
      await db.prepare("UPDATE source_documents SET processing_status='failed',processing_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?").bind(message, id, tenantId).run();
      return Response.json({ error: message }, { status: 422 });
    }
  },

  archive_content: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = requireText(body.id, "document_id", 120);
    const document = await db.prepare("SELECT id FROM source_documents WHERE id=? AND tenant_id=? AND archived_at IS NULL").bind(id, tenantId).first();
    if (!document) return Response.json({ error: "document_not_found" }, { status: 404 });
    await db.batch([
      db.prepare("UPDATE source_documents SET processing_status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?").bind(id, tenantId),
      db.prepare("UPDATE knowledge_chunks SET published=0 WHERE tenant_id=? AND source_document_id=?").bind(tenantId, id),
    ]);
    await audit(db, tenantId, userId, "source.archived", "source_document", id);
    return Response.json({ id, status: "archived" });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
