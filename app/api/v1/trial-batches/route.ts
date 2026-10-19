import { createTrialBatch, linkTrialBatch, readBatchCatalog, voidTrialBatch } from "../../../lib/trial-batch-service";
import { workspacePasswordChangeGate } from "../../../lib/password-change-state";
import { getAuthMode, platformApiError, platformContext } from "../../../lib/platform-store";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await platformContext(request, "teacher"); const gate = workspacePasswordChangeGate(getAuthMode(), context); if (gate) return gate;
    return Response.json(await readBatchCatalog(context), { headers });
  } catch (error) { return platformApiError(error); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "teacher"); const gate = workspacePasswordChangeGate(getAuthMode(), context); if (gate) return gate;
    let value: unknown; try { value = await request.json(); } catch { throw new Error("invalid_trial_batch_body"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_trial_batch_body");
    const body = value as Record<string, unknown>;
    if (body.action === "create") return Response.json(await createTrialBatch(context, body), { status: 201, headers });
    if (body.action === "link") return Response.json(await linkTrialBatch(context, body), { headers });
    if (body.action === "void") return Response.json(await voidTrialBatch(context, body), { headers });
    throw new Error("invalid_trial_batch_action");
  } catch (error) { return platformApiError(error); }
}
