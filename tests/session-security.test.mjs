import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { createApiApp } from './server/app';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createSessionToken, verifySessionToken } from './lib/auth-token';
    export { hashPassword } from './lib/auth-password';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const password = "FixturePassword123", newPassword = "ChangedPassword456";

async function fixture(t, setup = true) {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const db = new api.NodeSqliteDatabase("file::memory:");
  let storageCalls = 0;
  const storage = {
    async get() { storageCalls += 1; return null; },
    async put() { storageCalls += 1; throw new Error("unexpected_fixture_storage_write"); },
  };
  api.setPlatformRuntime({ kind: "node", database: db, storage });
  const app = api.createApiApp();
  t.after(() => { db.close(); if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv; });
  await api.ensurePlatformSchema(db);
  const request = (path, { method = "GET", cookie, json } = {}) => app.fetch(new Request(`http://127.0.0.1${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(json === undefined ? {} : { "content-type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  }));
  const expectJson = async (path, options = {}, status = 200) => {
    const response = await request(path, options), data = await response.json();
    assert.equal(response.status, status, JSON.stringify({ path, data }));
    return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const setupAccount = (email = "admin@session.example") => expectJson("/api/v1/auth/setup", { method: "POST", json: { email, password, workspaceName: "会话测试机构" } });
  const login = (email, currentPassword = password) => expectJson("/api/v1/auth/login", { method: "POST", json: { email, password: currentPassword } });
  const action = (cookie, action, payload, status = 200) => expectJson("/api/v1/workspace/actions", { method: "POST", cookie, json: { action, ...payload } }, status);
  const change = (cookie, currentPassword = password, nextPassword = newPassword, status = 200) => expectJson("/api/v1/auth/change-password", { method: "POST", cookie, json: { currentPassword, newPassword: nextPassword } }, status);
  const admin = setup ? await setupAccount() : undefined;
  const addAccount = async (id = "teacher", mustChange = 0) => {
    const tenant = await db.prepare("SELECT id FROM tenants LIMIT 1").first();
    await db.batch([
      db.prepare("INSERT INTO users(id,email,display_name,password_hash,must_change_password) VALUES (?,?,?,?,?)").bind(id, `${id}@session.example`, id, await api.hashPassword(password), mustChange),
      db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,'teacher')").bind(tenant.id, id),
    ]);
    return login(`${id}@session.example`);
  };
  return { db, app, request, expectJson, setupAccount, login, action, change, admin, addAccount, storageCalls: () => storageCalls };
}

test("改密撤销同账号两次登录及无版本旧令牌，新Cookie续签后可继续读取", async (t) => {
  const f = await fixture(t);
  const first = await f.login("admin@session.example"), second = await f.login("admin@session.example");
  assert.ok(first.cookie); assert.ok(second.cookie);
  const now = Math.floor(Date.now() / 1000), secret = await api.ensureSiteJwtSecret(f.db);
  const legacyToken = await api.createSessionToken({ email: "admin@session.example", displayName: "管理员", iat: now - 1, exp: now + 3600 }, secret);
  const legacyCookie = `huawen_zhixing_session=${encodeURIComponent(legacyToken)}`;
  for (const cookie of [first.cookie, second.cookie, legacyCookie]) await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie });
  const changed = await f.change(first.cookie);
  assert.deepEqual(changed.data, { changed: true }); assert.ok(changed.cookie);
  assert.match(changed.response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Path=\//);
  const newToken = decodeURIComponent(changed.cookie.slice(changed.cookie.indexOf("=") + 1));
  assert.equal((await api.verifySessionToken(newToken, secret)).sessionVersion, 1);
  for (const cookie of [first.cookie, second.cookie, legacyCookie]) {
    assert.deepEqual((await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie }, 401)).data, { error: "authentication_required" });
    assert.equal((await f.expectJson("/api/v1/auth/session", { cookie })).data.authenticated, false);
  }
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: changed.cookie });
  const fresh = await f.login("admin@session.example", newPassword);
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: fresh.cookie });
});

test("临时密码统一阻止全部已注册业务API读写，只允许查看会话及改密", async (t) => {
  const f = await fixture(t), temporary = await f.addAccount("temporary", 1);
  assert.equal(temporary.data.user.mustChangePassword, true);
  const session = await f.expectJson("/api/v1/auth/session", { cookie: temporary.cookie });
  assert.equal(session.data.authenticated, true); assert.equal(session.data.user.mustChangePassword, true);
  const businessRoutes = f.app.routes.filter((route) => route.method !== "ALL" && route.path.startsWith("/api/v1/") && !route.path.startsWith("/api/v1/auth/") && route.path !== "/api/v1/health");
  const auditCount = (await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").first()).n;
  assert.ok(businessRoutes.length >= 25);
  for (const route of businessRoutes) {
    const path = route.path.replace(/:[^/]+/g, "11111111-1111-4111-8111-111111111111");
    const response = await f.request(path, { method: route.method, cookie: temporary.cookie, ...(route.method === "POST" ? { json: { action: "create_class", name: "不应写入" } } : {}) });
    assert.equal(response.status, 403, `${route.method} ${path}`);
    if (response.headers.get("content-type")?.includes("application/json")) assert.deepEqual(await response.json(), { error: "password_change_required" }, path);
  }
  assert.equal(f.storageCalls(), 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM classes").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs").first()).n, auditCount);
  const changed = await f.change(temporary.cookie);
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: changed.cookie });
  assert.equal((await f.expectJson("/api/v1/auth/session", { cookie: changed.cookie })).data.user.mustChangePassword, false);
});

test("普通角色不足保持forbidden，授权全失或账号停用单独返回account_access_denied", async (t) => {
  const f = await fixture(t), teacher = await f.addAccount();
  assert.deepEqual((await f.expectJson("/api/v1/settings", { cookie: teacher.cookie }, 403)).data, { error: "forbidden" });
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: teacher.cookie });
  await f.db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id='teacher'").run();
  assert.deepEqual((await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: teacher.cookie }, 403)).data, { error: "account_access_denied" });
  assert.equal((await f.expectJson("/api/v1/auth/session", { cookie: teacher.cookie }, 403)).data.authenticated, false);
  await f.db.prepare("UPDATE role_memberships SET status='active' WHERE user_id='teacher'").run();
  await f.db.prepare("UPDATE users SET status='disabled' WHERE id='teacher'").run();
  assert.deepEqual((await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: teacher.cookie }, 403)).data, { error: "account_access_denied" });
});

test("单机构重置密码撤销既有Cookie并要求临时登录先改密", async (t) => {
  const f = await fixture(t), teacher = await f.addAccount();
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: teacher.cookie });
  await f.action(f.admin.cookie, "reset_member_password", { userId: "teacher", temporaryPassword: "ResetPassword789" });
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: teacher.cookie }, 401);
  const temporary = await f.login("teacher@session.example", "ResetPassword789");
  assert.equal(temporary.data.user.mustChangePassword, true);
  assert.deepEqual((await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: temporary.cookie }, 403)).data, { error: "password_change_required" });
  const changed = await f.change(temporary.cookie, "ResetPassword789");
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: changed.cookie });
  assert.equal((await f.db.prepare("SELECT session_version FROM users WHERE id='teacher'").first()).session_version, 2);
});

test("改密审计写入失败时原密码、会话版本及既有Cookie保持有效", async (t) => {
  const f = await fixture(t), teacher = await f.addAccount();
  const before = await f.db.prepare("SELECT password_hash,must_change_password,session_version FROM users WHERE id='teacher'").first();
  await f.db.prepare("CREATE TRIGGER reject_change_audit BEFORE INSERT ON audit_logs WHEN NEW.action='password.changed' BEGIN SELECT RAISE(ABORT,'fixture_change_audit_failure'); END").run();
  const failed = await f.change(teacher.cookie, password, newPassword, 500);
  assert.equal(failed.cookie, undefined);
  assert.deepEqual(await f.db.prepare("SELECT password_hash,must_change_password,session_version FROM users WHERE id='teacher'").first(), before);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='password.changed'").first()).n, 0);
  await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: teacher.cookie });
  assert.ok((await f.login("teacher@session.example")).cookie);
});

test("并发首次初始化HTTP请求只有一个成功，失败方不创建额外机构或管理员", async (t) => {
  const f = await fixture(t, false);
  const results = await Promise.all(["first@setup.example", "second@setup.example"].map((email) => f.request("/api/v1/auth/setup", { method: "POST", json: { email, password } })));
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const loser = results.find((response) => response.status === 409), winner = results.find((response) => response.status === 200);
  assert.deepEqual(await loser.json(), { error: "setup_closed" }); assert.equal(loser.headers.get("set-cookie"), null);
  assert.ok(winner.headers.get("set-cookie"));
  for (const table of ["users", "tenants", "role_memberships"]) assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key='initial_admin_claim'").first()).n, 1);
});
