import { workspacePasswordChangeGate } from "../../../lib/password-change-state";
import { getAuthMode, platformApiError, platformContext } from "../../../lib/platform-store";
import { readTeachingFollowups } from "../../../lib/teaching-followup-service";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request, "teacher");
    const gate = workspacePasswordChangeGate(getAuthMode(), context);
    if (gate) return gate;
    return Response.json(await readTeachingFollowups(context), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformApiError(error); }
}
