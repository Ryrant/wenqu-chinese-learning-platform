import { env } from "cloudflare:workers";
import { createSessionToken, sessionCookieName } from "../../../../lib/auth-token";
import { loadPlatformSettings } from "../../../../lib/platform-settings";
import { ensurePlatformSchema, ensureSiteJwtSecret, getAuthMode, isInitialSetupRequired, seedInitialWorkspace } from "../../../../lib/platform-store";
import { createInitialAdminAccount } from "../../../../lib/standard-login";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(error: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function cookieValue(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function POST(request: Request) {
  if (getAuthMode() !== "standard") return json("auth_mode_not_standard", 404);
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) return json("database_unavailable", 500);
  await ensurePlatformSchema(bindings.DB);
  if (!(await isInitialSetupRequired(bindings.DB))) return json("setup_closed", 409);

  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown; displayName?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const displayName = typeof payload?.displayName === "string" ? payload.displayName.trim() : "";
  if (!EMAIL_PATTERN.test(email)) return json("invalid_email", 400);
  if (password.length < 8) return json("password_too_short", 400);

  const account = await createInitialAdminAccount({ db: bindings.DB, email, password, displayName });
  if (!account) return json("setup_closed", 409);
  await seedInitialWorkspace({ db: bindings.DB, tenantId: `tenant_${account.id.slice("usr_".length)}`, userId: account.id, userEmail: account.email, displayName: account.displayName });

  const now = Math.floor(Date.now() / 1000);
  const settings = await loadPlatformSettings(bindings.DB);
  const maxAge = settings.jwtTtlSeconds;
  const token = await createSessionToken({ email: account.email, displayName: account.displayName, iat: now, exp: now + maxAge }, await ensureSiteJwtSecret(bindings.DB));
  return Response.json({ user: { email: account.email, displayName: account.displayName, roles: ["student", "teacher", "guardian", "admin"], mustChangePassword: false } }, {
    status: 200,
    headers: { "cache-control": "no-store", "set-cookie": cookieValue(token, maxAge) },
  });
}
