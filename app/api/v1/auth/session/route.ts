import { getAuthMode, platformContext } from "../../../../lib/platform-store";
import { needsPasswordChange } from "../../../../lib/password-change-state";

export async function GET(request: Request) {
  const authMode = getAuthMode();
  try {
    const context = await platformContext(request);
    return Response.json({
      authenticated: true,
      authMode,
      user: { email: context.userEmail, displayName: context.displayName, roles: context.roles, mustChangePassword: needsPasswordChange(context) },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = message === "authentication_required" ? 200 : 500;
    return Response.json({ authenticated: false, authMode, error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
