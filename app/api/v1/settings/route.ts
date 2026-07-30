import { loadPlatformSettings, publicPlatformSettings, savePlatformSettings } from "../../../lib/platform-settings";
import { platformApiError, platformContext } from "../../../lib/platform-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request, "admin");
    return Response.json(publicPlatformSettings(await loadPlatformSettings(context.db)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "admin");
    const payload = await request.json().catch(() => ({}));
    return Response.json(await savePlatformSettings(context.db, payload), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformApiError(error);
  }
}
