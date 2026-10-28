import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { readPracticeHistory, savePractice } from "../../../../lib/practice-service";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const context = await platformContext(request); const query = new URL(request.url).searchParams; return Response.json(await readPracticeHistory(context, query.get("kind") ?? "", (query.get("referenceId") ?? "").slice(0, 120), query.get("journeyRunId") ?? ""), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    let body: unknown; try { body = await request.json(); } catch { throw new Error("invalid_practice_body"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_practice_body");
    return Response.json(await savePractice(context, body as Record<string, unknown>), { headers });
  } catch (reason) { return platformApiError(reason); }
}
