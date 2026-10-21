import { createSessionToken, sessionCookieName } from "../../../../../lib/auth-token";
import { loadPlatformSettings } from "../../../../../lib/platform-settings";
import { ensurePlatformSchema, ensureSiteJwtSecret, getAuthMode } from "../../../../../lib/platform-store";
import { ensurePlatformRuntime } from "../../../../../lib/platform-runtime";
import { authenticateStandardAccount } from "../../../../../lib/standard-login";
import { auditStatement } from "../../../../../lib/audit";
import { loginClientIp, recordFailedLoginAudit } from "../../../../../lib/login-audit";

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 1_024;
const loginAttempts = new Map<string, { failures: number; resetAt: number }>();

function json(error: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });
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

export async function POST(request: Request, remoteAddress?: string) {
  if (getAuthMode() !== "standard") return json("auth_mode_not_standard", 404);
  const runtime = await ensurePlatformRuntime();
  const db = runtime.database;
  if (!db) return json("database_unavailable", 500);
  await ensurePlatformSchema(db);
  const ip = loginClientIp(request, runtime.kind, remoteAddress);
  const key = ip ?? "unknown";
  const nowMilliseconds = Date.now();
  const retryAfterSeconds = retryAfter(key, nowMilliseconds);
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  const auditDetail = { email, ip, userAgent: request.headers.get("user-agent")?.slice(0, 512) || null };
  if (retryAfterSeconds) {
    await recordFailedLoginAudit(db, auditDetail, "too_many_attempts");
    return json("too_many_attempts", 429, { "Retry-After": String(retryAfterSeconds) });
  }
  const account = await authenticateStandardAccount({
    db,
    email,
    password,
  });
  if (!account) {
    recordFailedLogin(key, nowMilliseconds);
    await recordFailedLoginAudit(db, auditDetail, "invalid_credentials");
    return json("invalid_credentials", 401);
  }
  const membership = await db.prepare(`SELECT rm.tenant_id AS tenantId FROM role_memberships rm
    JOIN tenants t ON t.id=rm.tenant_id AND t.status='active'
    WHERE rm.user_id=? AND rm.status='active' AND rm.role IN ('student','teacher','guardian','admin')
    ORDER BY rm.created_at ASC,rm.id ASC LIMIT 1`)
    .bind(account.id).first<{ tenantId: string }>();
  if (!membership) {
    await recordFailedLoginAudit(db, auditDetail, "account_access_denied");
    return json("account_access_denied", 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const settings = await loadPlatformSettings(db);
  const maxAge = settings.jwtTtlSeconds;
  const displayName = account.displayName;
  const mustChangePassword = account.mustChangePassword === 1;
  const jwtSecret = await ensureSiteJwtSecret(db);
  const token = await createSessionToken({ email: account.email, displayName, iat: now, exp: now + maxAge, sessionVersion: account.sessionVersion }, jwtSecret);
  await db.batch([
    db.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(account.id),
    auditStatement(db, membership.tenantId, account.id, "auth.login_succeeded", "user", account.id, { ...auditDetail, result: "success" }),
  ]);
  loginAttempts.delete(key);
  return Response.json({ user: { email: account.email, displayName, mustChangePassword } }, {
    status: 200,
    headers: { "cache-control": "no-store", "set-cookie": cookieValue(token, maxAge) },
  });
}
