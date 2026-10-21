import { platformApiError, platformContext } from "../../../../../lib/platform-store";
import { changeAccountPassword } from "../../../../../lib/password-change";
import { createSessionToken, sessionCookieName } from "../../../../../lib/auth-token";
import { loadPlatformSettings } from "../../../../../lib/platform-settings";
import { ensureSiteJwtSecret } from "../../../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, undefined, { allowPasswordChange: true });
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return Response.json({ error: "weak_password" }, { status: 400 });
    }
    const changed = await changeAccountPassword({
      db: context.db,
      tenantId: context.tenantId,
      userId: context.userId,
      currentPassword,
      newPassword,
    });
    if (!changed) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }
    const settings = await loadPlatformSettings(context.db);
    const now = Math.floor(Date.now() / 1000);
    const token = await createSessionToken({ email: context.userEmail, displayName: context.displayName, iat: now, exp: now + settings.jwtTtlSeconds, sessionVersion: changed.sessionVersion }, await ensureSiteJwtSecret(context.db));
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json({ changed: true }, { headers: {
      "cache-control": "no-store",
      "set-cookie": `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${settings.jwtTtlSeconds}${secure}`,
    } });
  } catch (error) {
    return platformApiError(error);
  }
}
