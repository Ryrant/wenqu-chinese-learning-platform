import { env } from "cloudflare:workers";
import { ensurePlatformSchema, getAuthMode, isInitialSetupRequired, platformContext } from "../../../../lib/platform-store";
import { sessionPasswordChangeState } from "../../../../lib/password-change-state";

export async function GET(request: Request) {
  const authMode = getAuthMode();
  try {
    if (authMode === "standard") {
      const db = (env as unknown as { DB?: D1Database }).DB;
      if (db) {
        await ensurePlatformSchema(db);
        if (await isInitialSetupRequired(db)) {
          return Response.json({ authenticated: false, authMode, setupRequired: true }, { headers: { "cache-control": "no-store" } });
        }
      }
    }
    const context = await platformContext(request);
    return Response.json({
      authenticated: true,
      authMode,
      user: { email: context.userEmail, displayName: context.displayName, roles: context.roles, ...sessionPasswordChangeState(context) },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = message === "authentication_required" ? 200 : 500;
    return Response.json({ authenticated: false, authMode, error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
