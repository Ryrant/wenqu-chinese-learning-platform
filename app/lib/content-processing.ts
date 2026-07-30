import { strFromU8, unzipSync } from "fflate";
import * as pdfjs from "pdfjs-dist";

export type ExtractedText = { text: string; kind: "txt" | "docx" | "pdf" };
export type KnowledgeChunkInput = { id: string; tenantId: string; sourceDocumentId: string; content: string; metadataJson: string };

export async function extractText(file: File): Promise<ExtractedText> {
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return extractTxtText(file);
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.toLowerCase().endsWith(".docx")) return extractDocxText(file);
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdfText(file);
  throw new Error("unsupported_file_type");
}

export async function extractTxtText(file: File): Promise<ExtractedText> {
  const text = (await file.text()).replace(/\u0000/g, "").trim();
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
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" ").trim());
  }
  const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || text.length < 20) throw new Error("unsupported_scanned_pdf");
  return { text, kind: "pdf" };
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

export async function publishContent(db: D1Database, input: { tenantId: string; sourceDocumentId: string }): Promise<void> {
  await db.batch([
    db.prepare("UPDATE source_documents SET processing_status='published',rights_status='approved' WHERE id=? AND tenant_id=? AND processing_status='processed'").bind(input.sourceDocumentId, input.tenantId),
    db.prepare("UPDATE knowledge_chunks SET published=1 WHERE tenant_id=? AND source_document_id=?").bind(input.tenantId, input.sourceDocumentId),
  ]);
}
