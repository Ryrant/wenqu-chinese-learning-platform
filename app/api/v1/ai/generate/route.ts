import { generateGroundedText } from "../../../../lib/ai/grounding";
import type { AiPurpose } from "../../../../lib/ai/provider";
import { aiProviderSettings, loadPlatformSettings } from "../../../../lib/platform-settings";
import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { searchPublishedKnowledge } from "../../../../lib/retrieval";

const purposes = new Set<AiPurpose>(["tutor", "lesson", "review"]);

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    const role = context.roles.find((item) => item === "student" || item === "teacher" || item === "admin");
    if (!role) throw new Error("forbidden");
    const body = await request.json() as { prompt?: string; purpose?: string; level?: string };
    const prompt = body.prompt?.trim().slice(0, 4000) ?? "";
    const purpose = purposes.has(body.purpose as AiPurpose) ? body.purpose as AiPurpose : "tutor";
    if (!prompt) return Response.json({ error: "prompt_required" }, { status: 400 });
    if (/自残|色情|仇恨|暴力细节/.test(prompt)) return Response.json({ error: "content_requires_review" }, { status: 422 });
    const contextChunks = await searchPublishedKnowledge(context.db, { tenantId: context.tenantId, query: prompt, limit: 5 });
    if (!contextChunks.length) return Response.json({ error: "no_reviewed_sources" }, { status: 422 });
    const settings = await loadPlatformSettings(context.db);
    const result = await generateGroundedText(
      { purpose, prompt, contextChunks, role, level: body.level?.trim().slice(0, 20) },
      aiProviderSettings(settings),
    );
    const sessionId = crypto.randomUUID();
    await context.db.prepare("INSERT INTO ai_sessions (id,tenant_id,user_id,purpose,provider,model,status,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(sessionId, context.tenantId, context.userId, purpose, result.provider, result.model, result.status, result.inputTokens, result.outputTokens).run();
    if (result.citations.length) await context.db.batch(result.citations.map((item) => context.db.prepare("INSERT INTO citations (id,tenant_id,ai_session_id,knowledge_chunk_id,quote) VALUES (?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.tenantId, sessionId, item.id, item.excerpt.slice(0, 500))));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ provider: result.provider, model: result.model, status: result.status, safety: "pass", sessionId })}\n\n`));
      for (const paragraph of result.text.split("\n\n")) controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ text: `${paragraph}\n\n` })}\n\n`));
      controller.enqueue(encoder.encode(`event: citations\ndata: ${JSON.stringify(result.citations)}\n\n`));
      controller.enqueue(encoder.encode("event: done\ndata: {}\n\n")); controller.close();
    }});
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) { return platformApiError(error); }
}
