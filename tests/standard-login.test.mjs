import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { ensurePlatformSchema } from './lib/platform-store';
    export * from './lib/standard-login';
    export { changeAccountPassword } from './lib/password-change';
    export * from './lib/password-change-state';
    export { hashPassword, verifyPassword } from './lib/auth-password';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  const addAccount = async (status = "active", mustChange = 0) => {
    await db.prepare("INSERT INTO users(id,email,display_name,password_hash,status,must_change_password) VALUES ('account','member@example.test','成员',?,?,?)")
      .bind(await api.hashPassword("CurrentPass123"), status, mustChange).run();
  };
  return { db, addAccount };
}

test("standard login rejects inactive accounts and does not provision empty databases", async (t) => {
  const { db, addAccount } = await fixture(t);
  assert.equal(await api.authenticateStandardAccount({ db, email: "member@example.test", password: "CurrentPass123" }), null);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 0);
  await addAccount("disabled");
  assert.equal(await api.authenticateStandardAccount({ db, email: "member@example.test", password: "CurrentPass123" }), null);
});

test("initial setup creates only one administrator and no deployment secret is required", async (t) => {
  const { db } = await fixture(t);
  const account = await api.createInitialAdminAccount({ db, email: "admin@example.test", password: "InitialPass123", displayName: "管理员", workspaceName: "学校" });
  assert.equal(account.displayName, "管理员");
  assert.equal(account.sessionVersion, 0);
  assert.deepEqual((await db.prepare("SELECT role FROM role_memberships").all()).results, [{ role: "admin" }]);
  assert.equal((await db.prepare("SELECT name FROM tenants").first()).name, "学校");
  assert.equal(await api.createInitialAdminAccount({ db, email: "second@example.test", password: "InitialPass123" }), null);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 1);
});

test("concurrent setup has a single database winner even for equal credentials", async (t) => {
  for (const sameEmail of [false, true]) await t.test(String(sameEmail), async (t) => {
    const { db } = await fixture(t);
    const results = await Promise.all(["first@example.test", sameEmail ? "first@example.test" : "second@example.test"].map((email) => api.createInitialAdminAccount({ db, email, password: "InitialPass123" })));
    assert.equal(results.filter(Boolean).length, 1);
    for (const table of ["users", "tenants", "role_memberships"]) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 1);
  });
});

test("a failed setup transaction releases its claim and leaves a retryable empty database", async (t) => {
  const { db } = await fixture(t);
  await db.prepare("CREATE TRIGGER reject_setup BEFORE INSERT ON role_memberships BEGIN SELECT RAISE(ABORT,'setup_failure'); END").run();
  await assert.rejects(api.createInitialAdminAccount({ db, email: "admin@example.test", password: "InitialPass123" }), /setup_failure/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key='initial_admin_claim'").first()).n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 0);
  await db.prepare("DROP TRIGGER reject_setup").run();
  assert.ok(await api.createInitialAdminAccount({ db, email: "admin@example.test", password: "InitialPass123" }));
});

test("password change clears the temporary password gate and increments the session version atomically", async (t) => {
  const { db, addAccount } = await fixture(t);
  await addAccount("active", 1);
  assert.equal(api.workspacePasswordChangeGate("standard", { mustChangePassword: true }).status, 403);
  assert.equal(await api.changeAccountPassword({ db, tenantId: "school", userId: "account", currentPassword: "WrongPass123", newPassword: "NewPass45678" }), false);
  const changed = await api.changeAccountPassword({ db, tenantId: "school", userId: "account", currentPassword: "CurrentPass123", newPassword: "NewPass45678" });
  assert.deepEqual(changed, { sessionVersion: 1 });
  const account = await api.authenticateStandardAccount({ db, email: "member@example.test", password: "NewPass45678" });
  assert.equal(account.sessionVersion, 1);
  assert.equal(account.mustChangePassword, 0);
  assert.equal(api.workspacePasswordChangeGate("standard", { mustChangePassword: false }), null);
  assert.deepEqual(api.sessionPasswordChangeState({ mustChangePassword: false }), { mustChangePassword: false });
});

test("audit failure rolls back the password and session version", async (t) => {
  const { db, addAccount } = await fixture(t);
  await addAccount("active", 1);
  await db.prepare("CREATE TRIGGER reject_password_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit_failure'); END").run();
  await assert.rejects(api.changeAccountPassword({ db, tenantId: "school", userId: "account", currentPassword: "CurrentPass123", newPassword: "NewPass45678" }), /audit_failure/);
  const account = await api.authenticateStandardAccount({ db, email: "member@example.test", password: "CurrentPass123" });
  assert.equal(account.sessionVersion, 0);
  assert.equal(account.mustChangePassword, 1);
});
