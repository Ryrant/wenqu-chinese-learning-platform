import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { readClassroomPractice } from "../../../../../lib/practice-classroom-service";
export async function GET(request: Request) {
  try { return Response.json(await readClassroomPractice(await platformContext(request), new URL(request.url).searchParams), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (reason) { return platformApiError(reason); }
}
