import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { createApiApp } from './server/app';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createInitialAdminAccount } from './lib/standard-login';
    export { createSessionToken } from './lib/auth-token';
    export { loginClientIp } from './lib/login-audit';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=login-audit-test-bundle.mjs`).toString("base64")}`);
const email = "admin@audit.example", password = "AuditPassword123";
let fixtureNumber = 0;

async function fixture(t) {
  const previousNodeEnv = process.env.NODE_ENV, previousProxy = process.env.HUAWEN_ZHIXING_TRUST_PROXY;
  process.env.NODE_ENV = "production";
  delete process.env.HUAWEN_ZHIXING_TRUST_PROXY;
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: null });
  t.after(() => {
    db.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousProxy === undefined) delete process.env.HUAWEN_ZHIXING_TRUST_PROXY; else process.env.HUAWEN_ZHIXING_TRUST_PROXY = previousProxy;
  });
  await api.ensurePlatformSchema(db);
  const account = await api.createInitialAdminAccount({ db, email, password });
  const { tenant_id: tenantId } = await db.prepare("SELECT tenant_id FROM role_memberships WHERE user_id=?").bind(account.id).first();
  const remoteAddress = `198.51.100.${++fixtureNumber}`;
  const app = api.createApiApp({ remoteAddress: () => remoteAddress });
  const request = (path, { method = "GET", cookie, json, headers = {} } = {}) => app.fetch(new Request(`http://127.0.0.1${path}`, {
    method, headers: { ...headers, ...(cookie ? { cookie } : {}), ...(json === undefined ? {} : { "content-type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  }));
  const secret = await api.ensureSiteJwtSecret(db), now = Math.floor(Date.now() / 1000);
  const token = await api.createSessionToken({ email, displayName: account.displayName, sessionVersion: 0, iat: now, exp: now + 3600 }, secret);
  const cookie = `huawen_zhixing_session=${encodeURIComponent(token)}`;
  const login = (json = { email, password }, headers = {}) => request("/api/v1/auth/login", { method: "POST", json, headers });
  const audits = () => db.prepare("SELECT * FROM audit_logs ORDER BY created_at,id").all().then((rows) => rows.results);
  return { db, app, account, tenantId, cookie, remoteAddress, request, login, audits };
}

test("成功登录持久记录账号、真实来源、浏览器和时间，机构审计两种读取方式都可查看", async (t) => {
  const f = await fixture(t);
  const response = await f.login({ email: `  ${email.toUpperCase()}  `, password }, {
    "user-agent": "Audit Browser/1.0", "x-forwarded-for": "203.0.113.99", "cf-connecting-ip": "203.0.113.98",
  });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("set-cookie"));
  const [event] = await f.audits();
  assert.equal(event.action, "auth.login_succeeded");
  assert.equal(event.tenant_id, f.tenantId);
  assert.equal(event.actor_user_id, f.account.id);
  assert.deepEqual(JSON.parse(event.detail_json), { email, ip: f.remoteAddress, userAgent: "Audit Browser/1.0", result: "success" });
  assert.equal((await f.db.prepare("SELECT last_login_at FROM users WHERE id=?").bind(f.account.id).first()).last_login_at, event.created_at);
  assert.equal(event.detail_json.includes(password), false);
  for (const path of ["/api/v1/workspace?include=audits", "/api/v1/workspace/audits"]) {
    const result = await f.request(path, { cookie: f.cookie });
    assert.equal(result.status, 200);
    const payload = await result.json(), events = payload.audits ?? payload.events;
    assert.equal(events[0].actorEmail, email);
    assert.equal(events[0].id, event.id);
  }
});

test("错误凭据、停用账号和被撤销授权保留失败审计，未知邮箱不归入现有机构", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.login({ email, password: "WrongPassword123" })).status, 401);
  await f.db.prepare("UPDATE users SET status='disabled' WHERE id=?").bind(f.account.id).run();
  assert.equal((await f.login()).status, 401);
  await f.db.prepare("UPDATE users SET status='active' WHERE id=?").bind(f.account.id).run();
  await f.db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id=?").bind(f.account.id).run();
  const denied = await f.login();
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("set-cookie"), null);
  assert.equal((await f.login({ email: "unknown@audit.example", password })).status, 401);
  const events = await f.audits();
  assert.equal(events.length, 3);
  assert.ok(events.every((event) => event.action === "auth.login_failed" && event.tenant_id === f.tenantId));
  assert.deepEqual(events.map((event) => JSON.parse(event.detail_json).reason).sort(), ["account_access_denied", "invalid_credentials", "invalid_credentials"]);
  assert.equal((await f.db.prepare("SELECT last_login_at FROM users WHERE id=?").bind(f.account.id).first()).last_login_at, null);
});

test("登录限流仍返回429且记录原因，客户端伪造转发头不能绕过来源限流", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) {
    assert.equal((await f.login({ email, password: "WrongPassword123" }, { "x-forwarded-for": `203.0.113.${index + 1}` })).status, 401);
  }
  const blocked = await f.login();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.ok((await f.audits()).some((event) => JSON.parse(event.detail_json).reason === "too_many_attempts"));
});

test("来源地址仅取Workers平台头、Node套接字或显式信任的代理，非法地址不伪造日志", async (t) => {
  await fixture(t);
  const request = new Request("http://127.0.0.1", { headers: { "cf-connecting-ip": "2001:db8::10", "x-forwarded-for": "203.0.113.10, 192.0.2.2" } });
  assert.equal(api.loginClientIp(request, "cloudflare", "127.0.0.1"), "2001:db8::10");
  assert.equal(api.loginClientIp(request, "node", "127.0.0.1"), "127.0.0.1");
  assert.equal(api.loginClientIp(request, "node"), null);
  process.env.HUAWEN_ZHIXING_TRUST_PROXY = "true";
  assert.equal(api.loginClientIp(request, "node", "127.0.0.1"), "203.0.113.10");
  assert.equal(api.loginClientIp(new Request("http://127.0.0.1", { headers: { "cf-connecting-ip": "invalid" } }), "cloudflare"), null);
});

test("成功登录的审计写入失败会回滚最后登录时间，且不签发Cookie", async (t) => {
  const f = await fixture(t);
  await f.db.prepare("CREATE TRIGGER reject_login_audit BEFORE INSERT ON audit_logs WHEN NEW.action='auth.login_succeeded' BEGIN SELECT RAISE(ABORT,'fixture_login_audit_failed'); END").run();
  const response = await f.login();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await f.db.prepare("SELECT last_login_at FROM users WHERE id=?").bind(f.account.id).first()).last_login_at, null);
  assert.equal((await f.audits()).length, 0);
  await f.db.prepare("DROP TRIGGER reject_login_audit").run();
  assert.equal((await f.login()).status, 200);
  assert.equal((await f.audits()).length, 1);
});

test("审计按北京时间、IP和账号筛选，分页无重复且不能读取其他机构", async (t) => {
  const f = await fixture(t);
  const insert = (id, tenantId, at, detail) => f.db.prepare("INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,'auth.login_succeeded','user',?,?,?)")
    .bind(id, tenantId, f.account.id, f.account.id, detail, at);
  await f.db.batch([
    ...Array.from({ length: 32 }, (_, index) => insert(`event-${String(index).padStart(2, "0")}`, f.tenantId, "2026-10-20 16:00:00", JSON.stringify({ ip: "203.0.113.10" }))),
    insert("before", f.tenantId, "2026-10-20 15:59:59", JSON.stringify({ ip: "203.0.113.10" })),
    insert("after", f.tenantId, "2026-10-21 16:00:00", JSON.stringify({ ip: "203.0.113.10" })),
    insert("other-tenant", "other-tenant", "2026-10-20 16:00:00", JSON.stringify({ ip: "203.0.113.10" })),
    insert("legacy", f.tenantId, "2026-10-20 16:00:00", "invalid legacy JSON"),
  ]);
  const query = `/api/v1/workspace/audits?from=2026-10-21&to=2026-10-21&action=auth.login_succeeded&actorId=${f.account.id}&ip=203.0.113.10`;
  const first = await (await f.request(query, { cookie: f.cookie })).json();
  assert.equal(first.events.length, 30);
  assert.ok(first.nextCursor);
  const second = await (await f.request(`${query}&cursor=${encodeURIComponent(first.nextCursor)}`, { cookie: f.cookie })).json();
  assert.equal(second.events.length, 2);
  assert.equal(second.nextCursor, null);
  const ids = [...first.events, ...second.events].map((event) => event.id);
  assert.equal(new Set(ids).size, 32);
  assert.ok(ids.every((id) => id.startsWith("event-")));
  assert.deepEqual((await (await f.request(query.replace("ip=203.0.113.10", "ip=192.0.2.1"), { cookie: f.cookie })).json()).events, []);
  assert.equal((await f.request("/api/v1/workspace/audits?from=invalid", { cookie: f.cookie })).status, 400);
});

test("已删除的反馈接口和邀请命令不可再提交，成员查询不再加载邀请", async (t) => {
  const f = await fixture(t);
  const feedback = await f.request("/api/v1/feedback", { method: "POST", cookie: f.cookie, json: { targetType: "platform", targetId: f.tenantId, rating: 1 } });
  assert.equal(feedback.status, 404);
  const invite = await f.request("/api/v1/workspace/actions", { method: "POST", cookie: f.cookie, json: { action: "create_invitation", email: "invitee@audit.example", role: "teacher" } });
  assert.equal(invite.status, 400);
  assert.deepEqual(await invite.json(), { error: "unsupported_action" });
  const members = await (await f.request("/api/v1/workspace?include=members", { cookie: f.cookie })).json();
  assert.equal("invitations" in members, false);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM invitations").first()).n, 0);
});
