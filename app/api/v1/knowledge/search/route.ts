import { platformApiError, platformContext } from "../../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const { db, tenantId } = await platformContext(request);
    const body = await request.json() as { query?: string; limit?: number };
    const query = body.query?.trim().slice(0, 200) ?? "";
    if (!query) return Response.json({ error: "query_required" }, { status: 400 });
    const rows = await db.prepare(`SELECT k.id,k.content,k.metadata_json AS metadataJson,d.title,d.version,d.rights_status AS rightsStatus FROM knowledge_chunks k JOIN source_documents d ON d.id=k.source_document_id AND d.tenant_id=k.tenant_id WHERE k.tenant_id=? AND k.published=1 AND d.processing_status='published' ORDER BY k.created_at DESC LIMIT 100`).bind(tenantId).all<{ id: string; content: string; metadataJson: string; title: string; version: number; rightsStatus: string }>();
    const terms = [...new Set(query.toLowerCase().split(/[\s，。？！、]+/).filter(Boolean))];
    const scored = rows.results.map((row) => {
      const haystack = `${row.title} ${row.content}`.toLowerCase();
      const hits = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { id: row.id, title: row.title, source: `${row.title} · 版本 ${row.version}`, excerpt: row.content, rightsStatus: row.rightsStatus, score: terms.length ? Number((hits / terms.length).toFixed(3)) : 0 };
    }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, Math.max(1, Math.min(body.limit ?? 5, 10)));
    return Response.json({ query, retrieval: "tenant-scoped-published-keyword", results: scored, totalReviewed: rows.results.length });
  } catch (error) { return platformApiError(error); }
}
