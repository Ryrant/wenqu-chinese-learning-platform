import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { readPracticeOverview } from "../../../../../lib/practice-overview-service";
import { readPracticeDetail } from "../../../../../lib/practice-history-service";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request); const query = new URL(request.url).searchParams;
    const data = query.has("recordId") || query.has("recordKind") ? await readPracticeDetail(context, query.get("recordKind") ?? "", query.get("recordId") ?? "") : await readPracticeOverview(context, query);
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  }
  catch (reason) { return platformApiError(reason); }
}
