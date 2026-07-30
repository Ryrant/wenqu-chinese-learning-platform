import { env } from "cloudflare:workers";
import { createSessionToken, sessionCookieName } from "../../../../lib/auth-token";
import { getAuthMode } from "../../../../lib/platform-store";
import { hashPassword, verifyPassword } from "../../../../lib/auth-password";

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

function idPart(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

export async function POST(request: Request) {
  if (getAuthMode() !== "standard") return json("auth_mode_not_standard", 404);
  const bindings = env as unknown as { DB?: D1Database; ADMIN_EMAIL?: string; ADMIN_DISPLAY_NAME?: string; ADMIN_PASSWORD?: string; JWT_SECRET?: string; JWT_TTL_SECONDS?: string };
  if (!bindings.DB || !bindings.ADMIN_EMAIL || !bindings.ADMIN_PASSWORD || !bindings.JWT_SECRET) return json("authentication_config_missing", 500);
  const key = clientKey(request);
  const nowMilliseconds = Date.now();
  const retryAfterSeconds = retryAfter(key, nowMilliseconds);
  if (retryAfterSeconds) return json("too_many_attempts", 429, { "Retry-After": String(retryAfterSeconds) });
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const account = await bindings.DB.prepare(`
    SELECT u.id,u.email,u.display_name AS displayName,u.password_hash AS passwordHash,
           u.must_change_password AS mustChangePassword
    FROM users u
    WHERE lower(u.email)=? AND u.status='active'
    LIMIT 1
  `).bind(email).first<{ id: string; email: string; displayName: string; passwordHash: string | null; mustChangePassword: number }>();
  const bootstrapEmail = bindings.ADMIN_EMAIL.trim().toLowerCase();
  let authenticatedAccount = account;
  if (!authenticatedAccount && email === bootstrapEmail) {
    const bootstrapCredentialsValid = password === bindings.ADMIN_PASSWORD;
    if (bootstrapCredentialsValid) {
      const userId = `usr_${idPart(email)}`;
      const tenantId = `tenant_${idPart(email)}`;
      const displayName = bindings.ADMIN_DISPLAY_NAME?.trim() || email.split("@")[0];
      const passwordHash = await hashPassword(password);
      await bindings.DB.batch([
        bindings.DB.prepare("INSERT OR IGNORE INTO tenants (id,name,region,status) VALUES (?,?,'sg','active')").bind(tenantId, "华文趣味试用学校"),
        bindings.DB.prepare("INSERT OR IGNORE INTO users (id,email,display_name,password_hash,must_change_password,status) VALUES (?,?,?,?,0,'active')").bind(userId, email, displayName, passwordHash),
        bindings.DB.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role,status) VALUES (?,?,?,'active')").bind(tenantId, userId, "admin"),
      ]);
      authenticatedAccount = { id: userId, email, displayName, passwordHash, mustChangePassword: 0 };
    }
  }
  if (!authenticatedAccount || !(account ? await verifyPassword(password, account.passwordHash ?? "") : true)) {
    recordFailedLogin(key, nowMilliseconds);
    return json("invalid_credentials", 401);
  }
  loginAttempts.delete(key);
  await bindings.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(authenticatedAccount.id).run();
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number.parseInt(bindings.JWT_TTL_SECONDS ?? "604800", 10);
  const maxAge = Number.isFinite(ttl) && ttl > 0 ? ttl : 604800;
  const displayName = authenticatedAccount.displayName;
  const mustChangePassword = authenticatedAccount.mustChangePassword === 1;
  const token = await createSessionToken({ email: authenticatedAccount.email, displayName, iat: now, exp: now + maxAge }, bindings.JWT_SECRET);
  return Response.json({ user: { email: authenticatedAccount.email, displayName, mustChangePassword } }, {
    status: 200,
    headers: { "cache-control": "no-store", "set-cookie": cookieValue(token, maxAge) },
  });
}
