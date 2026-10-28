import { archiveDialogueScenario, continueDialogue, publishDialogueScenario, readDialogueCatalog, startDialogueSession } from "../../../../lib/dialogue-service";
import { platformApiError, platformContext } from "../../../../lib/platform-store";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await platformContext(request); const query = new URL(request.url).searchParams;
    const view = query.get("view") ?? "student";
    if (view !== "student" && view !== "teacher") throw new Error("invalid_dialogue_view");
    return Response.json(await readDialogueCatalog(context, view === "teacher", query.get("sessionId")?.slice(0, 36) ?? ""), { headers });
  } catch (error) { return platformApiError(error); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    let value: unknown; try { value = await request.json(); } catch { throw new Error("invalid_dialogue_body"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_dialogue_body");
    const body = value as Record<string, unknown>;
    if (body.action === "publish") return Response.json(await publishDialogueScenario(context, body), { headers });
    if (body.action === "archive") return Response.json(await archiveDialogueScenario(context, body), { headers });
    if (body.action === "start") return Response.json(await startDialogueSession(context, body), { headers });
    if (body.action === "send" || body.action === "hint") return Response.json(await continueDialogue(context, body), { headers });
    throw new Error("invalid_dialogue_action");
  } catch (error) { return platformApiError(error); }
}
