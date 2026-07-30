import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { searchPublishedKnowledge } from "../../../../lib/retrieval";

export async function POST(request: Request) {
  try {
    const { db, tenantId } = await platformContext(request);
    const body = await request.json() as { query?: string; limit?: number };
    const query = body.query?.trim().slice(0, 200) ?? "";
    if (!query) return Response.json({ error: "query_required" }, { status: 400 });
    // 服务层固定以 tenant_id=? 和 processing_status='published' 过滤可检索内容。
    const results = await searchPublishedKnowledge(db, { tenantId, query, limit: body.limit });
    return Response.json({ query, retrieval: "tenant-scoped-published-keyword", results, totalReviewed: results.length });
  } catch (error) { return platformApiError(error); }
}
