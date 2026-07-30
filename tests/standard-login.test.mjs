import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function loadAuthModules() {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-standard-login-"));
  const compile = async (input, output) => {
    const source = await readFile(new URL(input, root), "utf8");
    const transpiled = ts.transpileModule(source.replace('from "./auth-password"', 'from "./auth-password.js"'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: input,
      reportDiagnostics: true,
    });
    const errors = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors, []);
    await writeFile(join(directory, output), transpiled.outputText, "utf8");
  };
  await compile("app/lib/auth-password.ts", "auth-password.js");
  await compile("app/lib/standard-login.ts", "standard-login.js");
  await compile("app/lib/password-change.ts", "password-change.js");
  await compile("app/lib/password-change-state.ts", "password-change-state.js");
  return {
    modules: {
      ...await import(`${pathToFileURL(join(directory, "standard-login.js")).href}?${Date.now()}`),
      ...await import(`${pathToFileURL(join(directory, "password-change.js")).href}?${Date.now()}`),
      ...await import(`${pathToFileURL(join(directory, "password-change-state.js")).href}?${Date.now()}`),
      ...await import(`${pathToFileURL(join(directory, "auth-password.js")).href}?${Date.now()}`),
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function fakeDb(account) {
  const state = { account, batchCalls: 0 };
  return {
    state,
    prepare(query) {
      return {
        query,
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (/COUNT\(\*\) AS count FROM users/.test(query)) return { count: state.account ? 1 : 0 };
          return /FROM users/.test(query) ? state.account : null;
        },
        async run() {
          if (/UPDATE users SET password_hash/.test(query)) {
            state.account.passwordHash = this.values[0];
            state.account.mustChangePassword = 0;
          }
          return { success: true, results: [], meta: { changes: 1 } };
        },
      };
    },
    async batch(statements) {
      state.batchCalls += 1;
      const user = statements[1];
      state.account = { id: user.values[0], email: user.values[1], displayName: user.values[2], passwordHash: user.values[3], mustChangePassword: 0, status: "active" };
    },
  };
}

test("standard login rejects an inactive account even with bootstrap credentials", async () => {
  const { modules, cleanup } = await loadAuthModules();
  try {
    const db = fakeDb({ id: "usr_admin", email: "admin@wenqu.test", displayName: "管理员", passwordHash: await modules.hashPassword("TempPass-1234"), mustChangePassword: 0, status: "inactive" });
    const account = await modules.authenticateStandardAccount({ db, email: "admin@wenqu.test", password: "Bootstrap-1234", adminEmail: "admin@wenqu.test", adminPassword: "Bootstrap-1234" });
    assert.equal(account, null);
    assert.equal(db.state.batchCalls, 0);
  } finally { await cleanup(); }
});

test("initial admin setup creates the first account without deploy-time secrets", async () => {
  const { modules, cleanup } = await loadAuthModules();
  try {
    const db = fakeDb(null);
    const account = await modules.createInitialAdminAccount({ db, email: "admin@wenqu.test", password: "Bootstrap-1234", displayName: "管理员" });
    assert.equal(account?.status, "active");
    assert.equal(account?.displayName, "管理员");
    assert.equal(db.state.batchCalls, 1);
  } finally { await cleanup(); }
});

test("initial admin setup is closed once any user exists", async () => {
  const { modules, cleanup } = await loadAuthModules();
  try {
    const db = fakeDb({ id: "usr_existing", email: "existing@wenqu.test", displayName: "已有用户", passwordHash: await modules.hashPassword("ExistingPass-1234"), mustChangePassword: 0, status: "active" });
    const account = await modules.createInitialAdminAccount({ db, email: "admin@wenqu.test", password: "Bootstrap-1234", displayName: "管理员" });
    assert.equal(account, null);
    assert.equal(db.state.batchCalls, 0);
  } finally { await cleanup(); }
});

test("standard login no longer bootstraps from deploy-time admin password", async () => {
  const { modules, cleanup } = await loadAuthModules();
  try {
    const db = fakeDb(null);
    const account = await modules.authenticateStandardAccount({ db, email: "admin@wenqu.test", password: "Bootstrap-1234", adminEmail: "admin@wenqu.test", adminPassword: "Bootstrap-1234" });
    assert.equal(account, null);
    assert.equal(db.state.batchCalls, 0);
  } finally { await cleanup(); }
});

test("normal account login does not depend on bootstrap credentials", async () => {
  const { modules, cleanup } = await loadAuthModules();
  try {
    const db = fakeDb({ id: "usr_student", email: "student@wenqu.test", displayName: "学生", passwordHash: await modules.hashPassword("StudentPass-1234"), mustChangePassword: 0, status: "active" });
    const account = await modules.authenticateStandardAccount({ db, email: "student@wenqu.test", password: "StudentPass-1234" });
    assert.equal(account?.id, "usr_student");
    assert.equal(db.state.batchCalls, 0);
  } finally { await cleanup(); }
});

test("password change clears the route-equivalent session and workspace gate flow", async () => {
  const { modules, cleanup } = await loadAuthModules();
  try {
    const db = fakeDb({ id: "usr_student", email: "student@wenqu.test", displayName: "学生", passwordHash: await modules.hashPassword("CurrentPass-1234"), mustChangePassword: 1, status: "active" });
    const blocked = modules.workspacePasswordChangeGate("standard", { mustChangePassword: db.state.account.mustChangePassword === 1 });
    assert.equal(blocked?.status, 403);
    assert.deepEqual(await blocked?.json(), { error: "password_change_required" });
    assert.equal(await modules.changeAccountPassword({ db, tenantId: "tenant_school", userId: "usr_student", currentPassword: "CurrentPass-1234", newPassword: "NewPass-5678" }), true);
    assert.equal(db.state.account.mustChangePassword, 0);
    assert.deepEqual(modules.sessionPasswordChangeState({ mustChangePassword: db.state.account.mustChangePassword === 1 }), { mustChangePassword: false });
    assert.equal(modules.workspacePasswordChangeGate("standard", { mustChangePassword: db.state.account.mustChangePassword === 1 }), null);
  } finally { await cleanup(); }
});
