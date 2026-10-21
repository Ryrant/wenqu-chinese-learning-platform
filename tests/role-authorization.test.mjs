import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret, platformContext } from './lib/platform-store';
    export { createSessionToken } from './lib/auth-token';
    export { hashPassword } from './lib/auth-password';
    export { POST as setup } from './app/api/v1/auth/setup/route';
    export { POST as login } from './app/api/v1/auth/login/route';
    export { GET as session } from './app/api/v1/auth/session/route';
    export { GET as workspace } from './app/api/v1/workspace/route';
  `, resolveDir: root },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=role-authorization-bundle.mjs`).toString("base64")}`);

async function fixture(t, { empty = false } = {}) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ database: db, storage: null });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  if (!empty) {
    await db.batch([
      db.prepare("INSERT INTO tenants (id,name) VALUES ('tenant-school','测试学校')"),
      db.prepare("INSERT INTO users (id,email,display_name) VALUES ('existing-admin','existing-admin@school.example','已有管理员')"),
      db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role) VALUES ('tenant-school','existing-admin','admin')"),
    ]);
  }
  const secret = await api.ensureSiteJwtSecret(db);
  const request = async (email) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await api.createSessionToken({ email, displayName: "旧会话名称", iat: now, exp: now + 3600 }, secret);
    return new Request("http://127.0.0.1/api/v1/workspace", { headers: { cookie: `huawen_zhixing_session=${token}` } });
  };
  const addAccount = async ({ id = "explicit-account-id", email = "member@school.example", status = "active", roles = [] } = {}) => {
    await db.prepare("INSERT INTO users (id,email,display_name,status) VALUES (?,?,?,?)").bind(id, email, "当前账号名称", status).run();
    for (const role of roles) {
      await db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role) VALUES ('tenant-school',?,?)").bind(id, role).run();
    }
    return { id, email };
  };
  return { db, request, addAccount };
}

async function authorizationState(db) {
  const tables = ["users", "tenants", "role_memberships", "invitations", "audit_logs"];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
}

test("first setup grants only admin and creates no self student or guardian relationships", async (t) => {
  const { db } = await fixture(t, { empty: true });
  const response = await api.setup(new Request("http://127.0.0.1/api/v1/auth/setup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@school.example", password: "SetupPassword123", displayName: "首个管理员" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user.roles, ["admin"]);
  assert.deepEqual((await db.prepare("SELECT role FROM role_memberships").all()).results, [{ role: "admin" }]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM enrollments").first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM guardian_student_links").first()).count, 0);
});

test("account permissions use its stored id and current name, and expose only its authorized role", async (t) => {
  const { db, request, addAccount } = await fixture(t);
  const account = await addAccount({ roles: ["student"] });
  const context = await api.platformContext(await request(account.email));
  assert.equal(context.userId, account.id);
  assert.equal(context.displayName, "当前账号名称");
  assert.deepEqual(context.roles, ["student"]);
  const response = await api.session(await request(account.email));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user.roles, ["student"]);
  await assert.rejects(api.platformContext(await request(account.email), "admin"), /forbidden/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM tenants").first()).count, 1);
});

test("explicitly assigned multiple roles stay assigned while admin remains admin only", async (t) => {
  const { request, addAccount } = await fixture(t);
  const account = await addAccount({ roles: ["teacher", "guardian"] });
  const context = await api.platformContext(await request(account.email));
  assert.deepEqual(new Set(context.roles), new Set(["teacher", "guardian"]));
  const admin = await api.platformContext(await request("existing-admin@school.example"), "admin");
  assert.deepEqual(admin.roles, ["admin"]);
  assert.deepEqual((await api.platformContext(await request("existing-admin@school.example"), "teacher")).roles, ["admin"]);
});

test("unknown, disabled and unauthorized accounts are forbidden without provisioning any permissions", async (t) => {
  for (const scenario of ["unknown", "disabled-account", "no-membership", "disabled-membership", "disabled-tenant", "invalid-role", "pending-invitation"]) {
    await t.test(scenario, async (t) => {
      const { db, request, addAccount } = await fixture(t);
      const email = "member@school.example";
      if (scenario !== "unknown") {
        await addAccount({ email, status: scenario === "disabled-account" ? "disabled" : "active", roles: ["disabled-account", "disabled-membership", "disabled-tenant"].includes(scenario) ? ["teacher"] : scenario === "invalid-role" ? ["reviewer"] : [] });
      }
      if (scenario === "disabled-membership") await db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id='explicit-account-id'").run();
      if (scenario === "disabled-tenant") await db.prepare("UPDATE tenants SET status='disabled' WHERE id='tenant-school'").run();
      if (scenario === "pending-invitation") await db.prepare("INSERT INTO invitations (id,tenant_id,email,role,token,invited_by,expires_at) VALUES ('pending','tenant-school',?,'teacher','pending-token','existing-admin',datetime('now','+1 day'))").bind(email).run();
      const before = await authorizationState(db);
      await assert.rejects(api.platformContext(await request(email)), /account_access_denied/);
      const session = await api.session(await request(email));
      assert.equal(session.status, 403);
      assert.equal((await session.json()).error, "account_access_denied");
      const workspace = await api.workspace(await request(email));
      assert.equal(workspace.status, 403);
      assert.deepEqual(await workspace.json(), { error: "account_access_denied" });
      assert.deepEqual(await authorizationState(db), before);
    });
  }
});

test("password login issues a cookie only for an account with a valid role", async (t) => {
  const password = "RolePassword123";
  const passwordHash = await api.hashPassword(password);
  for (const scenario of ["no-membership", "disabled-membership", "invalid-role", "disabled-tenant", "authorized"]) {
    await t.test(scenario, async (t) => {
      const { db, addAccount } = await fixture(t);
      const account = await addAccount({ roles: scenario === "no-membership" ? [] : scenario === "invalid-role" ? ["reviewer"] : ["teacher"] });
      await db.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(passwordHash, account.id).run();
      if (scenario === "disabled-membership") await db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id=?").bind(account.id).run();
      if (scenario === "disabled-tenant") await db.prepare("UPDATE tenants SET status='disabled' WHERE id='tenant-school'").run();
      const response = await api.login(new Request("http://127.0.0.1/api/v1/auth/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password }),
      }));
      assert.equal(response.status, scenario === "authorized" ? 200 : 403);
      if (scenario === "authorized") assert.match(response.headers.get("set-cookie"), /huawen_zhixing_session=/);
      else {
        assert.equal(response.headers.get("set-cookie"), null);
        assert.deepEqual(await response.json(), { error: "account_access_denied" });
        assert.equal((await db.prepare("SELECT last_login_at FROM users WHERE id=?").bind(account.id).first()).last_login_at, null);
      }
    });
  }
});

test("a temporary password keeps the authorized session available for password change", async (t) => {
  const { db, addAccount } = await fixture(t);
  const account = await addAccount({ roles: ["teacher"] });
  const password = "TemporaryPassword123";
  await db.prepare("UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?").bind(await api.hashPassword(password), account.id).run();
  const login = await api.login(new Request("http://127.0.0.1/api/v1/auth/login", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password }),
  }));
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.mustChangePassword, true);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = () => new Request("http://127.0.0.1/api/v1/workspace", { headers: { cookie } });
  const session = await api.session(request());
  assert.equal(session.status, 200);
  const sessionData = await session.json();
  assert.equal(sessionData.authenticated, true);
  assert.equal(sessionData.user.mustChangePassword, true);
  assert.deepEqual(sessionData.user.roles, ["teacher"]);
  const workspace = await api.workspace(request());
  assert.equal(workspace.status, 403);
  assert.deepEqual(await workspace.json(), { error: "password_change_required" });
});

test("an invalid role in an earlier tenant does not mask a later valid authorization", async (t) => {
  const { db, request, addAccount } = await fixture(t);
  const account = await addAccount();
  await db.batch([
    db.prepare("INSERT INTO tenants (id,name) VALUES ('invalid-role-tenant','无效角色租户')"),
    db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role,created_at) VALUES ('invalid-role-tenant',?,'reviewer','2000-01-01')").bind(account.id),
    db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role) VALUES ('tenant-school',?,'teacher')").bind(account.id),
  ]);
  const context = await api.platformContext(await request(account.email), "teacher");
  assert.equal(context.tenantId, "tenant-school");
  assert.deepEqual(context.roles, ["teacher"]);
});

test("local development bootstraps only the default account in an empty database", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  t.after(() => { if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv; });
  const { db } = await fixture(t, { empty: true });
  await assert.rejects(api.platformContext(new Request("http://127.0.0.1/api/v1/workspace", { headers: { "x-huawen-zhixing-dev-user": "unknown@school.example" } })), /account_access_denied/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
  const context = await api.platformContext(new Request("http://127.0.0.1/api/v1/workspace"));
  assert.equal(context.userEmail, "dev@huawen-zhixing.local");
  assert.deepEqual(context.roles, ["admin"]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM guardian_student_links").first()).count, 0);
  await assert.rejects(api.platformContext(new Request("http://127.0.0.1/api/v1/workspace", { headers: { "x-huawen-zhixing-dev-user": "unknown@school.example" } })), /account_access_denied/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 1);
});
