import { env } from "cloudflare:workers";
import { createSessionToken, sessionCookieName } from "../../../../lib/auth-token";
import { getAuthMode } from "../../../../lib/platform-store";

function json(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function cookieValue(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function POST(request: Request) {
  if (getAuthMode() !== "standard") return json("auth_mode_not_standard", 404);
  const bindings = env as unknown as { ADMIN_EMAIL?: string; ADMIN_DISPLAY_NAME?: string; ADMIN_PASSWORD?: string; JWT_SECRET?: string; JWT_TTL_SECONDS?: string };
  if (!bindings.ADMIN_EMAIL || !bindings.ADMIN_PASSWORD || !bindings.JWT_SECRET) return json("authentication_config_missing", 500);
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (email !== bindings.ADMIN_EMAIL.trim().toLowerCase() || password !== bindings.ADMIN_PASSWORD) return json("invalid_credentials", 401);
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number.parseInt(bindings.JWT_TTL_SECONDS ?? "604800", 10);
  const maxAge = Number.isFinite(ttl) && ttl > 0 ? ttl : 604800;
  const displayName = bindings.ADMIN_DISPLAY_NAME?.trim() || email.split("@")[0];
  const token = await createSessionToken({ email, displayName, iat: now, exp: now + maxAge }, bindings.JWT_SECRET);
  return Response.json({ user: { email, displayName } }, {
    status: 200,
    headers: { "cache-control": "no-store", "set-cookie": cookieValue(token, maxAge) },
  });
}
