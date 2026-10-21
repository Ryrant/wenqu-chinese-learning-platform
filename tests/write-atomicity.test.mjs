import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createSessionToken } from './lib/auth-token';
    export { POST as actions } from './app/api/v1/workspace/actions/route';
    export { setClassEnrollments } from './lib/learning-loop-service';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const rubric = [{ name: "内容", weight: 40 }, { name: "表达", weight: 35 }, { name: "文化", weight: 25 }];

async function fixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: {} });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','事务测试机构')"),
    ...["admin", "teacher", "student-a", "student-b", "student-c"].map((id) => db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    ...["admin", "teacher", "student-a", "student-b", "student-c"].map((id) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('school',?,?,'active')").bind(id, id.startsWith("student-") ? "student" : id)),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','测试班','A2','teacher','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student-a')"),
    db.prepare("INSERT INTO learning_objectives(id,tenant_id,code,title,skill,level) VALUES ('goal','school','A2-1','目标','阅读','A2')"),
  ]);
  const secret = await api.ensureSiteJwtSecret(db);
  const cookies = {};
  for (const role of ["admin", "teacher"]) {
    const now = Math.floor(Date.now() / 1000);
    cookies[role] = `huawen_zhixing_session=${await api.createSessionToken({ email: `${role}@example.test`, displayName: role, iat: now, exp: now + 3600 }, secret)}`;
  }
  const act = async (role, action, body = {}) => {
    const response = await api.actions(new Request("http://127.0.0.1/api/v1/workspace/actions", { method: "POST", headers: { cookie: cookies[role], "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) }));
    return { status: response.status, data: await response.json() };
  };
  const snapshot = async () => Object.fromEntries(await Promise.all(["classes", "assignments", "assignment_objectives", "enrollments", "audit_logs"].map(async (table) => [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
  const roster = async () => (await db.prepare("SELECT student_user_id FROM enrollments WHERE tenant_id='school' AND class_id='class' AND status='active' ORDER BY student_user_id").all()).results.map((row) => row.student_user_id);
  const auditCount = async (action) => (await db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action=?").bind(action).first()).count;
  const blockAudit = async (action) => db.prepare(`CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'fixture_audit_failure'); END`).run();
  const unblockAudit = async () => db.prepare("DROP TRIGGER reject_audit").run();
  const assignment = { classId: "class", title: "测试作业", activityType: "文字", objectiveIds: ["goal"], rubric };
  return { db, act, snapshot, roster, auditCount, blockAudit, unblockAudit, assignment };
}

test("创建班级的审计失败时整个写入回滚，重试仅产生一个班级", async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  await f.blockAudit("class.created");
  const failed = await f.act("teacher", "create_class", { name: "新班级", level: "A2" });
  assert.equal(failed.status, 500);
  assert.match(failed.data.error, /fixture_audit_failure/);
  assert.deepEqual(await f.snapshot(), before);
  await f.unblockAudit();
  assert.equal((await f.act("teacher", "create_class", { name: "新班级", level: "A2" })).status, 201);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM classes WHERE name='新班级'").first()).count, 1);
  assert.equal(await f.auditCount("class.created"), 1);
});

test("创建作业和关联目标与审计一起回滚，重试没有遗留作业或目标关联", async (t) => {
  const f = await fixture(t);
  const before = await f.snapshot();
  await f.blockAudit("assignment.created");
  assert.equal((await f.act("teacher", "create_assignment", f.assignment)).status, 500);
  assert.deepEqual(await f.snapshot(), before);
  await f.unblockAudit();
  const retry = await f.act("teacher", "create_assignment", f.assignment);
  assert.equal(retry.status, 201);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM assignments").first()).count, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM assignment_objectives WHERE assignment_id=?").bind(retry.data.id).first()).count, 1);
  assert.equal(await f.auditCount("assignment.created"), 1);
});

test("发布作业审计失败不提前发布，并发发布仅记录一次成功审计", async (t) => {
  const f = await fixture(t);
  const created = await f.act("teacher", "create_assignment", f.assignment);
  assert.equal(created.status, 201);
  const before = await f.snapshot();
  await f.blockAudit("assignment.published");
  assert.equal((await f.act("teacher", "publish_assignment", { id: created.data.id })).status, 500);
  assert.deepEqual(await f.snapshot(), before);
  await f.unblockAudit();
  const results = await Promise.all(Array.from({ length: 2 }, () => f.act("teacher", "publish_assignment", { id: created.data.id })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await f.db.prepare("SELECT status FROM assignments WHERE id=?").bind(created.data.id).first()).status, "published");
  assert.equal(await f.auditCount("assignment.published"), 1);
});

test("编班业务与审计一起回滚，旧名单提交返回409且不修改数据", async (t) => {
  const f = await fixture(t);
  const body = { classId: "class", expectedStudentUserIds: ["student-a"], studentUserIds: ["student-b"] };
  const before = await f.snapshot();
  await f.blockAudit("class.enrollments_updated");
  assert.equal((await f.act("admin", "set_class_enrollments", body)).status, 500);
  assert.deepEqual(await f.snapshot(), before);
  await f.unblockAudit();
  assert.equal((await f.act("admin", "set_class_enrollments", body)).status, 200);
  assert.deepEqual(await f.roster(), ["student-b"]);
  const committed = await f.snapshot();
  assert.deepEqual(await f.act("admin", "set_class_enrollments", body), { status: 409, data: { error: "enrollment_conflict" } });
  assert.deepEqual(await f.snapshot(), committed);
  assert.equal(await f.auditCount("class.enrollments_updated"), 1);
  assert.equal((await f.act("admin", "set_class_enrollments", { classId: "class", expectedStudentUserIds: "invalid", studentUserIds: [] })).status, 400);
});

test("同时基于旧名单的两个编班请求只有一个成功，失败请求不丢失成功请求的学生", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(["student-b", "student-c"].map((studentId) => f.act("admin", "set_class_enrollments", { classId: "class", expectedStudentUserIds: ["student-a"], studentUserIds: ["student-a", studentId] })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.deepEqual(await f.roster(), results.find((result) => result.status === 200).data.studentUserIds.toSorted());
  assert.equal(await f.auditCount("class.enrollments_updated"), 1);
  const current = await f.roster();
  assert.equal((await f.act("admin", "set_class_enrollments", { classId: "class", expectedStudentUserIds: current.toReversed(), studentUserIds: [] })).status, 200);
  assert.deepEqual(await f.roster(), []);
  assert.equal((await f.act("admin", "set_class_enrollments", { classId: "class", expectedStudentUserIds: [], studentUserIds: ["student-c"] })).status, 200);
  assert.deepEqual(await f.roster(), ["student-c"]);
  assert.equal((await f.act("admin", "set_class_enrollments", { classId: "class", studentUserIds: ["student-a"] })).status, 200, "旧客户端不传比较名单时继续兼容");
  assert.deepEqual(await f.roster(), ["student-a"]);
});

test("编班后续启用失败时恢复已停用名单，并撤销事务内审计凭据", async (t) => {
  const f = await fixture(t);
  const body = { classId: "class", expectedStudentUserIds: ["student-a"], studentUserIds: ["student-b"] };
  const before = await f.snapshot();
  await f.db.prepare("CREATE TRIGGER reject_enrollment BEFORE INSERT ON enrollments WHEN NEW.student_user_id='student-b' BEGIN SELECT RAISE(ABORT,'fixture_enrollment_failure'); END").run();
  assert.equal((await f.act("admin", "set_class_enrollments", body)).status, 500);
  assert.deepEqual(await f.snapshot(), before);
  await f.db.prepare("DROP TRIGGER reject_enrollment").run();
  assert.equal((await f.act("admin", "set_class_enrollments", body)).status, 200);
  assert.deepEqual(await f.roster(), ["student-b"]);
  assert.equal(await f.auditCount("class.enrollments_updated"), 1);
});

test("编班比较发生在事务内，验证完成后插入的并发学生也会触发冲突", async (t) => {
  const f = await fixture(t);
  let injected = false;
  const racedDatabase = {
    prepare: f.db.prepare.bind(f.db),
    batch: async (statements) => {
      if (!injected) {
        injected = true;
        await f.db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student-c')").run();
      }
      return f.db.batch(statements);
    },
  };
  const context = { db: racedDatabase, tenantId: "school", userId: "admin", userEmail: "admin@example.test", displayName: "admin", roles: ["admin"] };
  await assert.rejects(api.setClassEnrollments(racedDatabase, context, { classId: "class", expectedStudentUserIds: ["student-a"], studentUserIds: ["student-b"] }), /enrollment_conflict/);
  assert.deepEqual(await f.roster(), ["student-a", "student-c"]);
  assert.equal(await f.auditCount("class.enrollments_updated"), 0);
});
