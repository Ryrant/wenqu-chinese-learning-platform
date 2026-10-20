import { workspacePasswordChangeGate } from "../../../../lib/password-change-state";
import { getAuthMode, platformApiError, platformContext } from "../../../../lib/platform-store";
import { readStudentCase } from "../../../../lib/student-case-service";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const gate = workspacePasswordChangeGate(getAuthMode(), context); if (gate) return gate;
    const url = new URL(request.url); const view = url.searchParams.get("view"); const studentId = url.searchParams.get("studentId");
    if (view !== "student" && view !== "guardian" && view !== "teaching") throw new Error("invalid_student_case_view");
    if (studentId !== null && (!studentId.trim() || studentId.length > 120)) throw new Error("invalid_student_id");
    return Response.json(await readStudentCase(context, view, studentId ?? undefined), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformApiError(error); }
}
