import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { changeReadingLesson, readReadingCatalog } from "../../../../../lib/reading-content-service";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { const context = await platformContext(request); const view = new URL(request.url).searchParams.get("view") ?? "student"; if (!["student", "teacher"].includes(view)) throw new Error("invalid_reading_lesson_view"); return Response.json(await readReadingCatalog(context, view === "teacher"), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
export async function POST(request: Request) {
  try { const context = await platformContext(request); let body: unknown; try { body = await request.json(); } catch { throw new Error("invalid_reading_lesson_body"); } if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_reading_lesson_body"); return Response.json(await changeReadingLesson(context, body as Record<string, unknown>), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
