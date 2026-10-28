import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { changeDictation, readDictation, startDictation } from "../../../../lib/dictation-service";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const context = await platformContext(request); return Response.json(await readDictation(context, (new URL(request.url).searchParams.get("sessionId") ?? "").slice(0, 36)), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request); let body: unknown; try { body = await request.json(); } catch { throw new Error("invalid_dictation_body"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_dictation_body"); const input = body as Record<string, unknown>;
    if (input.action === "start" || input.action === "retry") return Response.json(await startDictation(context, input), { headers });
    return Response.json(await changeDictation(context, input), { headers });
  } catch (reason) { return platformApiError(reason); }
}
