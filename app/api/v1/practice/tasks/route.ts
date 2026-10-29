import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { changePracticeTask, readPracticeTasks } from "../../../../../lib/practice-task-service";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try { return Response.json(await readPracticeTasks(await platformContext(request), new URL(request.url).searchParams), { headers }); }
  catch (reason) { return platformApiError(reason); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request); let body: unknown;
    try { body = await request.json(); } catch { throw new Error("invalid_practice_task_body"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_practice_task_body");
    return Response.json(await changePracticeTask(context, body as Record<string, unknown>), { headers });
  } catch (reason) { return platformApiError(reason); }
}
