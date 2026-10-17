import { platformApiError, platformContext } from "../../../lib/platform-store";
import { createStudentSubmission } from "../../../lib/submission-service";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "student");
    const body = await request.json() as { assignmentId?: string; textAnswer?: string; assetKey?: string; familyTaskId?: string };
    if (!body.assignmentId || (!body.textAnswer?.trim() && !body.assetKey)) return Response.json({ error: "assignment_and_answer_required" }, { status: 400 });
    const result = await createStudentSubmission(context.db, context, body as { assignmentId: string; textAnswer?: string; assetKey?: string; familyTaskId?: string });
    return Response.json({ ...result, message: "已提交教师复核；平台不会伪造自动分数。" }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
