import { readFamilyPortfolio } from "../../../../lib/family-portfolio-service";
import { workspacePasswordChangeGate } from "../../../../lib/password-change-state";
import { getAuthMode, platformApiError, platformContext } from "../../../../lib/platform-store";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const passwordChangeGate = workspacePasswordChangeGate(getAuthMode(), context);
    if (passwordChangeGate) return passwordChangeGate;
    const studentId = new URL(request.url).searchParams.get("studentId");
    if (studentId !== null && (!studentId.trim() || studentId.length > 120)) throw new Error("invalid_student_id");
    return Response.json(await readFamilyPortfolio(context, studentId ?? undefined), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformApiError(error); }
}
