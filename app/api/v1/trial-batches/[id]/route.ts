import { readTrialBatch } from "../../../../lib/trial-batch-service";
import { workspacePasswordChangeGate } from "../../../../lib/password-change-state";
import { getAuthMode, platformApiError, platformContext } from "../../../../lib/platform-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await platformContext(request, "teacher"); const gate = workspacePasswordChangeGate(getAuthMode(), context); if (gate) return gate;
    const { id } = await params; if (!id || id.length > 120) throw new Error("invalid_trial_batch_id");
    return Response.json(await readTrialBatch(context, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformApiError(error); }
}
