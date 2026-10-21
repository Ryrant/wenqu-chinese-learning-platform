import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { ensurePlatformSchema, platformApiError } from './lib/platform-store';
    export * from './lib/membership-service';
    export { hashPassword, verifyPassword } from './lib/auth-password';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const password = "CurrentPassword123", temporaryPassword = "TemporaryPassword456";
const originalHash = await api.hashPassword(password);

async function fixture(t, { status = "active", membership = "active", otherMembership = false } = {}) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('tenant-a','本机构'),('tenant-b','其他机构')"),
    db.prepare("INSERT INTO users(id,email,display_name,password_hash,must_change_password,status,session_version) VALUES ('member-1','member@example.test','原有成员',?,0,?,3)").bind(originalHash, status),
    ...["admin-a", "guardian-1", "student-1", "student-2", "student-old", "student-other"].map((id) => db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('tenant-a','admin-a','admin','active'),('tenant-a','guardian-1','guardian','active')"),
    ...["student-1", "student-2", "student-old"].map((id) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('tenant-a',?,'student','active')").bind(id)),
  ]);
  if (membership) await db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('tenant-a','member-1','teacher',?)").bind(membership).run();
  if (otherMembership) await db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('tenant-b','member-1','student','active')").run();
  const account = () => db.prepare("SELECT * FROM users WHERE id='member-1'").first();
  const roles = () => db.prepare("SELECT tenant_id,user_id,role,status FROM role_memberships WHERE user_id='member-1' ORDER BY tenant_id,role").all().then((result) => result.results);
  const reset = () => api.resetMemberPassword(db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", temporaryPassword });
  const audits = async () => (await db.prepare("SELECT COUNT(*) AS n FROM audit_logs").first()).n;
  return { db, account, roles, reset, audits };
}

test("本机构已有成员加角色只恢复本机构授权，保留全局账号状态和凭据", async (t) => {
  const f = await fixture(t, { status: "disabled", membership: "disabled", otherMembership: true });
  const before = await f.account();
  const input = { tenantId: "tenant-a", actorUserId: "admin-a", email: " MEMBER@example.test ", displayName: "新名称", role: "teacher", temporaryPassword };
  const result = await api.createMember(f.db, input);
  await api.createMember(f.db, { ...input, role: "guardian" });
  assert.equal(result.id, "member-1"); assert.equal(result.mustChangePassword, false);
  assert.deepEqual(await f.account(), before);
  assert.deepEqual(await f.roles(), [
    { tenant_id: "tenant-a", user_id: "member-1", role: "guardian", status: "active" },
    { tenant_id: "tenant-a", user_id: "member-1", role: "teacher", status: "active" },
    { tenant_id: "tenant-b", user_id: "member-1", role: "student", status: "active" },
  ]);
});

test("新成员创建真实密码哈希、临时改密标记及单个指定角色", async (t) => {
  const f = await fixture(t);
  const result = await api.createMember(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", email: "new@example.test", displayName: "新成员", role: "teacher", temporaryPassword });
  const saved = await f.db.prepare("SELECT * FROM users WHERE id=?").bind(result.id).first();
  assert.equal(await api.verifyPassword(temporaryPassword, saved.password_hash), true);
  assert.equal(saved.must_change_password, 1); assert.equal(saved.session_version, 0);
  assert.deepEqual((await f.db.prepare("SELECT tenant_id,role,status FROM role_memberships WHERE user_id=?").bind(result.id).all()).results, [{ tenant_id: "tenant-a", role: "teacher", status: "active" }]);
});

test("拒绝关联本机构外的已有账号，账号、授权和审计不改变", async (t) => {
  const f = await fixture(t, { membership: false, otherMembership: true });
  const before = { account: await f.account(), roles: await f.roles(), audits: await f.audits() };
  const error = await api.createMember(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", email: "member@example.test", displayName: "不会保存", role: "teacher", temporaryPassword }).catch((error) => error);
  assert.equal(error.message, "member_account_external");
  const response = api.platformApiError(error);
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "member_account_external" });
  assert.deepEqual({ account: await f.account(), roles: await f.roles(), audits: await f.audits() }, before);
});

test("全局停用或当前机构授权停用时拒绝重置密码且不恢复账号", async (t) => {
  for (const [options, message] of [[{ status: "disabled" }, "member_inactive"], [{ membership: "disabled" }, "member_not_found"]]) await t.test(message, async (t) => {
    const f = await fixture(t, options), before = await f.account();
    await assert.rejects(f.reset(), new RegExp(message));
    assert.deepEqual(await f.account(), before); assert.equal(await f.audits(), 0);
  });
});

test("共享多机构账号拒绝机构级全局密码重置，其他机构授权停用也不能绕过保护", async (t) => {
  for (const status of ["active", "disabled"]) await t.test(status, async (t) => {
    const f = await fixture(t, { otherMembership: true });
    await f.db.prepare("UPDATE role_memberships SET status=? WHERE tenant_id='tenant-b' AND user_id='member-1'").bind(status).run();
    const before = await f.account(), error = await f.reset().catch((error) => error);
    assert.equal(error.message, "shared_account_password_reset"); assert.equal(api.platformApiError(error).status, 409);
    assert.deepEqual(await f.account(), before); assert.equal(await f.audits(), 0);
  });
});

test("单机构密码重置递增会话版本，审计失败时账号与凭据整笔回滚", async (t) => {
  const f = await fixture(t), before = await f.account();
  await f.db.prepare("CREATE TRIGGER reject_reset_audit BEFORE INSERT ON audit_logs WHEN NEW.action='member.password_reset' BEGIN SELECT RAISE(ABORT,'fixture_reset_audit_failure'); END").run();
  await assert.rejects(f.reset(), /fixture_reset_audit_failure/);
  assert.deepEqual(await f.account(), before); assert.equal(await f.audits(), 0);
  await f.db.prepare("DROP TRIGGER reject_reset_audit").run(); await f.reset();
  const updated = await f.account();
  assert.equal(await api.verifyPassword(temporaryPassword, updated.password_hash), true);
  assert.equal(updated.must_change_password, 1); assert.equal(updated.session_version, 4);
  assert.equal(updated.status, "active"); assert.equal(await f.audits(), 1);
});

test("成员停用仅影响当前机构授权，保留其他机构和全局账号状态", async (t) => {
  const f = await fixture(t, { otherMembership: true });
  await api.setMemberStatus(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", status: "disabled" });
  assert.equal((await f.account()).status, "active");
  assert.deepEqual(await f.roles(), [
    { tenant_id: "tenant-a", user_id: "member-1", role: "teacher", status: "disabled" },
    { tenant_id: "tenant-b", user_id: "member-1", role: "student", status: "active" },
  ]);
});

test("管理员不能停用自己，也不能修改无当前机构授权的成员", async (t) => {
  const f = await fixture(t, { membership: false });
  const error = await api.setMemberStatus(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "admin-a", status: "disabled" }).catch((error) => error);
  assert.equal(error.message, "cannot_disable_self"); assert.equal(api.platformApiError(error).status, 409);
  assert.equal((await f.db.prepare("SELECT status FROM role_memberships WHERE user_id='admin-a'").first()).status, "active");
  await assert.rejects(api.setMemberStatus(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", userId: "member-1", status: "disabled" }), /member_not_found/);
  assert.equal(await f.audits(), 0);
});

test("监护关联替换在当前机构幂等且不影响其他机构，审计失败保留原关联", async (t) => {
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id,status) VALUES ('tenant-a','guardian-1','student-old','active'),('tenant-b','guardian-1','student-other','active')").run();
  const links = () => f.db.prepare("SELECT tenant_id,guardian_user_id,student_user_id,status FROM guardian_student_links ORDER BY tenant_id,student_user_id").all().then((result) => result.results);
  const input = { tenantId: "tenant-a", actorUserId: "admin-a", guardianUserId: "guardian-1", studentUserIds: ["student-1", "student-2", "student-1"] };
  await api.setGuardianLinks(f.db, input); await api.setGuardianLinks(f.db, input);
  const expected = [
    { tenant_id: "tenant-a", guardian_user_id: "guardian-1", student_user_id: "student-1", status: "active" },
    { tenant_id: "tenant-a", guardian_user_id: "guardian-1", student_user_id: "student-2", status: "active" },
    { tenant_id: "tenant-b", guardian_user_id: "guardian-1", student_user_id: "student-other", status: "active" },
  ];
  assert.deepEqual(await links(), expected);
  await f.db.prepare("CREATE TRIGGER reject_link_audit BEFORE INSERT ON audit_logs WHEN NEW.action='guardian_links.updated' BEGIN SELECT RAISE(ABORT,'fixture_link_audit_failure'); END").run();
  await assert.rejects(api.setGuardianLinks(f.db, { ...input, studentUserIds: ["student-old"] }), /fixture_link_audit_failure/);
  assert.deepEqual(await links(), expected);
});

test("监护绑定拒绝外机构、缺失角色或停用账号，任何非法输入均不改变原关联和审计", async (t) => {
  const cases = [
    { name: "其他机构家长", guardian: "foreign-guardian", error: "invalid_guardian_id" },
    { name: "不存在的家长", guardian: "missing-guardian", error: "invalid_guardian_id" },
    { name: "学生不能作为家长", guardian: "student-1", error: "invalid_guardian_id" },
    { name: "全局停用家长", setup: "UPDATE users SET status='disabled' WHERE id='guardian-1'", error: "invalid_guardian_id" },
    { name: "停用的家长授权", setup: "UPDATE role_memberships SET status='disabled' WHERE user_id='guardian-1'", error: "invalid_guardian_id" },
    { name: "混入其他机构学生", students: ["student-1", "student-other"], error: "invalid_student_ids" },
    { name: "不存在的学生", students: ["student-1", "missing-student"], error: "invalid_student_ids" },
    { name: "家长不能作为学生", students: ["guardian-1"], error: "invalid_student_ids" },
    { name: "全局停用学生", setup: "UPDATE users SET status='disabled' WHERE id='student-1'", error: "invalid_student_ids" },
    { name: "停用的学生授权", setup: "UPDATE role_memberships SET status='disabled' WHERE user_id='student-1'", error: "invalid_student_ids" },
  ];
  for (const item of cases) await t.test(item.name, async (t) => {
    const f = await fixture(t);
    await f.db.batch([
      f.db.prepare("INSERT INTO users(id,email,display_name) VALUES ('foreign-guardian','foreign-guardian@example.test','其他机构家长')"),
      f.db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES ('tenant-b','foreign-guardian','guardian'),('tenant-b','student-other','student')"),
      f.db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id) VALUES ('tenant-a','guardian-1','student-old'),('tenant-b','foreign-guardian','student-other')"),
    ]);
    if (item.setup) await f.db.prepare(item.setup).run();
    const state = async () => ({
      links: (await f.db.prepare("SELECT * FROM guardian_student_links ORDER BY id").all()).results,
      audits: (await f.db.prepare("SELECT * FROM audit_logs ORDER BY id").all()).results,
    });
    const before = await state();
    const error = await api.setGuardianLinks(f.db, {
      tenantId: "tenant-a", actorUserId: "admin-a", guardianUserId: item.guardian ?? "guardian-1", studentUserIds: item.students ?? ["student-1"],
    }).catch((error) => error);
    assert.equal(error.message, item.error);
    assert.equal(api.platformApiError(error).status, 400);
    assert.deepEqual(await state(), before);
  });
});

test("清空名单允许解绑停用的本机构家长，但不能清理外机构或无家长角色的账号", async (t) => {
  const f = await fixture(t);
  await f.db.batch([
    f.db.prepare("UPDATE users SET status='disabled' WHERE id='guardian-1'"),
    f.db.prepare("UPDATE role_memberships SET status='disabled' WHERE tenant_id='tenant-a' AND user_id='guardian-1'"),
    f.db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES ('tenant-b','student-other','guardian')"),
    f.db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id) VALUES ('tenant-a','guardian-1','student-old'),('tenant-b','guardian-1','student-other'),('tenant-b','student-other','student-other')"),
  ]);
  await api.setGuardianLinks(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", guardianUserId: "guardian-1", studentUserIds: [] });
  const remaining = (await f.db.prepare("SELECT tenant_id,guardian_user_id,student_user_id FROM guardian_student_links ORDER BY guardian_user_id").all()).results;
  assert.deepEqual(remaining, [
    { tenant_id: "tenant-b", guardian_user_id: "guardian-1", student_user_id: "student-other" },
    { tenant_id: "tenant-b", guardian_user_id: "student-other", student_user_id: "student-other" },
  ]);
  for (const guardianUserId of ["student-other", "student-1", "missing"]) {
    await assert.rejects(api.setGuardianLinks(f.db, { tenantId: "tenant-a", actorUserId: "admin-a", guardianUserId, studentUserIds: [] }), /invalid_guardian_id/);
  }
  assert.equal(await f.audits(), 1);
  assert.deepEqual((await f.db.prepare("SELECT tenant_id,guardian_user_id,student_user_id FROM guardian_student_links ORDER BY guardian_user_id").all()).results, remaining);
});
