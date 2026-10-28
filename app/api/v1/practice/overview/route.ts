import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { readPracticeOverview } from "../../../../../lib/practice-overview-service";

export async function GET(request: Request) {
  try { return Response.json(await readPracticeOverview(await platformContext(request)), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (reason) { return platformApiError(reason); }
}
