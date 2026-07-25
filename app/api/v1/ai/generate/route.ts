import { platformApiError, platformContext } from "../../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    if (!context.roles.some((role) => role === "student" || role === "teacher" || role === "admin")) throw new Error("forbidden");
    const body = await request.json() as { prompt?: string; purpose?: string; level?: string };
    const prompt = body.prompt?.trim().slice(0, 4000) ?? "";
    if (!prompt) return Response.json({ error: "prompt_required" }, { status: 400 });
    if (/自残|色情|仇恨|暴力细节/.test(prompt)) return Response.json({ error: "content_requires_review" }, { status: 422 });
    const rows = await context.db.prepare(`SELECT k.id,k.content,d.title FROM knowledge_chunks k JOIN source_documents d ON d.id=k.source_document_id AND d.tenant_id=k.tenant_id WHERE k.tenant_id=? AND k.published=1 AND d.processing_status='published' ORDER BY CASE WHEN k.content LIKE ? THEN 0 ELSE 1 END LIMIT 5`).bind(context.tenantId, `%${prompt.slice(0, 8)}%`).all<{ id: string; content: string; title: string }>();
    const citations = rows.results.map((row) => ({ id: row.id, title: row.title, source: row.title, excerpt: row.content }));
    const text = citations.length
      ? `教学草稿：${prompt}\n\n学习目标：学生能用完整句表达主题内容，并说明一个文化或生活线索。\n\n活动一：观察与提问；活动二：基于已审核来源共读；活动三：同伴口语任务；活动四：教师审核出口任务。\n\n引用来源：${citations.map((item, index) => `[${index + 1}] ${item.title}`).join("；")}`
      : "未找到已审核来源，本次不生成知识型内容，请先在内容中心发布可靠资料。";
    const sessionId = crypto.randomUUID();
    await context.db.prepare("INSERT INTO ai_sessions (id,tenant_id,user_id,purpose,provider,model,status) VALUES (?,?,?,?,?,?,?)").bind(sessionId, context.tenantId, context.userId, body.purpose ?? "lesson", "local", "source-grounded-template", citations.length ? "completed" : "review_required").run();
    if (citations.length) await context.db.batch(citations.map((item) => context.db.prepare("INSERT INTO citations (id,tenant_id,ai_session_id,knowledge_chunk_id,quote) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, sessionId, item.id, item.excerpt.slice(0, 500))));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ provider: "local", model: "source-grounded-template", safety: citations.length ? "pass" : "review", sessionId })}\n\n`));
      for (const paragraph of text.split("\n\n")) controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ text: `${paragraph}\n\n` })}\n\n`));
      controller.enqueue(encoder.encode(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`));
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n")); controller.close();
    }});
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) { return platformApiError(error); }
}
