import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { answerVocabularyReview, readVocabularyReview, startVocabularyReview } from "../../../../lib/vocabulary-review-service";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const context = await platformContext(request); return Response.json(await readVocabularyReview(context, (new URL(request.url).searchParams.get("sessionId") ?? "").slice(0, 36)), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    let body: unknown; try { body = await request.json(); } catch { throw new Error("invalid_vocabulary_review_body"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_vocabulary_review_body");
    const input = body as Record<string, unknown>;
    if (input.action === "start") return Response.json(await startVocabularyReview(context, input), { headers });
    if (input.action === "answer" || input.action === "finish") return Response.json(await answerVocabularyReview(context, input), { headers });
    throw new Error("invalid_vocabulary_review_action");
  } catch (reason) { return platformApiError(reason); }
}
