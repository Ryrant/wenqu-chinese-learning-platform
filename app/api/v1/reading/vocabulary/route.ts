import { changeReadingVocabulary, readReadingVocabulary } from "../../../../../lib/reading-vocabulary-service";
import { platformApiError, platformContext } from "../../../../../lib/platform-store";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const context = await platformContext(request, "student"); return Response.json({ vocabulary: await readReadingVocabulary(context) }, { headers }); }
  catch (error) { return platformApiError(error); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "student");
    let body: unknown; try { body = await request.json(); } catch { throw new Error("invalid_reading_body"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_reading_body");
    return Response.json(await changeReadingVocabulary(context, body as Record<string, unknown>), { headers });
  } catch (error) { return platformApiError(error); }
}
