import { modelGateway, type Citation } from "../../../../lib/model-gateway";
import { apiError, requestContext } from "../../../../lib/request-context";

export async function POST(request: Request) {
  try {
    requestContext(request);
    const body = await request.json() as { prompt?: string; purpose?: "lesson" | "tutor" | "report"; level?: string; citations?: Citation[] };
    const prompt = body.prompt?.trim();
    if (!prompt || prompt.length > 4000) return Response.json({ error: "prompt_required_or_too_long" }, { status: 400 });
    const moderation = await modelGateway.moderate(prompt);
    if (!moderation.safe) return Response.json({ error: "content_requires_review", labels: moderation.labels }, { status: 422 });
    const result = await modelGateway.generate({ prompt, purpose: body.purpose ?? "tutor", level: body.level ?? "A2", citations: body.citations });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ provider: result.provider, model: result.model, safety: result.safety })}\n\n`));
        for (const paragraph of result.text.split("\n\n")) controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ text: paragraph + "\n\n" })}\n\n`));
        controller.enqueue(encoder.encode(`event: citations\ndata: ${JSON.stringify(result.citations)}\n\n`));
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" } });
  } catch (error) { return apiError(error); }
}