import { modelGateway, type Citation } from "../../../../lib/model-gateway";
import { apiError, requestContext } from "../../../../lib/request-context";

const corpus: Citation[] = [
  { id: "chunk-festival-01", title: "中华节日文化故事集", source: "自编内容 · 版本 1.2", excerpt: "中秋节常以圆月和月饼象征家人团聚，团圆是节日的重要文化主题。" },
  { id: "chunk-textbook-04", title: "四年级华文教材 · 下册", source: "第六单元 家人和节日", excerpt: "句型：我们一家人一起……；学习者可用它描述共同参与的家庭活动。" },
  { id: "chunk-teacher-12", title: "华文教师教学案例", source: "案例编号 T-012", excerpt: "让学生从食物、人物和动作三个线索进行看图说话，可降低开口难度。" },
];

export async function POST(request: Request) {
  try {
    requestContext(request);
    const body = await request.json() as { query?: string; limit?: number };
    const query = body.query?.trim() ?? "";
    if (!query) return Response.json({ error: "query_required" }, { status: 400 });
    const scores = await modelGateway.rerank(query, corpus.map((item) => item.excerpt));
    const results = corpus.map((item, index) => ({ ...item, score: scores[index] })).sort((a, b) => b.score - a.score).slice(0, Math.min(body.limit ?? 5, 10));
    return Response.json({ query, retrieval: "keyword+vector+rerank", results });
  } catch (error) { return apiError(error); }
}