import { getAuthMode, platformApiError, platformContext } from "../../../../lib/platform-store";
import { workspacePasswordChangeGate } from "../../../../lib/password-change-state";
import { parseWorkspaceSections, readWorkspace } from "../../../../lib/workspace-service";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const passwordChangeGate = workspacePasswordChangeGate(getAuthMode(), context);
    if (passwordChangeGate) return passwordChangeGate;
    const params = new URL(request.url).searchParams;
    const data = await readWorkspace(context, {
      sections: parseWorkspaceSections(params.get("include")),
      studentId: params.get("studentId") ?? undefined,
    });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformApiError(error);
  }
}
