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
    export { parseWorkspaceSections, readWorkspace } from './lib/workspace-service';
    export { familyCommands } from './lib/commands/family';
    export { GET as media } from './app/api/v1/diagnostic-media/[id]/route';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  const objects = new Map();
  const storage = { get: async (key) => {
    const item = objects.get(key);
    return item ? { body: new Blob([item.content]).stream(), customMetadata: item.metadata, httpMetadata: { contentType: "image/png" } } : null;
  } };
  api.setPlatformRuntime({ kind: "node", database: db, storage });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  const members = {
    admin: ["admin"], teacher: ["teacher"], mixed: ["teacher", "guardian"],
    student: ["student"], child: ["student"], guardian: ["guardian"], secondGuardian: ["guardian"],
    otherTeacher: ["teacher"], foreign: ["student"],
  };
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','本机构'),('foreign-school','其他机构')"),
    ...Object.keys(members).map((id) => db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    ...Object.entries(members).flatMap(([id, roles]) => roles.map((role) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES (?,?,?,'active')").bind(id === "foreign" ? "foreign-school" : "school", id, role))),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','孩子所在班','A2','teacher','2026'),('own-class','school','复合角色任教班','A2','mixed','2026'),('other-class','school','另一个孩子的班','A2','otherTeacher','2026'),('foreign-class','foreign-school','其他机构班','A2','teacher','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student'),('school','other-class','child'),('foreign-school','foreign-class','foreign')"),
    db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id,status) VALUES ('school','guardian','student','active'),('school','guardian','child','active'),('school','secondGuardian','student','active'),('school','mixed','student','active'),('foreign-school','guardian','foreign','active')"),
    ...["class", "own-class", "other-class", "foreign-class"].flatMap((classId) => ["draft", "published"].map((status) =>
      db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,created_by) VALUES (?,?,?,?,?,?,?)")
        .bind(`${classId}-${status}`, classId === "foreign-class" ? "foreign-school" : "school", classId, `${classId}-${status}`, "文字", status, "teacher"))),
  ]);
  const context = (userId, roles = members[userId]) => ({ db, tenantId: userId === "foreign" ? "foreign-school" : "school", userId, userEmail: `${userId}@example.test`, displayName: userId, roles });
  const read = (userId, include, studentId, roles) => api.readWorkspace(context(userId, roles), { sections: api.parseWorkspaceSections(include), studentId });
  const consent = (userId, studentUserId, status = "granted", roles) => api.familyCommands.update_consent({ studentUserId, scope: "learning_analytics", status }, context(userId, roles), "update_consent");
  const secret = await api.ensureSiteJwtSecret(db);
  const media = async (userId, id) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await api.createSessionToken({ email: `${userId}@example.test`, displayName: userId, iat: now, exp: now + 3600 }, secret);
    return api.media(new Request(`http://127.0.0.1/api/v1/diagnostic-media/${id}`, { headers: { cookie: `huawen_zhixing_session=${token}` } }), { params: Promise.resolve({ id }) });
  };
  const addMedia = (id, tenantId = "school") => objects.set(`${tenantId}/diagnostic-media/${id}`, { content: `fixture-${id}`, metadata: { tenantId, kind: "image", createdBy: "teacher" } });
  return { db, read, consent, media, addMedia };
}

test("学生和家长仅接收已发布作业，草稿权限按任教班级判定", async (t) => {
  const f = await fixture(t);
  const assignmentIds = async (...args) => (await f.read(...args)).assignments.map((row) => row.id).sort();
  assert.deepEqual(await assignmentIds("student", "teaching"), ["class-published"]);
  assert.deepEqual(await assignmentIds("guardian", "teaching", "student"), ["class-published"]);
  assert.deepEqual(await assignmentIds("guardian", "teaching", "child"), ["other-class-published"]);
  assert.deepEqual(await assignmentIds("teacher", "teaching"), ["class-draft", "class-published"]);
  assert.deepEqual(await assignmentIds("mixed", "teaching", "student"), ["class-published", "own-class-draft", "own-class-published"]);
  assert.equal((await assignmentIds("admin", "teaching")).length, 6);
  assert.deepEqual(await assignmentIds("foreign", "teaching"), ["foreign-class-published"]);

  await f.db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','mixed')").run();
  assert.deepEqual(await assignmentIds("mixed", "teaching", undefined, ["teacher", "student"]), ["class-published", "own-class-draft", "own-class-published"]);
});

test("退班后拒绝班级新素材，仍允许当前监护人回看孩子已有作品和诊断答案素材", async (t) => {
  const f = await fixture(t);
  const [oldMedia, newMedia, answerMedia] = Array.from({ length: 3 }, () => crypto.randomUUID());
  for (const id of [oldMedia, newMedia, answerMedia]) f.addMedia(id);
  await f.db.batch([
    f.db.prepare("UPDATE assignments SET diagnostic_media_id=? WHERE id='class-published'").bind(oldMedia),
    f.db.prepare("INSERT INTO submissions(id,tenant_id,assignment_id,student_user_id,diagnostic_snapshot_json) VALUES ('historical-work','school','class-published','student',?)").bind(JSON.stringify({ mediaId: oldMedia })),
    f.db.prepare("INSERT INTO diagnostic_attempts(id,tenant_id,student_user_id,level,score) VALUES ('attempt','school','student','A2',80)"),
    f.db.prepare("INSERT INTO diagnostic_answers(id,tenant_id,attempt_id,item_id,selected_option,is_correct,evidence_json) VALUES ('answer','school','attempt','historical-item',0,1,?)").bind(JSON.stringify({ mediaId: answerMedia })),
  ]);
  assert.equal((await f.media("guardian", oldMedia)).status, 200);
  await f.db.batch([
    f.db.prepare("UPDATE enrollments SET status='disabled' WHERE tenant_id='school' AND student_user_id='student'"),
    f.db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,created_by,diagnostic_media_id) VALUES ('new-assignment','school','class','退班后新任务','文字','published','teacher',?)").bind(newMedia),
  ]);
  const teaching = await f.read("guardian", "teaching", "student");
  assert.equal(teaching.classes.some((row) => row.id === "class"), false);
  assert.deepEqual(teaching.assignments, []);
  assert.equal((await f.media("guardian", newMedia)).status, 404);
  assert.equal((await f.media("student", newMedia)).status, 404);
  assert.equal((await f.media("guardian", oldMedia)).status, 200);
  assert.equal((await f.media("guardian", answerMedia)).status, 200);
  assert.equal((await f.media("foreign", oldMedia)).status, 404);

  await f.db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE tenant_id='school' AND guardian_user_id='guardian' AND student_user_id='student'").run();
  assert.equal((await f.media("guardian", oldMedia)).status, 404);
  assert.equal((await f.media("guardian", answerMedia)).status, 404);
  assert.equal((await f.media("student", oldMedia)).status, 200);
});

test("授权查询只读选中孩子，复合角色及历史签署人不能绕过有效监护关联", async (t) => {
  const f = await fixture(t);
  await f.consent("guardian", "student");
  await f.consent("guardian", "child");
  const selected = await f.read("guardian", "consents", "student");
  assert.deepEqual(selected.consents.map((row) => row.student_user_id), ["student"]);
  assert.deepEqual((await f.read("mixed", "consents", "student")).consents.map((row) => row.student_user_id), ["student"]);
  assert.deepEqual((await f.read("teacher", "consents")).consents, []);
  assert.deepEqual((await f.read("student", "consents")).consents.map((row) => row.student_user_id), ["student"]);
  assert.deepEqual((await f.read("foreign", "consents")).consents, []);
  await assert.rejects(f.read("guardian", "consents", "foreign"), /forbidden/);
  await f.db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE tenant_id='school' AND guardian_user_id='guardian' AND student_user_id='student'").run();
  await f.consent("secondGuardian", "student", "withdrawn");
  const row = await f.db.prepare("SELECT guardian_user_id,status FROM consent_records WHERE tenant_id='school' AND student_user_id='student'").first();
  assert.deepEqual({ ...row }, { guardian_user_id: "secondGuardian", status: "withdrawn" });
  assert.deepEqual((await f.read("guardian", "consents", "child")).consents.map((item) => item.student_user_id), ["child"]);
  await assert.rejects(f.read("guardian", "consents", "student"), /forbidden/);
  await assert.rejects(f.consent("guardian", "student"), /forbidden/);
  await f.db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE tenant_id='school' AND guardian_user_id='guardian'").run();
  assert.deepEqual((await f.read("guardian", "consents")).consents, []);
});

test("授权更新与审计同一事务，审计失败时不保留状态或签署人变更", async (t) => {
  const f = await fixture(t);
  await f.consent("guardian", "student");
  const before = await f.db.prepare("SELECT * FROM consent_records WHERE student_user_id='student'").first();
  await f.db.prepare("CREATE TRIGGER reject_consent_audit BEFORE INSERT ON audit_logs WHEN NEW.action='consent.updated' BEGIN SELECT RAISE(ABORT,'fixture_audit_failure'); END").run();
  await assert.rejects(f.consent("secondGuardian", "student", "withdrawn"), /fixture_audit_failure/);
  assert.deepEqual(await f.db.prepare("SELECT * FROM consent_records WHERE student_user_id='student'").first(), before);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='consent.updated'").first()).count, 1);
  await assert.rejects(f.consent("guardian", "child"), /fixture_audit_failure/);
  assert.equal(await f.db.prepare("SELECT id FROM consent_records WHERE student_user_id='child'").first(), null);
});
