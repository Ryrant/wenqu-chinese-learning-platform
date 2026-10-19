import type { FeedbackFields } from "../../../lib/family-feedback-types";
import { readFamilyFeedback, recordFamilyFeedback, voidFamilyFeedback } from "../../../lib/family-feedback-service";
import { workspacePasswordChangeGate } from "../../../lib/password-change-state";
import { getAuthMode, platformApiError, platformContext } from "../../../lib/platform-store";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const gate = workspacePasswordChangeGate(getAuthMode(), context); if (gate) return gate;
    const url = new URL(request.url); const view = url.searchParams.get("view"); const studentId = url.searchParams.get("studentId") ?? undefined;
    if (view !== "guardian" && view !== "teaching") throw new Error("invalid_family_feedback_view");
    if (studentId !== undefined && (!studentId.trim() || studentId.length > 120 || view !== "guardian")) throw new Error("invalid_student_id");
    return Response.json(await readFamilyFeedback(context, view, studentId), { headers });
  } catch (error) { return platformApiError(error); }
}
export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    const gate = workspacePasswordChangeGate(getAuthMode(), context); if (gate) return gate;
    let value: unknown;
    try { value = await request.json(); } catch { throw new Error("invalid_family_feedback_body"); }
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_family_feedback_body");
    const body = value as { action?: unknown; id?: unknown; taskId?: unknown; revision?: unknown; reason?: unknown } & FeedbackFields;
    if (typeof body.id !== "string" || !body.id || body.id.length > 120) throw new Error("invalid_family_feedback_id");
    if (body.action === "void") return Response.json(await voidFamilyFeedback(context, { id: body.id, reason: body.reason as string }), { headers });
    if (body.action !== "record" || typeof body.taskId !== "string" || !body.taskId || body.taskId.length > 120) throw new Error("invalid_family_feedback_task");
    return Response.json(await recordFamilyFeedback(context, { id: body.id, taskId: body.taskId, revision: body.revision as number,
      participation: body.participation, instructions: body.instructions, operationHelp: body.operationHelp, alternative: body.alternative, note: body.note }), { status: 201, headers });
  } catch (error) { return platformApiError(error); }
}
