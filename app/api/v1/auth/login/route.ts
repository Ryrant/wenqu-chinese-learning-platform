import { env } from "cloudflare:workers";
import { createSessionToken, sessionCookieName } from "../../../../lib/auth-token";
import { getAuthMode } from "../../../../lib/platform-store";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 1_024;
const loginAttempts = new Map<string, { failures: number; resetAt: number }>();

function json(error: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function clientKey(request: Request) {
  return request.headers.get("CF-Connecting-IP")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function retryAfter(key: string, now: number) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return 0;
  if (attempt.resetAt <= now) {
    loginAttempts.delete(key);
    return 0;
  }
  return attempt.failures >= LOGIN_ATTEMPT_LIMIT
    ? Math.max(1, Math.ceil((attempt.resetAt - now) / 1000))
    : 0;
}

function recordFailedLogin(key: string, now: number) {
  const current = loginAttempts.get(key);
  loginAttempts.set(key, current && current.resetAt > now
    ? { failures: current.failures + 1, resetAt: current.resetAt }
    : { failures: 1, resetAt: now + LOGIN_ATTEMPT_WINDOW_MS });

  if (loginAttempts.size <= MAX_TRACKED_CLIENTS) return;
  for (const [trackedKey, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(trackedKey);
  }
  while (loginAttempts.size > MAX_TRACKED_CLIENTS) {
    const oldestKey = loginAttempts.keys().next().value;
    if (!oldestKey) break;
    loginAttempts.delete(oldestKey);
  }
}

function cookieValue(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function POST(request: Request) {
  if (getAuthMode() !== "standard") return json("auth_mode_not_standard", 404);
  const bindings = env as unknown as { ADMIN_EMAIL?: string; ADMIN_DISPLAY_NAME?: string; ADMIN_PASSWORD?: string; JWT_SECRET?: string; JWT_TTL_SECONDS?: string };
  if (!bindings.ADMIN_EMAIL || !bindings.ADMIN_PASSWORD || !bindings.JWT_SECRET) return json("authentication_config_missing", 500);
  const key = clientKey(request);
  const nowMilliseconds = Date.now();
  const retryAfterSeconds = retryAfter(key, nowMilliseconds);
  if (retryAfterSeconds) return json("too_many_attempts", 429, { "Retry-After": String(retryAfterSeconds) });
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (email !== bindings.ADMIN_EMAIL.trim().toLowerCase() || password !== bindings.ADMIN_PASSWORD) {
    recordFailedLogin(key, nowMilliseconds);
    return json("invalid_credentials", 401);
  }
  loginAttempts.delete(key);
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
