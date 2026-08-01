export type RetrievedChunk = {
  id: string;
  title: string;
  content: string;
  excerpt: string;
  score: number;
  matchReason: string;
};

export function normalizeQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

export function queryTerms(query: string) {
  const normalized = normalizeQuery(query);
  const explicitTerms = normalized.split(/[\s,，。！？、]+/).filter((term) => term.length >= 2);
  const cjkRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const cjkWindows = cjkRuns.flatMap((run) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)));
  return [...new Set([...explicitTerms, ...cjkRuns.map((run) => run.slice(0, 8)), ...cjkWindows])].slice(0, 16);
}

export async function searchPublishedKnowledge(db: D1Database, input: { tenantId: string; query: string; limit?: number }): Promise<RetrievedChunk[]> {
  const terms = queryTerms(input.query);
  if (!terms.length) return [];
  const rows = await db.prepare(`
    SELECT k.id,k.content,d.title
    FROM knowledge_chunks k
    JOIN source_documents d ON d.id=k.source_document_id AND d.tenant_id=k.tenant_id
    WHERE k.tenant_id=? AND k.published=1 AND d.processing_status='published' AND d.archived_at IS NULL
      AND (${terms.map(() => "k.content LIKE ?").join(" OR ")})
    ORDER BY k.created_at DESC
    LIMIT ?
  `).bind(input.tenantId, ...terms.map((term) => `%${term}%`), Math.max(1, Math.min(input.limit ?? 5, 10))).all<{ id: string; content: string; title: string }>();
  return rows.results.map((row) => {
    const matched = terms.filter((term) => row.content.toLowerCase().includes(term));
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      excerpt: row.content.slice(0, 500),
      score: matched.length,
      matchReason: matched.length ? `matched:${matched.join(",")}` : "fallback:recent",
    };
  });
}
