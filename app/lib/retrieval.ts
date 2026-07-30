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
  return [...new Set(normalizeQuery(query).split(/[\s,，。！？、]+/).filter((term) => term.length >= 2))].slice(0, 8);
}

export async function searchPublishedKnowledge(db: D1Database, input: { tenantId: string; query: string; limit?: number }): Promise<RetrievedChunk[]> {
  const terms = queryTerms(input.query);
  if (!terms.length) return [];
  const like = `%${terms[0]}%`;
  const rows = await db.prepare(`
    SELECT k.id,k.content,d.title
    FROM knowledge_chunks k
    JOIN source_documents d ON d.id=k.source_document_id AND d.tenant_id=k.tenant_id
    WHERE k.tenant_id=? AND k.published=1 AND d.processing_status='published'
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
      matchReason: matched.length ? `matched:${matched.join(",")}` : `fallback:${like}`,
    };
  });
}
