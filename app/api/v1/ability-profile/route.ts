import { readAbilityProfile } from "../../../../lib/ability-profile-service";
import { platformApiError, platformContext } from "../../../../lib/platform-store";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const studentId = new URL(request.url).searchParams.get("studentId")?.trim() || context.userId;
    return Response.json(await readAbilityProfile(context, studentId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return platformApiError(error); }
}
