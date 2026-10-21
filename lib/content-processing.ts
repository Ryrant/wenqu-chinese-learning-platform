import { FlateErrorCode, strFromU8, unzipSync } from "fflate";
import type { PlatformDatabase } from "./platform-runtime";
import { auditStatement } from "./audit";

export type ExtractedText = { text: string; kind: "txt" | "docx" | "pdf" };
export type KnowledgeChunkInput = { id: string; tenantId: string; sourceDocumentId: string; content: string; metadataJson: string };

const processingErrors = new Set(["empty_text", "unsupported_scanned_pdf", "docx_document_missing", "unsupported_file_type"]);
const zipErrors = new Set<number>(Object.values(FlateErrorCode));

export function contentProcessingError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (processingErrors.has(error.message)) return error.message;
  if (["InvalidPDFException", "PasswordException"].includes(error.name)
    || ("code" in error && typeof error.code === "number" && zipErrors.has(error.code))) return "unsupported_file_type";
  return null;
}

export async function extractText(file: File): Promise<ExtractedText> {
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return extractTxtText(file);
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.toLowerCase().endsWith(".docx")) return extractDocxText(file);
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdfText(file);
  throw new Error("unsupported_file_type");
}

export async function extractTxtText(file: File): Promise<ExtractedText> {
  const text = (await file.text()).replaceAll("\u0000", "").trim();
  if (!text) throw new Error("empty_text");
  return { text, kind: "txt" };
}

export async function extractDocxText(file: File): Promise<ExtractedText> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentXml = zip["word/document.xml"];
  if (!documentXml) throw new Error("docx_document_missing");
  const text = strFromU8(documentXml).replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("empty_text");
  return { text, kind: "docx" };
}

export async function extractPdfText(file: File): Promise<ExtractedText> {
  const { preparePdfTextRuntime } = await import("./pdf-text-runtime");
  await preparePdfTextRuntime();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  });
  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" ").trim());
      page.cleanup();
    }
    const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text || text.length < 20) throw new Error("unsupported_scanned_pdf");
    return { text, kind: "pdf" };
  } finally {
    await loadingTask.destroy();
  }
}

export function chunkText(input: { tenantId: string; sourceDocumentId: string; text: string }): KnowledgeChunkInput[] {
  const paragraphs = input.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= 1000) current = next;
    else {
      if (current) chunks.push(current);
      if (paragraph.length <= 1000) current = paragraph;
      else {
        for (let index = 0; index < paragraph.length; index += 1000) chunks.push(paragraph.slice(index, index + 1000));
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((content) => content.length <= 1000).map((content, chunkIndex) => ({ id: crypto.randomUUID(), tenantId: input.tenantId, sourceDocumentId: input.sourceDocumentId, content, metadataJson: JSON.stringify({ chunkIndex, length: content.length }) }));
}

export async function publishContent(db: PlatformDatabase, input: { tenantId: string; sourceDocumentId: string; expectedVersion?: number }, review?: { userId: string }): Promise<void> {
  const document = input.expectedVersion === undefined
    ? await db.prepare("SELECT version FROM source_documents WHERE id=? AND tenant_id=? AND processing_status='processed' AND archived_at IS NULL")
      .bind(input.sourceDocumentId, input.tenantId).first<{ version: number }>()
    : { version: input.expectedVersion };
  if (!document) throw new Error("document_version_conflict");
  const auditId = crypto.randomUUID();
  // 带审计时用本次回执守护分块；兼容两参数调用时，分块语句紧随文档 UPDATE，读取 changes()。
  const [accepted] = await db.batch([
    db.prepare("UPDATE source_documents SET processing_status='published',rights_status='approved',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND processing_status='processed' AND archived_at IS NULL AND version=?")
      .bind(input.sourceDocumentId, input.tenantId, document.version),
    ...(review ? [auditStatement(db, input.tenantId, review.userId, "source.reviewed", "source_document", input.sourceDocumentId, { status: "published" }, true, auditId)] : []),
    db.prepare(`UPDATE knowledge_chunks SET published=1 WHERE tenant_id=? AND source_document_id=? AND ${review
      ? "EXISTS (SELECT 1 FROM audit_logs WHERE id=? AND tenant_id=?)"
      : "changes()>0"}`)
      .bind(input.tenantId, input.sourceDocumentId, ...(review ? [auditId, input.tenantId] : [])),
  ]);
  if (!accepted.meta.changes) throw new Error("document_version_conflict");
}
