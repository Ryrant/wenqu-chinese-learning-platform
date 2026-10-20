import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase } from './app/lib/platform-runtime-node';
    export { setPlatformRuntime } from './app/lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './app/lib/platform-store';
    export { createSessionToken } from './app/lib/auth-token';
    export { parseWorkspaceSections, readWorkspace, workspaceServices } from './app/lib/workspace-service';
    export { GET as workspace } from './app/api/v1/workspace/route';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function observeDatabase(db) {
  const executed = [];
  function observe(statement, sql) {
    return {
      bind: (...values) => observe(statement.bind(...values), sql),
      first: (...args) => { executed.push(sql); return statement.first(...args); },
      all: (...args) => { executed.push(sql); return statement.all(...args); },
      run: (...args) => { executed.push(sql); return statement.run(...args); },
    };
  }
  return { executed, database: { prepare: (sql) => observe(db.prepare(sql), sql), batch: (...args) => db.batch(...args) } };
}

async function fixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: {} });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name,region) VALUES ('school','自定义机构','cn'),('other-school','另一机构','my')"),
    ...["admin", "teacher", "other-teacher", "student", "other-student", "guardian", "outsider"].map((id) =>
      db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    ...["admin", "teacher", "other-teacher", "student", "other-student", "guardian"].map((id) =>
      db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('school',?,?,'active')")
        .bind(id, id.startsWith("other-") ? id.slice(6) : id)),
    db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('other-school','outsider','student','active')"),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','本班','A2','teacher','2026'),('other-class','school','其他班','A2','other-teacher','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student'),('school','other-class','other-student')"),
    db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id,status) VALUES ('school','guardian','student','active')"),
    db.prepare("INSERT INTO learning_objectives(id,tenant_id,code,title,skill,level) VALUES ('goal','school','A2-1','阅读目标','阅读','A2'),('foreign-goal','other-school','A2-2','其他机构目标','阅读','A2')"),
    db.prepare("INSERT INTO diagnostic_items(id,tenant_id,objective_id,level,prompt,options_json,correct_option,explanation,created_by) VALUES ('item','school','goal','A2','选择答案','[\"甲\",\"乙\"]',1,'答案说明','admin')"),
    db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,created_by) VALUES ('task','school','class','阅读任务','文字','published','teacher'),('other-task','school','other-class','其他班任务','文字','published','other-teacher')"),
    db.prepare("INSERT INTO assignment_objectives(tenant_id,assignment_id,objective_id) VALUES ('school','task','goal')"),
    db.prepare("INSERT INTO submissions(id,tenant_id,assignment_id,student_user_id,text_answer,score,review_status,reviewed_at) VALUES ('work','school','task','student','本班作品',80,'reviewed',CURRENT_TIMESTAMP),('other-work','school','other-task','other-student','其他班作品',90,'reviewed',CURRENT_TIMESTAMP)"),
    db.prepare("INSERT INTO mastery_snapshots(tenant_id,student_user_id,objective_id,mastery,evidence_count) VALUES ('school','student','goal',0.2,1),('school','student','goal',0.8,2)"),
    db.prepare("INSERT INTO source_documents(id,tenant_id,title,media_type,created_by) VALUES ('source','school','资料','text/plain','teacher')"),
    db.prepare("INSERT INTO lesson_plans(id,tenant_id,title,topic,level,duration_minutes,created_by) VALUES ('lesson','school','教案','阅读','A2',30,'teacher')"),
    db.prepare("INSERT INTO notifications(id,tenant_id,user_id,title,detail) VALUES ('notice','school','student','新任务','阅读任务')"),
  ]);
  const observed = observeDatabase(db);
  const context = (role) => ({ db: observed.database, tenantId: "school", userId: role, userEmail: `${role}@example.test`, displayName: role, roles: [role] });
  const read = (role, include, studentId) => api.readWorkspace(context(role), { sections: api.parseWorkspaceSections(include), studentId });
  return { db, ...observed, context, read };
}

const metadataKeys = ["workspace", "user", "availableStudents", "selectedStudent", "generatedAt"];

test("workspace include parser accepts explicit groups and rejects unknown or empty values", () => {
  assert.equal(api.parseWorkspaceSections(null).size, 12);
  assert.deepEqual([...api.parseWorkspaceSections("bootstrap")], []);
  assert.deepEqual([...api.parseWorkspaceSections("bootstrap, teaching,notifications,teaching")], ["teaching", "notifications"]);
  for (const value of ["", "bogus", "teaching,", "bootstrap,secret"]) {
    assert.throws(() => api.parseWorkspaceSections(value), /invalid_workspace_include/);
  }
});

test("bootstrap reads actual tenant metadata without executing unrelated workspace SQL", async (t) => {
  const f = await fixture(t);
  const data = await f.read("admin", "bootstrap");
  assert.deepEqual(Object.keys(data).sort(), metadataKeys.toSorted());
  assert.deepEqual(data.workspace, { tenantId: "school", name: "自定义机构", region: "cn" });
  assert.equal("sampleData" in data.workspace, false);
  assert.equal(f.executed.length, 1);
  assert.match(f.executed[0], /FROM tenants/);
});

test("requesting notifications does not load teaching, analytics, settings or documents", async (t) => {
  const f = await fixture(t);
  const data = await f.read("student", "notifications");
  assert.deepEqual(Object.keys(data).sort(), [...metadataKeys, "notifications"].toSorted());
  assert.equal(data.notifications[0].id, "notice");
  assert.equal(f.executed.length, 2);
  assert.doesNotMatch(f.executed.join("\n"), /FROM (assignments|submissions|app_settings|source_documents|mastery_snapshots)/);
});

test("teaching partitions retain teacher and student class boundaries", async (t) => {
  const f = await fixture(t);
  for (const role of ["teacher", "student"]) {
    f.executed.length = 0;
    const data = await f.read(role, "teaching");
    assert.deepEqual(data.classes.map((item) => item.id), ["class"]);
    assert.deepEqual(data.assignments.map((item) => item.id), ["task"]);
    assert.equal("submissions" in data, false);
    assert.doesNotMatch(f.executed.join("\n"), /source_documents|diagnostic_attempts|app_settings|learning_trial_records/);
  }
  assert.equal((await f.read("admin", "teaching")).classes.length, 2);
});

test("curriculum partitions do not reveal diagnostic answers to students", async (t) => {
  const f = await fixture(t);
  const data = await f.read("student", "curriculum");
  assert.deepEqual(data.learningObjectives.map((item) => item.id), ["goal"]);
  assert.equal(data.diagnosticItems[0].id, "item");
  assert.equal("correct_option" in data.diagnosticItems[0], false);
  assert.equal("explanation" in data.diagnosticItems[0], false);
  assert.equal((await f.read("admin", "curriculum")).diagnosticItems[0].correct_option, 1);
  assert.deepEqual((await f.read("guardian", "curriculum")).diagnosticItems, []);
});

test("student curriculum limits each diagnostic level independently and excludes inactive items", async (t) => {
  const f = await fixture(t);
  await f.db.batch([
    ...Array.from({ length: 31 }, (_, index) => f.db.prepare("INSERT INTO diagnostic_items(id,tenant_id,objective_id,level,prompt,options_json,correct_option,sort_order,created_by) VALUES (?,'school','goal','A2','题目','[\"甲\",\"乙\"]',0,?,'admin')").bind(`extra-${index}`, index + 1)),
    f.db.prepare("INSERT INTO diagnostic_items(id,tenant_id,objective_id,level,prompt,options_json,correct_option,created_by) VALUES ('b2','school','goal','B2','B2题目','[\"甲\",\"乙\"]',0,'admin')"),
    f.db.prepare("INSERT INTO diagnostic_items(id,tenant_id,objective_id,level,prompt,options_json,correct_option,status,created_by) VALUES ('inactive','school','goal','B2','停用题目','[\"甲\",\"乙\"]',0,'inactive','admin')"),
  ]);
  const data = await f.read("student", "curriculum");
  assert.equal(data.diagnosticItems.filter((item) => item.level === "A2").length, 30);
  assert.deepEqual(data.diagnosticItems.filter((item) => item.level === "B2").map((item) => item.id), ["b2"]);
  assert.equal(data.diagnosticItems.some((item) => item.id === "extra-30"), false);
});

test("progress retains aggregation and access boundaries without returning internal curriculum dependencies", async (t) => {
  const f = await fixture(t);
  for (const role of ["student", "teacher", "guardian"]) {
    const data = await f.read(role, "progress");
    assert.deepEqual(data.submissions.map((item) => item.id), ["work"]);
    assert.equal("learningObjectives" in data, false);
    assert.equal("diagnosticItems" in data, false);
    assert.equal("classes" in data, false);
    if (role !== "teacher") {
      assert.equal(data.weeklyReport.submittedCount, 1);
      assert.equal(data.weeklyReport.reviewedCount, 1);
      assert.equal(data.weeklyReport.averageScore, 80);
      assert.equal(data.weeklyReport.masteryAverage, 80);
      assert.equal(data.mastery.length, 1);
      assert.equal(data.mastery[0].mastery, 0.8);
    }
  }
});

test("guardian selection is authorized before any requested group is loaded", async (t) => {
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id,status) VALUES ('school','guardian','student','active')").run();
  const data = await f.read("guardian", "bootstrap");
  assert.deepEqual(data.selectedStudent, { id: "student", displayName: "student" });
  assert.deepEqual(data.availableStudents, [{ id: "student", displayName: "student" }]);
  f.executed.length = 0;
  await assert.rejects(f.read("guardian", "teaching,progress", "other-student"), /forbidden/);
  assert.doesNotMatch(f.executed.join("\n"), /FROM (assignments|submissions|mastery_snapshots)/);
  await f.db.prepare("UPDATE guardian_student_links SET status='disabled'").run();
  await assert.rejects(f.read("guardian", "bootstrap", "student"), /forbidden/);
});

test("non-admin partition requests retain empty restricted collections", async (t) => {
  const f = await fixture(t);
  const data = await f.read("student", "members,audits,content,lessons,quality,trials");
  for (const field of ["members", "guardianLinks", "invitations", "audits", "documents", "lessonPlans", "trialEntries"]) assert.deepEqual(data[field], []);
  assert.equal(data.qualityMetrics, null);
  assert.equal(f.executed.length, 1);
});

test("full reads remain compatible and shared curriculum objectives execute once", async (t) => {
  const f = await fixture(t);
  const data = await f.read("admin", null);
  for (const field of ["classes", "assignments", "submissions", "submissionReviews", "mastery", "masteryMatrix", "learningObjectives", "diagnosticItems", "diagnosticSummary", "recommendations", "learningPlan", "learningSequences", "sequenceSources", "weeklyReport", "documents", "lessonPlans", "notifications", "consents", "audits", "members", "guardianLinks", "invitations", "qualityMetrics", "trialEntries", "platformSettings", "services"]) assert.ok(field in data, field);
  assert.equal(f.executed.filter((sql) => /^SELECT \* FROM learning_objectives WHERE/.test(sql)).length, 1);
  assert.equal(data.services.database.label, "SQLite 业务数据库");
  assert.equal(data.services.storage.status, "configured_unverified");
});

test("quality partitions retain actual denominators and latest measured evidence", async (t) => {
  const f = await fixture(t);
  const data = await f.read("admin", "quality");
  assert.equal(data.qualityMetrics.objectiveCoverage.numerator, 1);
  assert.equal(data.qualityMetrics.objectiveCoverage.denominator, 2);
  assert.equal(data.qualityMetrics.objectiveCoverage.value, 50);
  assert.equal(data.qualityMetrics.pendingReviews.value, 0);
  assert.equal(data.qualityMetrics.lowMasteryObjectives.value, 0);
  assert.equal(data.qualityMetrics.consentCoverage.denominator, 2);
  assert.equal(data.qualityMetrics.consentCoverage.numerator, 0);
  assert.equal(data.qualityMetrics.pendingContent.details[0].id, "source");
  assert.equal("services" in data, false);
  assert.doesNotMatch(f.executed.join("\n"), /FROM (lesson_plans|app_settings|learning_trial_records)/);
});

test("runtime and saved credentials describe configured capabilities without claiming verified availability", async () => {
  const settings = { aiKey: "", openAiKey: "", speechKey: "", moderationKey: "", aiModel: "fixture-model", jwtTtlSeconds: 3600 };
  const cloud = api.workspaceServices({ kind: "cloudflare", database: {}, storage: {} }, settings);
  assert.equal(cloud.database.label, "D1 业务数据库");
  assert.match(cloud.storage.label, /^R2/);
  assert.equal(cloud.generation.status, "template");
  const configured = api.workspaceServices({ kind: "node", database: {}, storage: {} }, { ...settings, openAiKey: "saved-credential", speechKey: "saved-credential", moderationKey: "saved-credential" });
  assert.equal(configured.generation.status, "configured_unverified");
  assert.equal(configured.speech.status, "manual");
  assert.equal(configured.moderation.status, "rules");
  assert.equal(JSON.stringify(configured).includes("saved-credential"), false);
  assert.equal(api.workspaceServices({ database: {}, storage: null }, settings).storage.status, "unconfigured");
});

test("HTTP partition requests retain session, password and include validation gates", async (t) => {
  const f = await fixture(t);
  assert.equal((await api.workspace(new Request("http://127.0.0.1/api/v1/workspace?include=bootstrap"))).status, 401);
  const secret = await api.ensureSiteJwtSecret(f.db);
  const now = Math.floor(Date.now() / 1000);
  const token = await api.createSessionToken({ email: "student@example.test", displayName: "student", iat: now, exp: now + 3600 }, secret);
  const request = (include) => new Request(`http://127.0.0.1/api/v1/workspace?include=${include}`, { headers: { cookie: `huawen_zhixing_session=${token}` } });
  assert.equal((await api.workspace(request("bootstrap"))).status, 200);
  assert.equal((await api.workspace(request("unknown"))).status, 400);
  await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id='student'").run();
  const blocked = await api.workspace(request("bootstrap"));
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "password_change_required" });
});
