import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createRequire } from "node:module";

const bundle = await build({
  stdin: { contents: `
    export { createApiApp } from './server/app';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createSessionToken } from './lib/auth-token';
    export { renderToStaticMarkup } from 'react-dom/server';
    export { createElement } from 'react';
    export { GuardianWeeklyReport } from './components/guardian/weekly-report';
    export { sectionsChangedByAction } from './lib/workspace/invalidation';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, platform: "node", format: "cjs", target: "node22", packages: "external", write: false,
});
const compiled = { exports: {} };
Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const api = compiled.exports;
const rubric = [{ name: "内容", weight: 40 }, { name: "表达", weight: 35 }, { name: "文化", weight: 25 }];

async function fixture(t) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const db = new api.NodeSqliteDatabase("file::memory:");
  t.after(() => { db.close(); if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','授权测试机构')"),
    ...["admin", "teacher", "student", "guardian"].map((id) => db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(id, `${id}@example.test`, id)),
    ...["admin", "teacher", "student", "guardian"].map((id) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES ('school',?,?)").bind(id, id)),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','本班','A2','teacher','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student')"),
    db.prepare("INSERT INTO guardian_student_links(tenant_id,guardian_user_id,student_user_id) VALUES ('school','guardian','student')"),
    db.prepare("INSERT INTO learning_objectives(id,tenant_id,code,title,skill,level) VALUES ('goal','school','G1','阅读目标','reading','A2')"),
    db.prepare("INSERT INTO diagnostic_items(id,tenant_id,objective_id,level,prompt,options_json,correct_option,created_by) VALUES ('item','school','goal','A2','诊断题','[\"甲\",\"乙\",\"丙\",\"丁\"]',0,'admin')"),
    db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,rubric_json,diagnostic_mode,diagnostic_prompt,created_by) VALUES ('task','school','class','文字作品','文字','published',?,'writing','写一段介绍','teacher')").bind(JSON.stringify(rubric)),
    db.prepare("INSERT INTO assignment_objectives(tenant_id,assignment_id,objective_id) VALUES ('school','task','goal')"),
  ]);
  const installed = { database: db, storage: null };
  api.setPlatformRuntime(installed);
  const app = api.createApiApp(), secret = await api.ensureSiteJwtSecret(db);
  const request = async (role, path, json) => {
    const now = Math.floor(Date.now() / 1000), token = await api.createSessionToken({ email: `${role}@example.test`, displayName: role, iat: now, exp: now + 3600 }, secret);
    return app.fetch(new Request(`http://127.0.0.1${path}`, {
      method: json === undefined ? "GET" : "POST",
      headers: { cookie: `huawen_zhixing_session=${token}`, ...(json === undefined ? {} : { "content-type": "application/json" }) },
      body: json === undefined ? undefined : JSON.stringify(json),
    }));
  };
  const json = async (role, path, body, expected = 200) => {
    const response = await request(role, path, body), data = await response.json();
    assert.equal(response.status, expected, JSON.stringify({ path, data }));
    return data;
  };
  const act = (role, action, body = {}, expected = 200) => json(role, "/api/v1/workspace/actions", { action, ...body }, expected);
  const consent = (status) => act("guardian", "update_consent", { studentUserId: "student", scope: "learning_analytics", status });
  const diagnostic = () => act("student", "submit_diagnostic", { attemptId: crypto.randomUUID(), level: "A2", answers: [{ itemId: "item", selectedOption: 1, revision: 1 }] }, 201);
  const submit = (extra = {}) => act("student", "submit_text", { submissionId: crypto.randomUUID(), assignmentId: "task", answer: "我介绍一道家常菜，说明食材和步骤。", ...extra }, 201);
  const review = (id) => act("teacher", "confirm_submission_review", { id, score: 80, comment: "教师的原始反馈", objectiveScores: [{ objectiveId: "goal", score: 80 }] });
  const masteryCount = async () => (await db.prepare("SELECT COUNT(*) AS n FROM mastery_snapshots").first()).n;
  const progress = () => json("guardian", "/api/v1/workspace?include=progress&studentId=student");
  return { db, installed, request, json, act, consent, diagnostic, submit, review, masteryCount, progress };
}

for (const state of ["not_granted", "granted", "withdrawn", "expired"]) {
  test(`${state}：三个累计入口尊重有效授权，原始答题、作品及人工评价继续保留`, async (t) => {
    const f = await fixture(t), available = state === "granted";
    if (state !== "not_granted") await f.consent(state === "withdrawn" ? "withdrawn" : "granted");
    if (state === "expired") await f.db.prepare("UPDATE consent_records SET expires_at=datetime('now','-1 day')").run();
    const result = await f.diagnostic();
    assert.equal(typeof result.score, "number");
    const recommendation = await f.db.prepare("SELECT id FROM learning_recommendations WHERE source_type='diagnostic'").first();
    await f.act("student", "answer_review_item", { id: recommendation.id, selectedOption: 0, revision: 1 });
    const work = await f.submit();
    await f.review(work.id);
    assert.equal(await f.masteryCount(), available ? 3 : 0);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM diagnostic_answers").first()).n, 1);
    assert.deepEqual(await f.db.prepare("SELECT score,feedback,review_status FROM submissions WHERE id=?").bind(work.id).first(), { score: 80, feedback: "教师的原始反馈", review_status: "reviewed" });
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('diagnostic.completed','review_item.answered','submission.reviewed')").first()).n, 3);
    const progress = await f.progress();
    assert.equal(progress.weeklyReport.available, available);
    assert.equal(progress.weeklyReport.consentStatus, state);
    assert.equal(progress.submissions[0].id, work.id);
    assert.equal(progress.mastery.length, available ? 1 : 0);
    if (!available) {
      assert.equal(progress.weeklyReport.submittedCount, null);
      assert.equal(progress.weeklyReport.reviewedCount, null);
      assert.equal(progress.weeklyReport.averageScore, null);
      assert.equal(progress.weeklyReport.masteryAverage, null);
      assert.deepEqual(progress.learningPlan, []);
    }
    const profile = await f.json("guardian", "/api/v1/ability-profile?studentId=student");
    assert.equal(profile.available, available);
    assert.equal(profile.consentStatus, state);
    assert.equal(profile.evidence.length, available ? 2 : 0);
    const teacher = await f.json("teacher", "/api/v1/workspace?include=progress");
    assert.equal(teacher.masteryMatrix.length, available ? 1 : 0);
    const quality = await f.json("admin", "/api/v1/workspace?include=quality");
    assert.equal(quality.qualityMetrics.lowMasteryObjectives.available, available);
    assert.equal(quality.qualityMetrics.lowMasteryObjectives.details.length, available ? 1 : 0);
    const report = api.renderToStaticMarkup(api.createElement(api.GuardianWeeklyReport, { data: progress }));
    if (!available) {
      assert.match(report, /学习分析|授权/);
      assert.doesNotMatch(report, /待评估|作业均分|提交作业/);
    }
  });
}

test("撤回隐藏既有累计数据，重新同意仅恢复原授权证据，不回填暂停期作品或评分", async (t) => {
  const f = await fixture(t);
  await f.consent("granted"); await f.diagnostic();
  const before = (await f.progress()).mastery[0];
  await f.consent("withdrawn");
  const pausedDiagnostic = await f.diagnostic(), pausedWork = await f.submit();
  await f.review(pausedWork.id);
  assert.deepEqual((await f.progress()).mastery, []);
  assert.equal((await f.json("guardian", "/api/v1/ability-profile?studentId=student")).available, false);
  const casePaused = await f.json("guardian", "/api/v1/student-cases?view=guardian&studentId=student");
  assert.equal(casePaused.available, false); assert.deepEqual(casePaused.events, []);
  await f.consent("granted");
  const restored = await f.progress();
  assert.deepEqual(restored.mastery, [before]);
  assert.equal(restored.weeklyReport.submittedCount, 0);
  assert.equal(restored.weeklyReport.reviewedCount, 0);
  const profile = await f.json("guardian", "/api/v1/ability-profile?studentId=student");
  assert.equal(profile.available, true); assert.equal(profile.evidence.length, 1);
  assert.ok(!profile.evidence.some((item) => item.id.startsWith(pausedDiagnostic.attemptId) || item.id === pausedWork.id));
  const saved = await f.db.prepare("SELECT evidence_json FROM submission_reviews WHERE submission_id=? AND status='confirmed'").bind(pausedWork.id).first();
  assert.equal(JSON.parse(saved.evidence_json).analyticsAllowed, 0);
  assert.equal(restored.submissions[0].score, 80);
});

test("暂停期原件在重新授权后评分仍不纳入累计分析，单元原件保留分数但不计算差值", async (t) => {
  const f = await fixture(t);
  await f.consent("granted"); await f.consent("withdrawn");
  const paused = await f.submit();
  await f.consent("granted"); await f.review(paused.id);
  assert.equal(await f.masteryCount(), 0);
  const saved = await f.db.prepare(`SELECT s.score,s.feedback,s.review_status,s.diagnostic_snapshot_json,
      sr.evidence_json FROM submissions s JOIN submission_reviews sr ON sr.submission_id=s.id AND sr.tenant_id=s.tenant_id AND sr.status='confirmed'
    WHERE s.id=?`).bind(paused.id).first();
  assert.equal(saved.score, 80); assert.equal(saved.feedback, "教师的原始反馈"); assert.equal(saved.review_status, "reviewed");
  assert.equal(JSON.parse(saved.diagnostic_snapshot_json).analyticsAllowed, 0);
  assert.equal(JSON.parse(saved.evidence_json).analyticsAllowed, 0);
  const progress = await f.progress();
  assert.deepEqual(progress.mastery, []);
  assert.equal(progress.weeklyReport.available, true);
  assert.equal(progress.weeklyReport.submittedCount, 0); assert.equal(progress.weeklyReport.reviewedCount, 0);
  assert.equal(progress.weeklyReport.averageScore, null); assert.equal(progress.weeklyReport.masteryAverage, null);
  assert.equal(progress.submissions[0].score, 80);
  assert.deepEqual((await f.json("guardian", "/api/v1/ability-profile?studentId=student")).evidence, []);
  // 兼容此前可能留下的冲突元数据：即使评价写成允许，也不能覆盖原件的明确暂停选择。
  await f.db.prepare("UPDATE submission_reviews SET evidence_json=json_set(evidence_json,'$.analyticsAllowed',1) WHERE submission_id=? AND status='confirmed'").bind(paused.id).run();
  const teacher = await f.json("teacher", "/api/v1/workspace?include=progress");
  const source = teacher.sequenceSources.find((item) => item.work.id === paused.id);
  assert.equal(source.work.analyticsAllowed, 0); assert.equal(source.work.score, 80);

  // 人工安排仍能引用原始作品；暂停期原件不能因为后续两份正常作品而被回填成分析依据。
  const sequence = await f.act("teacher", "create_learning_sequence", { baselineSubmissionId: paused.id, objectiveId: "goal", title: "重新授权后的单元", practicePrompt: "练习介绍", transferPrompt: "向朋友介绍", transferContext: "新对象" }, 201);
  for (const stage of ["practice", "transfer"]) {
    const work = await f.submit({ sequenceId: sequence.id, sequenceStage: stage });
    await f.act("teacher", "confirm_submission_review", { id: work.id, score: 90, comment: "重新授权后的反馈", objectiveScores: [{ objectiveId: "goal", score: 90 }], helpLevel: "independent", contextConfirmed: true });
  }
  assert.equal(await f.masteryCount(), 2);
  const report = await f.request("guardian", `/api/v1/learning-sequences/${sequence.id}/report`);
  assert.equal(report.status, 200);
  const html = await report.text();
  assert.match(html, /暂停期间保存的记录.*不回填或计算前后差值/);
  const comparison = html.split("初次与迁移的分项对照</h2>")[1].split("</section>")[0];
  assert.doesNotMatch(comparison, /<td>\+10<\/td>/);
  assert.match(comparison, /<td>80<\/td><td>90<\/td><td>—<\/td>/);
});

test("非法授权scope或status拒绝且不写，授权审计失败保留原状态", async (t) => {
  const f = await fixture(t);
  const before = async () => ({ consents: (await f.db.prepare("SELECT * FROM consent_records").all()).results, audits: (await f.db.prepare("SELECT * FROM audit_logs").all()).results });
  for (const input of [{ scope: "other", status: "granted" }, { scope: "learning_analytics" }, { scope: "learning_analytics", status: "unknown" }]) {
    await f.act("guardian", "update_consent", { studentUserId: "student", ...input }, 400);
    assert.deepEqual(await before(), { consents: [], audits: [] });
  }
  await f.consent("granted"); const state = await before();
  await f.db.prepare("CREATE TRIGGER reject_consent_audit BEFORE INSERT ON audit_logs WHEN NEW.action='consent.updated' BEGIN SELECT RAISE(ABORT,'consent_audit_failure'); END").run();
  await f.act("guardian", "update_consent", { studentUserId: "student", scope: "learning_analytics", status: "withdrawn" }, 500);
  assert.deepEqual(await before(), state);
  assert.ok(api.sectionsChangedByAction("update_consent").includes("progress"));
});

test("三个写入口在业务事务开始前撤回时不累计掌握度，原操作正常提交", async (t) => {
  for (const operation of ["diagnostic", "review_item", "manual_review"]) await t.test(operation, async (t) => {
    const f = await fixture(t); await f.consent("granted");
    let input;
    if (operation === "review_item") {
      await f.diagnostic();
      input = await f.db.prepare("SELECT id FROM learning_recommendations WHERE source_type='diagnostic'").first();
    } else if (operation === "manual_review") input = await f.submit();
    const before = await f.masteryCount();
    let armed = false;
    const adapter = { prepare: f.db.prepare.bind(f.db), batch: async (statements) => {
      if (armed) {
        armed = false;
        await f.db.prepare("UPDATE consent_records SET status='withdrawn'").run();
      }
      return f.db.batch(statements);
    } };
    // 新adapter先完成schema缓存，后续一次业务batch准确模拟并发撤回已提交。
    await api.ensurePlatformSchema(adapter);
    api.setPlatformRuntime({ ...f.installed, database: adapter });
    armed = true;
    if (operation === "diagnostic") await f.diagnostic();
    else if (operation === "review_item") await f.act("student", "answer_review_item", { id: input.id, selectedOption: 0, revision: 1 });
    else await f.review(input.id);
    assert.equal(await f.masteryCount(), before);
  });
});

test("最新授权覆盖旧记录，ISO过期时间按时间值校验；撤回后直接打印报告不能绕过", async (t) => {
  const f = await fixture(t);
  await f.consent("granted");
  await f.db.prepare("UPDATE consent_records SET expires_at=?").bind(new Date(Date.now() + 60_000).toISOString()).run();
  await f.db.prepare("INSERT INTO consent_records(id,tenant_id,student_user_id,guardian_user_id,scope,status,created_at) VALUES ('old-withdrawal','school','student','guardian','learning_analytics','withdrawn','2000-01-01')").run();
  assert.equal((await f.progress()).weeklyReport.available, true);
  const work = await f.submit(); await f.review(work.id);
  const sequence = await f.act("teacher", "create_learning_sequence", { baselineSubmissionId: work.id, objectiveId: "goal", title: "学习单元", practicePrompt: "练习介绍", transferPrompt: "向朋友介绍", transferContext: "新对象" }, 201);
  assert.equal((await f.request("guardian", `/api/v1/learning-sequences/${sequence.id}/report`)).status, 200);
  await f.consent("withdrawn");
  const report = await f.request("guardian", `/api/v1/learning-sequences/${sequence.id}/report`);
  assert.equal(report.status, 403);
  const html = await report.text(); assert.match(html, /授权已撤回/); assert.doesNotMatch(html, /分项对照|教师的原始反馈/);
});
