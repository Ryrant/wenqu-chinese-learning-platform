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
    export { createSessionToken } from './lib/auth-token';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const db = new api.NodeSqliteDatabase("file::memory:");
  t.after(() => {
    db.close();
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  });
  await api.ensurePlatformSchema(db);
  const roles = { admin: "admin", guardian: "guardian", teacher: "teacher", student: "student", second: "student", archived: "student", foreign: "student" };
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','本机构'),('foreign-school','其他机构')"),
    ...Object.keys(roles).map((id) => db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    ...Object.entries(roles).map(([id, role]) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,?)").bind(id === "foreign" ? "foreign-school" : "school", id, role)),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','本班','A2','teacher','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id,status) VALUES ('school','class','student','active'),('school','class','archived','disabled')"),
    db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id) VALUES ('school','guardian','student'),('school','guardian','archived')"),
    db.prepare("INSERT INTO learning_objectives(id,tenant_id,code,title,skill,level) VALUES ('goal','school','G1','学习目标','reading','A2')"),
    db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,created_by) VALUES ('task','school','class','历史任务','文字','published','teacher')"),
    db.prepare("INSERT INTO submissions(id,tenant_id,assignment_id,student_user_id,text_answer,review_status,score) VALUES ('historical-work','school','task','archived','历史作品','reviewed',80)"),
    db.prepare("UPDATE users SET status='disabled' WHERE id='archived'"),
    db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id='archived'"),
  ]);
  api.setPlatformRuntime({ kind: "node", database: db, storage: null });
  const app = api.createApiApp(), secret = await api.ensureSiteJwtSecret(db);
  const request = async (userId, path, json) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await api.createSessionToken({ email: `${userId}@example.test`, displayName: userId, iat: now, exp: now + 3600, sessionVersion: 0 }, secret);
    const response = await app.fetch(new Request(`http://127.0.0.1${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: { cookie: `huawen_zhixing_session=${token}`, ...(json === undefined ? {} : { "content-type": "application/json" }) },
      body: json === undefined ? undefined : JSON.stringify(json),
    }));
    return { status: response.status, data: await response.json() };
  };
  const action = (json, userId = "admin") => request(userId, "/api/v1/workspace/actions", json);
  const state = async () => Object.fromEntries(await Promise.all([
    "enrollments", "guardian_student_links", "learning_recommendations", "consent_records", "audit_logs",
  ].map(async (table) => [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
  return { db, request, action, state };
}

const invalidLists = [
  ["缺失", undefined], ["null", null], ["字符串", "student"], ["对象", {}],
  ["数字项", ["student", 1]], ["null项", ["student", null]],
  ["对象项", ["student", {}]], ["空字符串", ["student", ""]],
  ["空白项", ["student", "  "]], ["超长项", ["student", "x".repeat(121)]],
];

test("编班及监护名单拒绝格式错误，保留已有关系和审计", async (t) => {
  const f = await fixture(t), before = await f.state();
  for (const action of ["set_class_enrollments", "set_guardian_links"]) {
    for (const [name, studentUserIds] of invalidLists) {
      const result = await f.action({ action, classId: "class", guardianUserId: "guardian", studentUserIds });
      assert.equal(result.status, 400, `${action}: ${name}`);
      assert.deepEqual(result.data, { error: "invalid_student_ids" });
      assert.deepEqual(await f.state(), before, `${action}: ${name} 不得写入`);
    }
  }
});

test("编班比较名单严格验证每项，格式错误不得清空当前学籍", async (t) => {
  const f = await fixture(t), before = await f.state();
  for (const [name, expectedStudentUserIds] of invalidLists.filter(([, value]) => value !== undefined)) {
    const result = await f.action({ action: "set_class_enrollments", classId: "class", studentUserIds: [], expectedStudentUserIds });
    assert.equal(result.status, 400, name);
    assert.deepEqual(result.data, { error: "invalid_expected_student_ids" });
    assert.deepEqual(await f.state(), before, name);
  }
});

test("合法名单支持规范化去重，只有显式空数组才清空关联及学籍", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.action({ action: "set_guardian_links", guardianUserId: "guardian", studentUserIds: [" student ", "second", "student"] })).status, 200);
  assert.deepEqual((await f.db.prepare("SELECT student_user_id FROM guardian_student_links WHERE guardian_user_id='guardian' ORDER BY student_user_id").all()).results, [{ student_user_id: "second" }, { student_user_id: "student" }]);
  assert.equal((await f.action({ action: "set_guardian_links", guardianUserId: "guardian", studentUserIds: [] })).status, 200);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM guardian_student_links WHERE guardian_user_id='guardian'").first()).n, 0);

  const updated = await f.action({ action: "set_class_enrollments", classId: "class", studentUserIds: [" student ", "second", "student"], expectedStudentUserIds: [" student "] });
  assert.equal(updated.status, 200);
  const cleared = await f.action({ action: "set_class_enrollments", classId: "class", studentUserIds: [], expectedStudentUserIds: ["student", "second"] });
  assert.equal(cleared.status, 200);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE class_id='class' AND status='active'").first()).n, 0);
  assert.equal((await f.action({ action: "set_class_enrollments", classId: "class", studentUserIds: ["student"], expectedStudentUserIds: [] })).status, 200);
});

test("管理员写入仍校验学生对象归属，外机构、缺失及非学生账号均拒绝且不写入", async (t) => {
  const f = await fixture(t), before = await f.state();
  for (const studentUserId of ["foreign", "missing", "teacher"]) {
    for (const action of ["create_intervention", "update_consent"]) {
      const result = await f.action({ action, studentUserId, objectiveId: "goal", title: "学习支持", detail: "教师安排", scope: "learning_analytics", status: "granted" });
      assert.equal(result.status, 403, `${action}: ${studentUserId}`);
      assert.deepEqual(result.data, { error: "forbidden" });
      assert.deepEqual(await f.state(), before, `${action}: ${studentUserId} 不得写入`);
    }
  }
  assert.equal((await f.action({ action: "create_intervention", studentUserId: "student", objectiveId: "goal", title: "学习支持", detail: "教师安排" })).status, 201);
  assert.equal((await f.action({ action: "update_consent", studentUserId: "student", scope: "learning_analytics", status: "granted" })).status, 200);
});

test("学生停用或退班后保留有效监护人的历史作品读取，撤销监护后立即拒绝", async (t) => {
  const f = await fixture(t);
  const path = "/api/v1/workspace?include=progress&studentId=archived";
  const historical = await f.request("guardian", path);
  assert.equal(historical.status, 200);
  assert.deepEqual(historical.data.submissions.map((row) => row.id), ["historical-work"]);
  await f.db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE guardian_user_id='guardian' AND student_user_id='archived'").run();
  assert.deepEqual(await f.request("guardian", path), { status: 403, data: { error: "forbidden" } });
});
