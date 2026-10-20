import { resolveWorkspaceAction } from "../../../../lib/commands";
import { requireText, type ActionBody } from "../../../../lib/commands/shared";
import { workspaceActionRole, type WorkspaceActionName } from "../../../../lib/workspace-actions";
import { platformApiError, platformContext } from "../../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as ActionBody;
    const action = requireText(body.action, "action", 60);
    const context = await platformContext(request, workspaceActionRole(action));
    const command = resolveWorkspaceAction(action);
    if (!command) return Response.json({ error: "unsupported_action" }, { status: 400 });
    return await command(body, context, action as WorkspaceActionName);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid_")) return Response.json({ error: error.message }, { status: 400 });
    return platformApiError(error);
  }
}
