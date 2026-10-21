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
    export { suggestTextReview } from './lib/assessment-service';
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
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','领域事务测试')"),
    ...["admin", "teacher", "student", "guardian"].map((id) => db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    ...["admin", "teacher", "student", "guardian"].map((id) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('school',?,?,'active')").bind(id, id)),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','测试班','A2','teacher','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student')"),
    db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id,status) VALUES ('school','guardian','student','active')"),
    db.prepare("INSERT INTO consent_records(id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES ('analytics','school','student','guardian','learning_analytics','granted')"),
    db.prepare("INSERT INTO learning_objectives(id,tenant_id,code,title,skill,level) VALUES ('goal','school','A2-1','阅读目标','阅读','A2')"),
    db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,rubric_json,created_by) VALUES ('task','school','class','阅读任务','文字','published',?,'teacher')").bind(JSON.stringify(rubric)),
    db.prepare("INSERT INTO assignment_objectives(tenant_id,assignment_id,objective_id) VALUES ('school','task','goal')"),
    db.prepare("INSERT INTO diagnostic_items(id,tenant_id,objective_id,level,prompt,options_json,correct_option,explanation,created_by) VALUES ('item','school','goal','A2','阅读题目','[\"甲\",\"乙\",\"丙\",\"丁\"]',0,'说明','admin')"),
    db.prepare("INSERT INTO learning_recommendations(id,tenant_id,student_user_id,objective_id,source_type,source_id,title,detail,due_at,status,created_by) VALUES ('review','school','student','goal','diagnostic','item','错题复习','复习内容',datetime('now','-1 day'),'pending','student')"),
    db.prepare("INSERT INTO submissions(id,tenant_id,assignment_id,student_user_id,text_answer,review_status) VALUES ('work','school','task','student','阅读任务完成情况','auto')"),
    db.prepare("INSERT INTO source_documents(id,tenant_id,title,media_type,processing_status,created_by) VALUES ('source','school','阅读教材','text/plain','published','teacher')"),
    db.prepare("INSERT INTO knowledge_chunks(id,tenant_id,source_document_id,content,published) VALUES ('chunk','school','source','阅读任务需要说明内容和表达理由。',1)"),
  ]);
  const secret = await api.ensureSiteJwtSecret(db);
  const cookies = {};
  for (const role of ["admin", "teacher", "student", "guardian"]) {
    const now = Math.floor(Date.now() / 1000);
    cookies[role] = `huawen_zhixing_session=${await api.createSessionToken({ email: `${role}@example.test`, displayName: role, iat: now, exp: now + 3600 }, secret)}`;
  }
  const act = async (role, action, body = {}) => {
    const response = await api.actions(new Request("http://127.0.0.1/api/v1/workspace/actions", { method: "POST", headers: { cookie: cookies[role], "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) }));
    return { status: response.status, data: await response.json() };
  };
  const snapshot = async () => Object.fromEntries(await Promise.all(["learning_recommendations", "notifications", "submissions", "submission_reviews", "learning_objectives", "diagnostic_items", "mastery_snapshots", "audit_logs"].map(async (table) => [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results])));
  const rejectAudit = async (action, invoke) => {
    const before = await snapshot();
    await db.prepare(`CREATE TRIGGER reject_domain_audit BEFORE INSERT ON audit_logs WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'fixture_domain_audit_failure'); END`).run();
    const failed = await invoke();
    assert.equal(failed.status, 500, JSON.stringify(failed));
    assert.match(failed.data.error, /fixture_domain_audit_failure/);
    assert.deepEqual(await snapshot(), before, `${action} 审计失败必须回滚全部业务状态`);
    await db.prepare("DROP TRIGGER reject_domain_audit").run();
    return invoke();
  };
  const familyTask = { studentUserId: "student", assignmentId: "task", objectiveId: "goal", title: "家庭交流", detail: "阅读任务交流" };
  const objective = { id: "goal", code: "A2-1", title: "更新后的目标", skill: "阅读", level: "A2", status: "active" };
  const item = { id: "item", objectiveId: "goal", level: "A2", prompt: "更新后的题目", options: ["甲", "乙", "丙", "丁"], correctOption: 1, explanation: "更新说明", status: "active" };
  return { db, act, snapshot, rejectAudit, familyTask, objective, item };
}

test("家庭任务创建、修改、归档及家长确认均与审计原子提交", async (t) => {
  const f = await fixture(t);
  const created = await f.rejectAudit("family_task.created", () => f.act("guardian", "create_family_task", f.familyTask));
  assert.equal(created.status, 201);
  const taskId = created.data.id;
  const updated = await f.rejectAudit("family_task.updated", () => f.act("guardian", "update_family_task", { ...f.familyTask, id: taskId, title: "更新家庭交流", revision: 1 }));
  assert.equal(updated.status, 200);
  const submitted = await f.act("student", "submit_text", { submissionId: crypto.randomUUID(), assignmentId: "task", familyTaskId: taskId, answer: "阅读任务已经完成，并与家长进行了交流。" });
  assert.equal(submitted.status, 201, JSON.stringify(submitted));
  const confirmed = await f.rejectAudit("family_submission.confirmed", () => f.act("guardian", "confirm_family_submission", { submissionId: submitted.data.id, helpLevel: "prompted" }));
  assert.equal(confirmed.status, 200);
  assert.equal((await f.db.prepare("SELECT family_help_level FROM submissions WHERE id=?").bind(submitted.data.id).first()).family_help_level, "prompted");
  const emptyTask = await f.act("guardian", "create_family_task", f.familyTask);
  assert.equal(emptyTask.status, 201);
  const archived = await f.rejectAudit("family_task.archived", () => f.act("guardian", "archive_family_task", { id: emptyTask.data.id }));
  assert.equal(archived.status, 200);
});

test("替代交流见证审计失败时不保存教师确认", async (t) => {
  const f = await fixture(t);
  const created = await f.act("guardian", "create_family_task", { ...f.familyTask, partner: "teacher" });
  assert.equal(created.status, 201);
  const submitted = await f.act("student", "submit_text", { submissionId: crypto.randomUUID(), assignmentId: "task", familyTaskId: created.data.id, answer: "阅读任务已经完成，并与老师进行了交流。" });
  assert.equal(submitted.status, 201);
  const witnessed = await f.rejectAudit("family_submission.witnessed", () => f.act("teacher", "confirm_alternative_exchange", { submissionId: submitted.data.id, helpLevel: "independent" }));
  assert.equal(witnessed.status, 200);
});

test("课程目标和诊断题新建及更新在审计失败时全部回滚，题目版本不提前增加", async (t) => {
  const f = await fixture(t);
  for (const [action, audit, body] of [
    ["upsert_learning_objective", "learning_objective.saved", f.objective],
    ["upsert_learning_objective", "learning_objective.saved", { ...f.objective, id: undefined, code: "A2-2" }],
    ["upsert_diagnostic_item", "diagnostic_item.saved", f.item],
    ["upsert_diagnostic_item", "diagnostic_item.saved", { ...f.item, id: undefined }],
  ]) {
    const result = await f.rejectAudit(audit, () => f.act("admin", action, body));
    assert.equal(result.status, body.id ? 200 : 201);
  }
  assert.equal((await f.db.prepare("SELECT revision FROM diagnostic_items WHERE id='item'").first()).revision, 2);
});

test("错题复习状态、掌握度证据与审计同事务，并发作答不重复增加证据", async (t) => {
  const f = await fixture(t);
  const retry = await f.rejectAudit("review_item.answered", () => f.act("student", "answer_review_item", { id: "review", selectedOption: 0, revision: 1 }));
  assert.equal(retry.status, 200);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count, 1);
  await f.db.prepare("UPDATE learning_recommendations SET status='pending',due_at=datetime('now','-1 day'),completed_at=NULL WHERE id='review'").run();
  const results = await Promise.all(Array.from({ length: 2 }, () => f.act("student", "answer_review_item", { id: "review", selectedOption: 0, revision: 1 })));
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.some((result) => result.status === 409 || result.status === 404));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count, 2);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='review_item.answered'").first()).count, 2);
});

test("教师干预创建及建议状态更新在审计失败时回滚", async (t) => {
  const f = await fixture(t);
  const created = await f.rejectAudit("intervention.created", () => f.act("teacher", "create_intervention", { studentUserId: "student", objectiveId: "goal", title: "阅读支持", detail: "先圈关键词再复述" }));
  assert.equal(created.status, 201);
  const changed = await f.rejectAudit("recommendation.status_updated", () => f.act("student", "update_recommendation_status", { id: created.data.id, status: "completed" }));
  assert.equal(changed.status, 200);
});

test("AI建议落库失败时回滚建议和待教师确认状态，使用本地模板且不伪造分数", async (t) => {
  const f = await fixture(t);
  const result = await f.rejectAudit("submission.ai_review_suggested", () => f.act("teacher", "suggest_text_review", { id: "work" }));
  assert.equal(result.status, 200);
  assert.equal(result.data.suggestedScore, null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM submission_reviews").first()).count, 1);
  assert.equal((await f.db.prepare("SELECT review_status FROM submissions WHERE id='work'").first()).review_status, "ai_suggested_pending_review");
});

test("AI生成完成前已被教师评价的作品不生成建议记录或成功审计", async (t) => {
  const f = await fixture(t);
  const racedDatabase = {
    prepare: f.db.prepare.bind(f.db),
    batch: async (statements) => {
      await f.db.prepare("UPDATE submissions SET review_status='reviewed',score=80 WHERE id='work'").run();
      return f.db.batch(statements);
    },
  };
  await assert.rejects(api.suggestTextReview(racedDatabase, { db: racedDatabase, tenantId: "school", userId: "teacher", userEmail: "teacher@example.test", displayName: "teacher", roles: ["teacher"] }, "work", {}), /submission_already_reviewed/);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM submission_reviews").first()).count, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='submission.ai_review_suggested'").first()).count, 0);
});
