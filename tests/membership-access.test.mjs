import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const serviceSource = await readFile(new URL("app/lib/membership-service.ts", root), "utf8");
const executableSource = serviceSource
  .replace('import { hashPassword } from "./auth-password";', 'async function hashPassword(password) { return `hash:${password}`; }')
  .replace('import type { PlatformRole } from "./platform-store";\n', "");
const transpiled = ts.transpileModule(executableSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: "membership-service.ts",
  reportDiagnostics: true,
});
assert.deepEqual((transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error), []);
const membershipService = await import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`);
const [actionsSource, workspaceSource] = await Promise.all([
  readFile(new URL("app/api/v1/workspace/actions/route.ts", root), "utf8"),
  readFile(new URL("app/api/v1/workspace/route.ts", root), "utf8"),
]);

function createDb({ users = [], memberships = [], links = [] } = {}) {
  const state = {
    users: new Map(users.map((user) => [user.id, { ...user }])),
    memberships: memberships.map((membership) => ({ ...membership })),
    links: links.map((link) => ({ ...link })),
    batches: [],
  };
  const execute = (sql, args) => {
    if (sql.startsWith("INSERT INTO users")) {
      const [id, email, displayName, , passwordHash] = args;
      const existing = state.users.get(id);
      if (!existing) state.users.set(id, { id, email, displayName, passwordHash, mustChangePassword: 1, status: "active" });
      else if (sql.includes("ON CONFLICT")) Object.assign(existing, { email, displayName, passwordHash, mustChangePassword: 1, status: "active" });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO role_memberships")) {
      const [tenantId, userId, role] = args;
      if (!state.memberships.some((membership) => membership.tenantId === tenantId && membership.userId === userId && membership.role === role)) state.memberships.push({ tenantId, userId, role, status: "active" });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE role_memberships SET status='active'")) {
      const [tenantId, userId, role] = args;
      state.memberships.filter((membership) => membership.tenantId === tenantId && membership.userId === userId && membership.role === role).forEach((membership) => { membership.status = "active"; });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE users SET password_hash=")) {
      const [passwordHash, userId] = args;
      const user = state.users.get(userId);
      if (!user) return { meta: { changes: 0 } };
      user.passwordHash = passwordHash;
      user.mustChangePassword = 1;
      if (sql.includes("status='active'")) user.status = "active";
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE users SET status=")) {
      const [status, userId] = args;
      const user = state.users.get(userId);
      if (!user) return { meta: { changes: 0 } };
      user.status = status;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE role_memberships SET status=?")) {
      const [status, tenantId, userId] = args;
      const matches = state.memberships.filter((membership) => membership.tenantId === tenantId && membership.userId === userId);
      matches.forEach((membership) => { membership.status = status; });
      return { meta: { changes: matches.length } };
    }
    if (sql.startsWith("DELETE FROM guardian_student_links")) {
      const [tenantId, guardianUserId] = args;
      state.links = state.links.filter((link) => link.tenantId !== tenantId || link.guardianUserId !== guardianUserId);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE guardian_student_links SET status='disabled'")) {
      const [tenantId, guardianUserId] = args;
      state.links.filter((link) => link.tenantId === tenantId && link.guardianUserId === guardianUserId).forEach((link) => { link.status = "disabled"; });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO guardian_student_links")) {
      const [tenantId, guardianUserId, studentUserId] = args;
      state.links.push({ tenantId, guardianUserId, studentUserId, status: "active" });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  };
  const db = {
    prepare(sql) {
      let args = [];
      return {
        sql,
        bind(...nextArgs) { args = nextArgs; return this; },
        run: async () => execute(sql, args),
        first: async () => {
          if (sql.includes("FROM users")) {
            const user = state.users.get(args[0]) ?? null;
            if (!user || !sql.includes("JOIN role_memberships")) return user;
            const membership = state.memberships.find((item) => item.userId === args[0] && item.tenantId === args[1]);
            if (!membership || (sql.includes("rm.status='active'") && membership.status !== "active")) return null;
            return user;
          }
          return null;
        },
      };
    },
    batch: async (statements) => {
      state.batches.push(statements.map((statement) => statement.sql));
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
  return { db, state };
}

test("existing member creation preserves shared account credentials while restoring only the current tenant role", async () => {
  const { db, state } = createDb({ users: [{ id: "usr_3ehbs1", email: "existing@example.com", displayName: "Shared Account", passwordHash: "original-hash", mustChangePassword: 0, status: "disabled" }] });
  await membershipService.createMember(db, { tenantId: "tenant-a", actorUserId: "admin-a", email: "existing@example.com", displayName: "Tenant A Name", role: "teacher", temporaryPassword: "NewTemporary1" });
  assert.deepEqual(state.users.get("usr_3ehbs1"), { id: "usr_3ehbs1", email: "existing@example.com", displayName: "Shared Account", passwordHash: "original-hash", mustChangePassword: 0, status: "disabled" });
  assert.deepEqual(state.memberships, [{ tenantId: "tenant-a", userId: "usr_3ehbs1", role: "teacher", status: "active" }]);
});

test("member password reset does not reactivate a globally disabled account", async () => {
  const { db, state } = createDb({ users: [{ id: "member-1", email: "member@example.com", displayName: "Member", passwordHash: "original-hash", mustChangePassword: 0, status: "disabled" }], memberships: [{ tenantId: "tenant-a", userId: "member-1", role: "teacher", status: "active" }] });
  await assert.rejects(() => membershipService.resetMemberPassword(db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", temporaryPassword: "NewTemporary1" }), /member_inactive/);
  assert.deepEqual(state.users.get("member-1"), { id: "member-1", email: "member@example.com", displayName: "Member", passwordHash: "original-hash", mustChangePassword: 0, status: "disabled" });
});

test("member password reset rejects a disabled current-tenant membership", async () => {
  const { db, state } = createDb({ users: [{ id: "member-1", email: "member@example.com", displayName: "Member", passwordHash: "original-hash", mustChangePassword: 0, status: "active" }], memberships: [{ tenantId: "tenant-a", userId: "member-1", role: "teacher", status: "disabled" }] });
  await assert.rejects(() => membershipService.resetMemberPassword(db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", temporaryPassword: "NewTemporary1" }), /member_not_found/);
  assert.equal(state.users.get("member-1").passwordHash, "original-hash");
});

test("member status changes stay within the current tenant membership", async () => {
  const { db, state } = createDb({ users: [{ id: "member-1", email: "member@example.com", displayName: "Member", passwordHash: "hash", mustChangePassword: 0, status: "active" }], memberships: [{ tenantId: "tenant-a", userId: "member-1", role: "teacher", status: "active" }, { tenantId: "tenant-b", userId: "member-1", role: "student", status: "active" }] });
  await membershipService.setMemberStatus(db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", status: "disabled" });
  assert.equal(state.users.get("member-1").status, "active");
  assert.deepEqual(state.memberships, [{ tenantId: "tenant-a", userId: "member-1", role: "teacher", status: "disabled" }, { tenantId: "tenant-b", userId: "member-1", role: "student", status: "active" }]);
});

test("member status change rejects a user without a current tenant membership", async () => {
  const { db } = createDb({ users: [{ id: "member-1", email: "member@example.com", displayName: "Member", passwordHash: "hash", mustChangePassword: 0, status: "active" }] });
  await assert.rejects(() => membershipService.setMemberStatus(db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", status: "disabled" }), /member_not_found/);
});

test("replacing guardian links is idempotent within the current tenant", async () => {
  const { db, state } = createDb({ links: [{ tenantId: "tenant-a", guardianUserId: "guardian-1", studentUserId: "student-old", status: "active" }, { tenantId: "tenant-b", guardianUserId: "guardian-1", studentUserId: "student-other", status: "active" }] });
  const input = { tenantId: "tenant-a", actorUserId: "admin-a", guardianUserId: "guardian-1", studentUserIds: ["student-1", "student-2", "student-1"] };
  await membershipService.setGuardianLinks(db, input);
  await membershipService.setGuardianLinks(db, input);
  assert.ok(state.batches.every((batch) => batch.some((sql) => sql.startsWith("DELETE FROM guardian_student_links")) && batch.filter((sql) => sql.startsWith("INSERT INTO guardian_student_links")).length === 2));
  assert.deepEqual(state.links, [{ tenantId: "tenant-b", guardianUserId: "guardian-1", studentUserId: "student-other", status: "active" }, { tenantId: "tenant-a", guardianUserId: "guardian-1", studentUserId: "student-1", status: "active" }, { tenantId: "tenant-a", guardianUserId: "guardian-1", studentUserId: "student-2", status: "active" }]);
});

test("workspace routes expose member and guardian management operations", () => {
  for (const action of ["create_member", "reset_member_password", "set_member_status", "set_guardian_links"]) assert.match(actionsSource, new RegExp(action));
  assert.match(workspaceSource, /members:/);
  assert.match(workspaceSource, /guardianLinks:/);
});

test("access control helpers centralize teacher student and guardian filters", async () => {
  const access = await readFile(new URL("app/lib/access-control.ts", root), "utf8");
  const workspace = await readFile(new URL("app/api/v1/workspace/route.ts", root), "utf8");
  const actions = await readFile(new URL("app/api/v1/workspace/actions/route.ts", root), "utf8");
  assert.match(access, /export type AccessClause/);
  assert.match(access, /export function classAccessClause/);
  assert.match(access, /export function submissionAccessClause/);
  assert.match(access, /guardian_student_links gl/);
  assert.match(access, /gl.status='active'/);
  assert.match(workspace, /classAccessClause/);
  assert.match(workspace, /submissionAccessClause/);
  assert.match(actions, /assertSubmissionReviewAccess/);
});
