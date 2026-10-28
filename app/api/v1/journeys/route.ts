import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { readJourneyCatalog, startJourney } from "../../../../lib/journey-service";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const context = await platformContext(request); return Response.json(await readJourneyCatalog(context, (new URL(request.url).searchParams.get("runId") ?? "").slice(0, 36)), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    let body: unknown; try { body = await request.json(); } catch { throw new Error("invalid_journey_body"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || (body as Record<string, unknown>).action !== "start") throw new Error("invalid_journey_body");
    return Response.json(await startJourney(context, body as Record<string, unknown>), { headers });
  } catch (reason) { return platformApiError(reason); }
}
