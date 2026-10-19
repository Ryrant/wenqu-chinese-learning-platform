import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase, LocalFileStorage } from './app/lib/platform-runtime-node';
    export { setPlatformRuntime } from './app/lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './app/lib/platform-store';
    export { createSessionToken } from './app/lib/auth-token';
    export { POST as setup } from './app/api/v1/auth/setup/route';
    export { POST as actions } from './app/api/v1/workspace/actions/route';
    export { GET as workspace } from './app/api/v1/workspace/route';
    export { GET as health } from './app/api/v1/health/route';
    export { POST as upload } from './app/api/v1/speech/submissions/route';
    export { POST as submit } from './app/api/v1/submissions/route';
    export { GET as audio } from './app/api/v1/submissions/[id]/audio/route';
    export { GET as profile } from './app/api/v1/ability-profile/route';
    export { POST as uploadMedia } from './app/api/v1/diagnostic-media/route';
    export { GET as media } from './app/api/v1/diagnostic-media/[id]/route';
    export { trialSummary } from './app/lib/trial-types';
    export { GET as unitReport } from './app/api/v1/learning-sequences/[id]/report/route';
    export { GET as internalReport } from './app/api/v1/trial-records/report/route';
    export { GET as portfolio } from './app/api/v1/family-portfolio/route';
    export { GET as followups } from './app/api/v1/teaching-followups/route';
    export { GET as familyFeedback, POST as familyFeedbackAction } from './app/api/v1/family-feedback/route';
    export { GET as batchCatalog, POST as batchAction } from './app/api/v1/trial-batches/route';
    export { GET as batchDetail } from './app/api/v1/trial-batches/[id]/route';
    export { GET as batchReport } from './app/api/v1/trial-batches/[id]/report/route';
    export { batchSummary } from './app/lib/trial-batch-types';
    export { feedbackCaseState } from './app/lib/family-feedback-types';
    export { GET as studentCase } from './app/api/v1/student-cases/route';
    export { caseTimestamp } from './app/lib/student-case-types';
  `, resolveDir: root }, bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const rubric = [{ name: "内容准确性", weight: 40 }, { name: "语言表达", weight: 35 }, { name: "文化理解", weight: 25 }];

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "wenqu-learning-flow-"));
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ database: db, storage: new api.LocalFileStorage(dir) });
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const setup = await api.setup(new Request("http://127.0.0.1/api/v1/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@school.example", password: "FixturePassword123", displayName: "测试管理员" }) }));
  assert.equal(setup.status, 200, await setup.text());
  const admin = setup.headers.get("set-cookie").split(";")[0];
  const act = async (cookie, action, payload = {}, expectedStatus = 200) => {
    const response = await api.actions(new Request("http://127.0.0.1/api/v1/workspace/actions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) }));
    const result = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify({ action, result }));
    return result;
  };
  const secret = await api.ensureSiteJwtSecret(db);
  const actors = { admin };
  const ids = {};
  for (const role of ["teacher", "student", "guardian", "stranger", "otherTeacher", "otherGuardian", "otherTenant"]) {
    const email = `${role.toLowerCase()}@school.example`;
    const member = await act(admin, "create_member", { email, displayName: role, role: role === "stranger" ? "student" : role === "otherTeacher" || role === "otherTenant" ? "teacher" : role === "otherGuardian" ? "guardian" : role, temporaryPassword: "FixturePassword123" }, 201);
    ids[role] = member.id;
    await db.prepare("UPDATE users SET must_change_password=0 WHERE id=?").bind(member.id).run();
    const now = Math.floor(Date.now() / 1000);
    actors[role] = `huawen_zhixing_session=${await api.createSessionToken({ email, displayName: role, iat: now, exp: now + 3600 }, secret)}`;
  }
  const tenantId = (await db.prepare("SELECT tenant_id AS id FROM role_memberships WHERE user_id=?").bind(ids.teacher).first()).id;
  await db.prepare("INSERT INTO tenants (id,name) VALUES ('other-tenant','另一学校')").run();
  await db.prepare("UPDATE role_memberships SET tenant_id='other-tenant' WHERE user_id=?").bind(ids.otherTenant).run();
  await act(admin, "set_guardian_links", { guardianUserId: ids.guardian, studentUserIds: [ids.student] });
  const classroom = await act(actors.teacher, "create_class", { name: "测试班级", level: "A2" }, 201);
  await act(admin, "set_class_enrollments", { classId: classroom.id, studentUserIds: [ids.student, ids.stranger] });
  const goals = [];
  for (const [index, skill] of ["口语", "阅读", "书写"].entries()) goals.push((await act(admin, "upsert_learning_objective", { code: `GOAL-${index}`, title: `${skill}目标`, skill, level: "A2" }, 201)).id);
  const assignment = await act(actors.teacher, "create_assignment", { classId: classroom.id, title: "介绍一道家常菜", activityType: "口述与文字", objectiveIds: goals, rubric }, 201);
  await act(actors.teacher, "create_assignment", { classId: classroom.id, title: "重名量规不应发布", activityType: "口述", objectiveIds: goals, rubric: [{ name: "表达", weight: 40 }, { name: "表达", weight: 35 }, { name: "文化", weight: 25 }] }, 400);
  await act(actors.teacher, "publish_assignment", { id: assignment.id });
  await db.batch([
    db.prepare("INSERT INTO source_documents (id,tenant_id,title,media_type,rights_status,processing_status,created_by) VALUES ('source',?,'家常菜教材','text/plain','owned','published',?)").bind(tenantId, ids.teacher),
    db.prepare("INSERT INTO knowledge_chunks (id,tenant_id,source_document_id,content,published) VALUES ('chunk',?,'source','介绍一道家常菜时说明食材、步骤与推荐理由。',1)").bind(tenantId),
  ]);
  const text = (familyTaskId) => act(actors.student, "submit_text", { assignmentId: assignment.id, answer: "这道家常菜很好吃，我想介绍它。", familyTaskId }, 201);
  const review = (id, extra = {}) => ({ id, score: 80, comment: "表达完整，下一步练习说明步骤。", ...extra });
  const upload = async (cookie, { id = crypto.randomUUID(), familyTaskId, familyPartner, familyRevision, sequenceId, sequenceStage, assignmentId = assignment.id, bytes = new Uint8Array(512).fill(7) } = {}, status = 201) => {
    const form = new FormData();
    form.set("audio", new File([bytes], "recording.wav", { type: "audio/wav" }));
    form.set("assignmentId", assignmentId);
    form.set("submissionId", id);
    if (familyTaskId) form.set("familyTaskId", familyTaskId);
    if (familyPartner !== undefined) form.set("familyPartner", familyPartner);
    if (familyRevision !== undefined) form.set("familyRevision", String(familyRevision));
    if (sequenceId !== undefined) form.set("sequenceId", sequenceId);
    if (sequenceStage !== undefined) form.set("sequenceStage", sequenceStage);
    const response = await api.upload(new Request("http://127.0.0.1/api/v1/speech/submissions", { method: "POST", headers: { cookie }, body: form }));
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const readAudio = (cookie, id, range) => api.audio(new Request(`http://127.0.0.1/api/v1/submissions/${id}/audio`, { headers: { ...(cookie ? { cookie } : {}), ...(range ? { range } : {}) } }), { params: Promise.resolve({ id }) });
  const workspace = async (cookie, studentId) => {
    const response = await api.workspace(new Request(`http://127.0.0.1/api/v1/workspace${studentId ? `?studentId=${encodeURIComponent(studentId)}` : ""}`, { headers: { cookie } }));
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const profile = async (cookie, studentId = ids.student, expectedStatus = 200) => {
    const response = await api.profile(new Request(`http://127.0.0.1/api/v1/ability-profile?studentId=${studentId}`, { headers: cookie ? { cookie } : {} }));
    const result = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(result)); return result;
  };
  const uploadMedia = async (cookie, kind, expectedStatus = 201, file) => {
    const form = new FormData(); form.set("kind", kind);
    const bytes = kind === "image" ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=", "base64") : new Uint8Array(512).fill(3);
    form.set("file", file ?? new File([bytes], kind === "image" ? "picture.png" : "listen.wav", { type: kind === "image" ? "image/png" : "audio/wav" }));
    const response = await api.uploadMedia(new Request("http://127.0.0.1/api/v1/diagnostic-media", { method: "POST", headers: cookie ? { cookie } : {}, body: form }));
    const result = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(result)); return result;
  };
  const readMedia = (cookie, id) => api.media(new Request(`http://127.0.0.1/api/v1/diagnostic-media/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
  const unitReport = async (cookie, id, status = 200) => {
    const response = await api.unitReport(new Request(`http://127.0.0.1/api/v1/learning-sequences/${id}/report`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });
    const html = await response.text(); assert.equal(response.status, status, html.slice(0, 1000)); return { response, html };
  };
  const internalReport = async (cookie, sequenceId, status = 200) => {
    const response = await api.internalReport(new Request(`http://127.0.0.1/api/v1/trial-records/report${sequenceId === undefined ? "" : `?sequenceId=${encodeURIComponent(sequenceId)}`}`, { headers: cookie ? { cookie } : {} }));
    const html = await response.text(); assert.equal(response.status, status, html.slice(0, 1000)); return { response, html };
  };
  const portfolio = async (cookie, studentId, status = 200) => {
    const response = await api.portfolio(new Request(`http://127.0.0.1/api/v1/family-portfolio${studentId === undefined ? "" : `?studentId=${encodeURIComponent(studentId)}`}`, { headers: cookie ? { cookie } : {} }));
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return { response, data };
  };
  const followups = async (cookie = actors.teacher, status = 200) => {
    const response = await api.followups(new Request("http://127.0.0.1/api/v1/teaching-followups", { headers: cookie ? { cookie } : {} }));
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return { response, data };
  };
  const feedback = async (cookie = actors.guardian, view = "guardian", studentId = ids.student, status = 200) => {
    const response = await api.familyFeedback(new Request(`http://127.0.0.1/api/v1/family-feedback?view=${view}${view === "guardian" ? `&studentId=${studentId}` : ""}`, { headers: cookie ? { cookie } : {} }));
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return { response, data };
  };
  const feedbackAction = async (cookie, body, status = 201) => {
    const response = await api.familyFeedbackAction(new Request("http://127.0.0.1/api/v1/family-feedback", { method: "POST", headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" }, body: JSON.stringify(body) }));
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
  };
  const batches = async (cookie = actors.teacher, id, expectedStatus = 200, print = false) => {
    const request = new Request(`http://127.0.0.1/api/v1/trial-batches${id ? `/${id}${print ? "/report" : ""}` : ""}`, { headers: cookie ? { cookie } : {} });
    const response = id ? await (print ? api.batchReport : api.batchDetail)(request, { params: Promise.resolve({ id }) }) : await api.batchCatalog(request);
    const data = print ? await response.text() : await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(data).slice(0, 1000)); return { response, data };
  };
  const batchAction = async (cookie, body, expectedStatus = body.action === "create" ? 201 : 200) => {
    const response = await api.batchAction(new Request("http://127.0.0.1/api/v1/trial-batches", { method: "POST", headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" }, body: JSON.stringify(body) }));
    const data = await response.json(); assert.equal(response.status, expectedStatus, JSON.stringify(data)); return data;
  };
  const studentCase = async (cookie = actors.teacher, view = "teaching", studentId = ids.student, status = 200) => {
    const response = await api.studentCase(new Request(`http://127.0.0.1/api/v1/student-cases?view=${view}${studentId === null ? "" : `&studentId=${encodeURIComponent(studentId)}`}`, { headers: cookie ? { cookie } : {} }));
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return { response, data };
  };
  return { db, act, actors, ids, tenantId, goals, assignment, classroom, text, review, upload, readAudio, workspace, profile, uploadMedia, readMedia, unitReport, internalReport, portfolio, followups, feedback, feedbackAction, batches, batchAction, studentCase };
}

test("text retries preserve one original work and audit across concurrency, response loss and completed family review", async (t) => {
  const f = await fixture(t);
  const payload = { submissionId: crypto.randomUUID(), assignmentId: f.assignment.id, answer: "同一份文字作品只保存一次。" };
  const saved = await f.act(f.actors.student, "submit_text", payload, 201);
  const retries = await Promise.all(Array.from({ length: 3 }, () => f.act(f.actors.student, "submit_text", payload, 201)));
  assert.ok(retries.every((item) => item.id === saved.id));
  const count = async (sql, id = saved.id) => (await f.db.prepare(sql).bind(id).first()).count;
  assert.equal(await count("SELECT COUNT(*) AS count FROM submissions WHERE id=?"), 1);
  assert.equal(await count("SELECT COUNT(*) AS count FROM audit_logs WHERE action='submission.created' AND target_id=?"), 1);
  await f.act(f.actors.student, "submit_text", { ...payload, answer: "改过的答案不能冒充原请求。" }, 409);
  await f.act(f.actors.stranger, "submit_text", payload, 409);
  await f.act(f.actors.student, "submit_text", { ...payload, submissionId: "invalid" }, 400);
  const concurrent = { ...payload, submissionId: crypto.randomUUID() };
  const firstSaves = await Promise.all(Array.from({ length: 3 }, () => f.act(f.actors.student, "submit_text", concurrent, 201)));
  assert.ok(firstSaves.every((item) => item.id === concurrent.submissionId));
  assert.equal(await count("SELECT COUNT(*) AS count FROM audit_logs WHERE action='submission.created' AND target_id=?", concurrent.submissionId), 1);
  const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "重试家庭作品", detail: "采访并提交自己的总结。" }, 201);
  const family = { ...payload, submissionId: crypto.randomUUID(), familyTaskId: task.id };
  const work = await f.act(f.actors.student, "submit_text", family, 201);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: work.id, helpLevel: "independent" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 0 }] }));
  const retried = await f.act(f.actors.student, "submit_text", family, 201);
  assert.equal(retried.id, work.id); assert.equal(retried.reviewStatus, "reviewed");
  assert.equal(await count("SELECT COUNT(*) AS count FROM submissions WHERE family_task_id=?", task.id), 1);
});

test("review rejects stale versions and retargeted items without scoring; a fresh diagnostic restores the correct goal", async (t) => {
  const f = await fixture(t);
  const input = { objectiveId: f.goals[0], level: "REVIEW", prompt: "原题", options: ["米饭", "苹果", "香蕉", "梨"], correctOption: 0 };
  const item = await f.act(f.actors.admin, "upsert_diagnostic_item", input, 201);
  await f.act(f.actors.student, "submit_diagnostic", { level: input.level, answers: [{ itemId: item.id, selectedOption: 1, revision: 1 }] }, 201);
  const original = (await f.workspace(f.actors.student)).recommendations.find((row) => row.source_id === item.id);
  const count = async () => (await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count;
  const before = await count();
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...input, id: item.id, objectiveId: f.goals[1], prompt: "新目标新题", correctOption: 1 });
  await f.act(f.actors.student, "answer_review_item", { id: original.id, selectedOption: 0, revision: original.reviewRevision }, 409);
  await f.act(f.actors.student, "answer_review_item", { id: original.id, selectedOption: 1, revision: 2 }, 409);
  assert.equal(await count(), before);
  const changed = await f.workspace(f.actors.student);
  assert.ok(!changed.recommendations.some((row) => row.id === original.id));
  assert.ok(!changed.learningPlan.some((row) => row.id === original.id));
  await f.act(f.actors.student, "submit_diagnostic", { level: input.level, answers: [{ itemId: item.id, selectedOption: 0, revision: 2 }] }, 201);
  const fresh = (await f.workspace(f.actors.student)).recommendations.find((row) => row.id === original.id);
  assert.equal(fresh.objective_id, f.goals[1]); assert.equal(fresh.reviewRevision, 2);
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...input, id: item.id, objectiveId: f.goals[1], prompt: "同目标改版", correctOption: 2 });
  const afterDiagnostic = await count();
  await f.act(f.actors.student, "answer_review_item", { id: fresh.id, selectedOption: 1, revision: fresh.reviewRevision }, 409);
  assert.equal(await count(), afterDiagnostic);
  const latest = (await f.workspace(f.actors.student)).recommendations.find((row) => row.id === original.id);
  const result = await f.act(f.actors.student, "answer_review_item", { id: latest.id, selectedOption: 2, revision: latest.reviewRevision });
  assert.equal(result.correct, true); assert.equal(result.status, "completed");
  const mastery = (await f.workspace(f.actors.student)).mastery;
  assert.equal(mastery.find((row) => row.objectiveId === f.goals[0]).evidenceCount, 1);
  assert.equal(mastery.find((row) => row.objectiveId === f.goals[1]).evidenceCount, 2);
});

test("review rechecks the item version in the write when an edit follows the initial read", async (t) => {
  const f = await fixture(t);
  const input = { objectiveId: f.goals[0], level: "RACE", prompt: "并发复习题", options: ["甲", "乙", "丙", "丁"], correctOption: 0 };
  const item = await f.act(f.actors.admin, "upsert_diagnostic_item", input, 201);
  await f.act(f.actors.student, "submit_diagnostic", { level: input.level, answers: [{ itemId: item.id, selectedOption: 1, revision: 1 }] }, 201);
  const review = (await f.workspace(f.actors.student)).recommendations.find((row) => row.source_id === item.id);
  const prepare = f.db.prepare.bind(f.db); let edited = false;
  f.db.prepare = (sql) => {
    const statement = prepare(sql); const first = statement.first.bind(statement);
    statement.first = async (...args) => {
      const row = await first(...args);
      if (!edited && row?.id === review.id && sql.includes("di.revision")) {
        edited = true; await prepare("UPDATE diagnostic_items SET revision=revision+1,correct_option=1 WHERE id=?").bind(item.id).run();
      }
      return row;
    };
    return statement;
  };
  await f.act(f.actors.student, "answer_review_item", { id: review.id, selectedOption: 0, revision: 1 }, 409);
  assert.ok(edited);
  assert.equal((await prepare("SELECT evidence_count AS count FROM mastery_snapshots WHERE student_user_id=? ORDER BY id DESC LIMIT 1").bind(f.ids.student).first()).count, 1);
  assert.equal((await prepare("SELECT status FROM learning_recommendations WHERE id=?").bind(review.id).first()).status, "pending");
});

test("missing mastery remains unknown while an explicitly evaluated zero remains zero", async (t) => {
  const f = await fixture(t);
  const parent = await f.workspace(f.actors.guardian);
  assert.equal(parent.weeklyReport.masteryAverage, null); assert.deepEqual(parent.mastery, []);
  const teacher = await f.workspace(f.actors.teacher);
  assert.ok(teacher.enrollments.some((row) => row.studentUserId === f.ids.student && row.status === "active"));
  assert.ok(!teacher.masteryMatrix.some((row) => row.studentUserId === f.ids.student));
  const work = await f.text();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { score: 0, objectiveScores: [{ objectiveId: f.goals[0], score: 0 }] }));
  const measured = await f.workspace(f.actors.guardian);
  assert.equal(measured.weeklyReport.masteryAverage, 0); assert.equal(measured.mastery[0].evidenceCount, 1);
});

test("saved service credentials do not advertise automatic speech scoring or external moderation", async (t) => {
  const f = await fixture(t);
  const settings = await f.workspace(f.actors.admin);
  assert.equal(settings.services.speech.status, "manual"); assert.equal(settings.services.moderation.status, "rules");
  await f.db.batch([
    f.db.prepare("INSERT INTO app_settings(key,value) VALUES('speech_api_key','test-credential')"),
    f.db.prepare("INSERT INTO app_settings(key,value) VALUES('moderation_api_key','test-credential')"),
  ]);
  const configured = await f.workspace(f.actors.admin);
  assert.equal(configured.services.speech.status, "manual"); assert.equal(configured.services.moderation.status, "rules");
  const health = await (await api.health()).json();
  assert.equal(health.providers.speechScoring, "credentials_saved_manual_review");
  assert.equal(health.providers.moderation, "credentials_saved_rules_only");
  const recording = await f.upload(f.actors.student);
  assert.equal(recording.reviewStatus, "human_review");
  assert.equal((await f.db.prepare("SELECT score FROM submissions WHERE id=?").bind(recording.id).first()).score, null);
});

test("unconfigured and invalid AI suggestions leave grades and mastery unset; structured REST output is validated", async (t) => {
  const f = await fixture(t);
  const submission = await f.text();
  let result = await f.act(f.actors.teacher, "suggest_text_review", { id: submission.id });
  assert.equal(result.suggestedScore, null);
  assert.deepEqual(result.objectiveScores, []);
  assert.equal((await f.db.prepare("SELECT score FROM submissions WHERE id=?").bind(submission.id).first()).score, null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count, 0);
  await f.db.prepare("INSERT INTO app_settings (key,value) VALUES ('openai_api_key','fixture-key')").run();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let output = "参考资料有80分的字样，但这不是评分结果。";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const prompt = JSON.parse(options.body).input[1].content;
    assert.ok(prompt.includes("内容准确性") && prompt.includes(f.goals[0]));
    return Response.json({ status: "completed", output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: output }] }] });
  };
  result = await f.act(f.actors.teacher, "suggest_text_review", { id: submission.id });
  assert.equal(result.suggestedScore, null);
  output = JSON.stringify({ suggestedScore: 88, comment: "理由明确 [1]", weaknessTags: [], objectiveScores: [{ objectiveId: f.goals[0], score: 92 }], dimensionScores: [{ name: "语言表达", score: 86 }] });
  result = await f.act(f.actors.teacher, "suggest_text_review", { id: submission.id });
  assert.equal(result.suggestedScore, 88);
  assert.deepEqual(result.objectiveScores, [{ objectiveId: f.goals[0], score: 92 }]);
  assert.equal((await f.db.prepare("SELECT score FROM submissions WHERE id=?").bind(submission.id).first()).score, null);
  output = JSON.stringify({ suggestedScore: 88, comment: "错误目标", weaknessTags: [], objectiveScores: [{ objectiveId: "foreign-goal", score: 90 }], dimensionScores: [] });
  result = await f.act(f.actors.teacher, "suggest_text_review", { id: submission.id });
  assert.equal(result.suggestedScore, null);
});

test("teacher scores update only measured objectives, preserve dimensions and reject invalid or repeated confirmations", async (t) => {
  const f = await fixture(t);
  const submission = await f.text();
  for (const goal of f.goals) await f.db.prepare("INSERT INTO mastery_snapshots (tenant_id,student_user_id,objective_id,mastery,evidence_count) VALUES (?,?,?,0.5,2)").bind(f.tenantId, f.ids.student, goal).run();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id, { score: null }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id, { objectiveScores: [{ objectiveId: "foreign-goal", score: 50 }] }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id, { dimensionScores: [{ name: "未知维度", score: 50 }] }), 400);
  await f.act(f.actors.otherTeacher, "confirm_submission_review", f.review(submission.id), 403);
  const objectiveScores = [{ objectiveId: f.goals[0], score: 90 }, { objectiveId: f.goals[1], score: 35 }];
  const dimensionScores = [{ name: "内容准确性", score: 95 }, { name: "语言表达", score: 40 }];
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id, { objectiveScores, dimensionScores }));
  const data = await f.workspace(f.actors.student);
  assert.equal(data.submissions[0].score, 80);
  assert.deepEqual(data.mastery.map((item) => [item.objectiveId, item.mastery, item.evidenceCount]).sort(), [[f.goals[0], 0.62, 3], [f.goals[1], 0.455, 3], [f.goals[2], 0.5, 2]].sort());
  const stored = await f.db.prepare("SELECT objective_scores_json,dimension_scores_json FROM submission_reviews WHERE submission_id=? AND status='confirmed'").bind(submission.id).first();
  assert.deepEqual(JSON.parse(stored.objective_scores_json), objectiveScores);
  assert.deepEqual(JSON.parse(stored.dimension_scores_json), dimensionScores);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id), 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count, 5);
  const legacy = await f.text();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(legacy.id));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count, 5);
});

test("audio upload can be replayed and retried without duplication, while owner, guardian, class and tenant scopes are enforced", async (t) => {
  const f = await fixture(t);
  const id = crypto.randomUUID();
  await f.upload(f.actors.student, { id });
  await f.upload(f.actors.student, { id, bytes: new Uint8Array(512).fill(9) }, 200);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM submissions").first()).count, 1);
  for (const actor of ["student", "teacher", "guardian", "admin"]) {
    const response = await f.readAudio(f.actors[actor], id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(512).fill(7));
  }
  for (const actor of ["stranger", "otherTeacher", "otherGuardian", "otherTenant"]) assert.equal((await f.readAudio(f.actors[actor], id)).status, 404);
  assert.equal((await f.readAudio(null, id)).status, 401);
  const range = await f.readAudio(f.actors.teacher, id, "bytes=10-19");
  assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), "bytes 10-19/512"); assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.equal((await f.readAudio(f.actors.teacher, id, "bytes=900-")).status, 416);
  const stolenKey = (await f.db.prepare("SELECT asset_key FROM submissions WHERE id=?").bind(id).first()).asset_key;
  const stolen = await api.submit(new Request("http://127.0.0.1/api/v1/submissions", { method: "POST", headers: { cookie: f.actors.stranger, "content-type": "application/json" }, body: JSON.stringify({ assignmentId: f.assignment.id, assetKey: stolenKey }) }));
  assert.equal(stolen.status, 403);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(id, { objectiveScores: [{ objectiveId: f.goals[0], score: 75 }] }));
  assert.equal((await f.workspace(f.actors.student)).submissions[0].score, 80);
});

test("family task carries a curriculum objective through student work, parent help and teacher feedback without parent-generated grades", async (t) => {
  const f = await fixture(t);
  const taskInput = { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "采访家人介绍家常菜", detail: "请提交自己的口述或文字总结。" };
  await f.act(f.actors.otherGuardian, "create_family_task", taskInput, 403);
  await f.act(f.actors.guardian, "create_family_task", { ...taskInput, objectiveId: "foreign-goal" }, 400);
  const task = await f.act(f.actors.guardian, "create_family_task", taskInput, 201);
  const submission = await f.text(task.id);
  await f.act(f.actors.guardian, "archive_family_task", { id: task.id }, 409);
  await f.text(task.id).then(() => assert.fail("duplicate pending family work accepted"), (error) => assert.match(error.message, /409|family_submission_pending/));
  await f.act(f.actors.guardian, "update_recommendation_status", { id: task.id, status: "completed" }, 409);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id), 409);
  await f.act(f.actors.otherGuardian, "confirm_family_submission", { submissionId: submission.id, helpLevel: "prompted" }, 403);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: submission.id, helpLevel: "prompted" });
  assert.equal((await f.db.prepare("SELECT score FROM submissions WHERE id=?").bind(submission.id).first()).score, null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count, 0);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 70 }] }));
  const parent = await f.workspace(f.actors.guardian);
  assert.equal(parent.recommendations.find((item) => item.id === task.id).status, "completed");
  assert.equal(parent.submissions[0].family_help_level, "prompted");
  assert.equal(parent.submissions[0].score, 80);
  assert.equal(parent.submissions[0].feedback, "表达完整，下一步练习说明步骤。");
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: submission.id, helpLevel: "independent" }, 409);
  await f.act(f.actors.guardian, "update_family_task", { ...taskInput, id: task.id, objectiveId: f.goals[1] }, 409);
  await f.act(f.actors.guardian, "update_recommendation_status", { id: task.id, status: "pending" });
  const recording = await f.upload(f.actors.student, { familyTaskId: task.id });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(recording.id), 409);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: recording.id, helpLevel: "independent" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(recording.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 95 }] }));
  const student = await f.workspace(f.actors.student);
  assert.equal(student.recommendations.find((item) => item.id === task.id).status, "completed");
  assert.equal(student.submissions.length, 2);
  assert.equal(student.mastery.length, 1);
});

test("pending family works remain confirmable beyond the recent history limit", async (t) => {
  const f = await fixture(t);
  const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "较早的家庭交流任务", detail: "等待家长确认" }, 201);
  const submission = await f.text(task.id);
  await f.db.prepare("UPDATE submissions SET created_at=datetime('now','-1 hour') WHERE id=?").bind(submission.id).run();
  for (let index = 0; index < 50; index++) await f.text();
  const data = await f.workspace(f.actors.guardian);
  assert.equal(data.submissions.length, 51);
  assert.ok(data.submissions.some((item) => item.id === submission.id));
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: submission.id, helpLevel: "independent" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(submission.id));
  assert.equal((await f.db.prepare("SELECT status FROM learning_recommendations WHERE id=?").bind(task.id).first()).status, "completed");
});

test("family archive and submission cannot interleave into an unreviewable work", async (t) => {
  for (const archiveFirst of [true, false]) await t.test(archiveFirst ? "archive wins" : "submission wins", async (t) => {
    const f = await fixture(t);
    const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "并发测试任务", detail: "提交与归档交错执行" }, 201);
    const prepare = f.db.prepare.bind(f.db);
    let interleaved = false;
    f.db.prepare = (sql) => {
      const statement = prepare(sql);
      const first = statement.first.bind(statement);
      statement.first = async (...args) => {
        const row = await first(...args);
        if (row?.id === task.id && !interleaved) {
          interleaved = true;
          if (archiveFirst) await f.act(f.actors.guardian, "archive_family_task", { id: task.id });
          else await f.text(task.id);
        }
        return row;
      };
      return statement;
    };
    if (archiveFirst) await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, familyTaskId: task.id, answer: "测试作品" }, 404);
    else await f.act(f.actors.guardian, "archive_family_task", { id: task.id }, 409);
    assert.ok(interleaved);
    const stored = await f.db.prepare("SELECT archived_at FROM learning_recommendations WHERE id=?").bind(task.id).first();
    const works = await f.db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE family_task_id=?").bind(task.id).first();
    assert.equal(Boolean(stored.archived_at), archiveFirst);
    assert.equal(works.count, archiveFirst ? 0 : 1);
  });
});

async function diagnosticTask(f, mode, objectiveId = f.goals[0]) {
  const media = mode === "speaking" ? await f.uploadMedia(f.actors.teacher, "image") : null;
  const input = { classId: f.classroom.id, title: mode === "speaking" ? "看图介绍家常菜" : "写一段菜品推荐", activityType: "能力差异诊断", objectiveIds: [objectiveId], rubric,
    diagnosticMode: mode, diagnosticPrompt: "请独立完成，说明主要内容和理由。", diagnosticMediaId: media?.id ?? null };
  const task = await f.act(f.actors.teacher, "create_assignment", input, 201);
  await f.act(f.actors.teacher, "publish_assignment", { id: task.id });
  return { ...task, mediaId: media?.id ?? null, input };
}

test("diagnostic stimuli enforce kind, publication and tenant scope; tasks require the correct response medium", async (t) => {
  const f = await fixture(t);
  await f.uploadMedia(f.actors.student, "image", 403);
  await f.uploadMedia(null, "audio", 401);
  await f.uploadMedia(f.actors.teacher, "image", 400, new File(["<svg onload='alert(1)'/>"], "fake.png", { type: "image/png" }));
  const image = await f.uploadMedia(f.actors.teacher, "image");
  assert.equal((await f.readMedia(f.actors.student, image.id)).status, 404);
  const teacherPreview = await f.readMedia(f.actors.teacher, image.id);
  assert.equal(teacherPreview.status, 200);
  assert.equal(teacherPreview.headers.get("cache-control"), "private, no-store");
  const base = { classId: f.classroom.id, title: "图片口述", activityType: "诊断", objectiveIds: [f.goals[0]], rubric, diagnosticMode: "speaking", diagnosticPrompt: "描述图片。" };
  await f.act(f.actors.teacher, "create_assignment", base, 400);
  const task = await f.act(f.actors.teacher, "create_assignment", { ...base, diagnosticMediaId: image.id }, 201);
  assert.equal((await f.readMedia(f.actors.student, image.id)).status, 404);
  await f.act(f.actors.teacher, "publish_assignment", { id: task.id });
  assert.equal((await f.readMedia(f.actors.student, image.id)).status, 200);
  assert.equal((await f.readMedia(f.actors.otherTenant, image.id)).status, 404);
  await f.act(f.actors.student, "submit_text", { assignmentId: task.id, answer: "用文字冒充口述" }, 400);
  const oral = await f.upload(f.actors.student, { assignmentId: task.id });
  const anotherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "同学生的另一班级", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: anotherClass.id, studentUserIds: [f.ids.student] });
  assert.ok(!(await f.profile(f.actors.otherTeacher)).evidence.some((item) => item.id === oral.id));
  assert.equal((await f.readMedia(f.actors.otherTeacher, image.id)).status, 404);
  const writing = await diagnosticTask(f, "writing", f.goals[2]);
  await f.upload(f.actors.student, { assignmentId: writing.id }, 400);
  const question = { objectiveId: f.goals[1], level: "A2", prompt: "听录音选答案", options: ["一", "二", "三", "四"], correctOption: 0, ability: "listening" };
  await f.act(f.actors.admin, "upsert_diagnostic_item", question, 400);
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...question, mediaId: image.id }, 400);
  const audio = await f.uploadMedia(f.actors.admin, "audio");
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...question, mediaId: audio.id }, 201);
  assert.equal((await f.readMedia(f.actors.student, audio.id)).status, 200);
  const workspace = await f.workspace(f.actors.student);
  const item = workspace.diagnosticItems.find((item) => item.mediaId === audio.id);
  assert.equal(item.ability, "listening");
  assert.ok(!("correct_option" in item) && !("correctOption" in item) && !("explanation" in item));
});

test("equal choice totals retain different listening, reading, speaking and writing evidence through teacher review", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.profile(f.actors.student)).evidence, []);
  const audio = await f.uploadMedia(f.actors.admin, "audio");
  const reading = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId: f.goals[1], level: "B1", prompt: "阅读菜谱，选择主要食材。", options: ["鸡蛋", "番茄", "土豆", "米饭"], correctOption: 0 }, 201);
  const listening = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId: f.goals[1], level: "B1", prompt: "听完录音，选择先做的步骤。", options: ["洗菜", "切菜", "炒菜", "盛菜"], correctOption: 0, ability: "listening", mediaId: audio.id }, 201);
  const resultA = await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: reading.id, selectedOption: 1, revision: 1 }, { itemId: listening.id, selectedOption: 0, revision: 1 }] }, 201);
  const resultB = await f.act(f.actors.stranger, "submit_diagnostic", { level: "B1", answers: [{ itemId: reading.id, selectedOption: 0, revision: 1 }, { itemId: listening.id, selectedOption: 1, revision: 1 }] }, 201);
  assert.equal(resultA.score, 0.5); assert.equal(resultB.score, 0.5);
  const speaking = await diagnosticTask(f, "speaking");
  const writing = await diagnosticTask(f, "writing", f.goals[2]);
  const oralA = await f.upload(f.actors.student, { assignmentId: speaking.id });
  const oralB = await f.upload(f.actors.stranger, { assignmentId: speaking.id });
  const writtenA = await f.act(f.actors.student, "submit_text", { assignmentId: writing.id, answer: "我推荐番茄炒蛋，因为简单又好吃。" }, 201);
  const writtenB = await f.act(f.actors.stranger, "submit_text", { assignmentId: writing.id, answer: "先洗净番茄，再切块，最后和鸡蛋一起炒。" }, 201);
  let profile = await f.profile(f.actors.student);
  assert.equal(profile.evidence.filter((item) => item.status === "pending").length, 2);
  assert.deepEqual(profile.evidence.find((item) => item.id === oralA.id).scores, []);
  for (const [id, goal, score] of [[oralA.id, f.goals[0], 90], [oralB.id, f.goals[0], 30], [writtenA.id, f.goals[2], 45], [writtenB.id, f.goals[2], 85]]) {
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(id, { score: 77, objectiveScores: [{ objectiveId: goal, score }], dimensionScores: [{ name: "语言表达", score }], comment: "本次评价已按目标分别记录。" }));
  }
  profile = await f.profile(f.actors.student);
  const other = await f.profile(f.actors.stranger, f.ids.stranger);
  const scoreFor = (data, ability) => data.evidence.find((item) => item.ability === ability && item.status === "assessed").scores[0].score;
  assert.deepEqual(["listening", "speaking", "reading", "writing"].map((ability) => scoreFor(profile, ability)), [100, 90, 0, 45]);
  assert.deepEqual(["listening", "speaking", "reading", "writing"].map((ability) => scoreFor(other, ability)), [0, 30, 100, 85]);
  const oral = profile.evidence.find((item) => item.id === oralA.id);
  assert.equal(oral.reviewer, "teacher"); assert.ok(oral.measuredAt); assert.equal(oral.hasAudio, true);
  assert.equal(oral.mediaId, speaking.mediaId); assert.equal(oral.dimensions[0].score, 90);
  assert.equal((await f.readAudio(f.actors.guardian, oralA.id)).status, 200);
  assert.equal(profile.evidence.find((item) => item.id === writtenA.id).textAnswer, "我推荐番茄炒蛋，因为简单又好吃。");
  const repeat = await f.upload(f.actors.student, { assignmentId: speaking.id });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(repeat.id));
  const unassessed = (await f.profile(f.actors.student)).evidence.find((item) => item.id === repeat.id);
  assert.equal(unassessed.status, "unassessed"); assert.equal(unassessed.evidenceCount, 0); assert.deepEqual(unassessed.scores, []);
});

test("evidence is immutable after content edits, scoped to the learner, and does not invent legacy snapshots", async (t) => {
  const f = await fixture(t);
  const media = await f.uploadMedia(f.actors.admin, "audio");
  const original = { objectiveId: f.goals[1], level: "B1", prompt: "原始听力问题", options: ["原答案甲", "原答案乙", "原答案丙", "原答案丁"], correctOption: 0, ability: "listening", mediaId: media.id };
  const question = await f.act(f.actors.admin, "upsert_diagnostic_item", original, 201);
  const attempt = await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: question.id, selectedOption: 0, revision: 1 }] }, 201);
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...original, id: question.id, prompt: "已编辑的题目", options: ["新甲", "新乙", "新丙", "新丁"], correctOption: 2, status: "inactive" });
  const task = await diagnosticTask(f, "writing", f.goals[2]);
  const work = await f.act(f.actors.student, "submit_text", { assignmentId: task.id, answer: "原始文字作品" }, 201);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: f.goals[2], score: 60 }] }));
  await f.db.prepare("UPDATE assignments SET title='修改后任务',diagnostic_prompt='修改后要求' WHERE id=?").bind(task.id).run();
  const profile = await f.profile(f.actors.student);
  assert.equal(profile.evidence.find((item) => item.kind === "choice").answers[0].prompt, "原始听力问题");
  assert.equal(profile.evidence.find((item) => item.kind === "choice").answers[0].selected, "原答案甲");
  assert.equal(profile.evidence.find((item) => item.id === work.id).title, task.input.title);
  assert.equal(profile.evidence.find((item) => item.id === work.id).prompt, task.input.diagnosticPrompt);
  assert.equal((await f.readMedia(f.actors.student, media.id)).status, 200);
  for (const actor of ["teacher", "guardian", "admin"]) assert.equal((await f.profile(f.actors[actor])).student.id, f.ids.student);
  for (const actor of ["stranger", "otherTeacher", "otherGuardian", "otherTenant"]) await f.profile(f.actors[actor], f.ids.student, 404);
  await f.profile(null, f.ids.student, 401);
  await f.db.prepare("INSERT INTO diagnostic_answers (id,tenant_id,attempt_id,item_id,selected_option,is_correct) VALUES ('legacy',?,?,?,0,1)")
    .bind(f.tenantId, attempt.attemptId, "legacy-item").run();
  assert.equal((await f.profile(f.actors.student)).legacyAnswerCount, 1);
  await f.db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE guardian_user_id=?").bind(f.ids.guardian).run();
  await f.profile(f.actors.guardian, f.ids.student, 404);
  assert.equal((await f.readMedia(f.actors.guardian, media.id)).status, 404);
});

test("stale papers are rejected without grades and listening review retains scoped access to its current audio", async (t) => {
  const f = await fixture(t);
  const media = await f.uploadMedia(f.actors.admin, "audio");
  const input = { objectiveId: f.goals[1], level: "B1", prompt: "旧听力问题", options: ["甲", "乙", "丙", "丁"], correctOption: 1, ability: "listening", mediaId: media.id };
  const question = await f.act(f.actors.admin, "upsert_diagnostic_item", input, 201);
  const seen = (await f.workspace(f.actors.student)).diagnosticItems.find((item) => item.id === question.id);
  assert.equal(seen.revision, 1);
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...input, id: question.id, prompt: "新听力问题", options: ["新甲", "新乙", "新丙", "新丁"] });
  await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: question.id, selectedOption: 0, revision: seen.revision }] }, 400);
  assert.deepEqual((await f.profile(f.actors.student)).evidence, []);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM diagnostic_attempts WHERE student_user_id=?").bind(f.ids.student).first()).count, 0);
  await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: question.id, selectedOption: 0, revision: 2 }] }, 201);
  const nextAudio = await f.uploadMedia(f.actors.admin, "audio");
  await f.act(f.actors.admin, "upsert_diagnostic_item", { ...input, id: question.id, mediaId: nextAudio.id, status: "inactive" });
  const review = (await f.workspace(f.actors.student)).recommendations.find((item) => item.source_id === question.id);
  assert.equal(review.reviewAbility, "listening"); assert.equal(review.reviewMediaId, nextAudio.id);
  assert.equal((await f.readMedia(f.actors.student, nextAudio.id)).status, 200);
  assert.equal((await f.readMedia(f.actors.stranger, nextAudio.id)).status, 404);
  assert.equal((await f.readMedia(f.actors.student, media.id)).status, 200);
});

async function supportEvidence(f) {
  const objectiveId = f.goals[1];
  const audio = await f.uploadMedia(f.actors.admin, "audio");
  const reading = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId, level: "B1", prompt: "阅读本单元短句。", options: ["甲", "乙", "丙", "丁"], correctOption: 0 }, 201);
  const listening = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId: f.goals[0], level: "B1", prompt: "听录音选择内容。", options: ["甲", "乙", "丙", "丁"], correctOption: 0, ability: "listening", mediaId: audio.id }, 201);
  const speaking = await diagnosticTask(f, "speaking", objectiveId);
  for (let index = 0; index < 2; index++) {
    const totals = [];
    for (const [actor, choice, spoken] of [["student", 1, 90], ["stranger", 0, 30]]) {
      const attempt = await f.act(f.actors[actor], "submit_diagnostic", { level: "B1", answers: [
        { itemId: reading.id, selectedOption: choice, revision: 1 }, { itemId: listening.id, selectedOption: 1 - choice, revision: 1 },
      ] }, 201);
      totals.push(attempt.score);
      const work = await f.upload(f.actors[actor], { assignmentId: speaking.id });
      await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId, score: spoken }] }));
    }
    assert.deepEqual(totals, [0.5, 0.5]);
  }
  const suggest = async (actor = "student", teacher = "teacher", status = 200) =>
    (await f.act(f.actors[teacher], "suggest_intervention", { studentUserId: f.ids[actor], objectiveId }, status)).suggestion;
  return { objectiveId, speaking, reading, listening, suggest };
}

test("equal totals produce different teacher-confirmed support tasks from the same objective and retain the evidence in student plans", async (t) => {
  const f = await fixture(t);
  const s = await supportEvidence(f);
  const count = async (table, where = "") => (await f.db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).first()).count;
  const masteryBefore = await count("mastery_snapshots");
  const before = await count("learning_recommendations", "WHERE source_type='teacher'");
  const a = await s.suggest();
  const b = await s.suggest("stranger");
  assert.ok(a.ready && b.ready);
  assert.deepEqual(a.supports, ["reading"]);
  assert.deepEqual(b.supports, ["speaking"]);
  assert.match(a.detail, /字词、短句配对/);
  assert.match(b.detail, /关键词.*句首提示/);
  assert.equal(a.measures.find((item) => item.ability === "listening").availableCount, 0, "another objective must not affect this support direction");
  assert.equal(await count("learning_recommendations", "WHERE source_type='teacher'"), before, "preview must not publish");
  const publish = (studentUserId, draft, extra = {}) => f.act(f.actors.teacher, "create_intervention", {
    studentUserId, objectiveId: s.objectiveId, title: draft.title, detail: draft.detail, evidenceKey: draft.evidenceKey, ...extra,
  }, 201);
  const edited = `${a.detail}\n教师核对：先保留三个关键词提示。`;
  const taskA = await publish(f.ids.student, a, { detail: edited, rationale: "伪造的依据不能写入" });
  const taskB = await publish(f.ids.stranger, b);
  const student = await f.workspace(f.actors.student);
  const other = await f.workspace(f.actors.stranger);
  const planA = student.learningPlan.find((item) => item.id === taskA.id);
  const planB = other.learningPlan.find((item) => item.id === taskB.id);
  assert.equal(planA.objective_id, planB.objective_id);
  assert.notEqual(planA.title, planB.title);
  assert.ok(planA.detail.startsWith(edited));
  assert.ok(planA.detail.includes(a.rationale));
  assert.ok(!planA.detail.includes("伪造的依据"));
  assert.ok(!student.recommendations.some((item) => item.id === taskB.id));
  assert.ok((await f.workspace(f.actors.guardian)).recommendations.some((item) => item.id === taskA.id && item.detail === planA.detail));
  const repeat = await publish(f.ids.student, a, { title: "重复请求不得覆盖已发布任务" });
  assert.equal(repeat.id, taskA.id); assert.equal(repeat.created, false);
  assert.equal(await count("learning_recommendations", "WHERE source_type='teacher'"), before + 2);
  await f.act(f.actors.student, "update_recommendation_status", { id: taskA.id, status: "completed" });
  assert.equal((await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === taskA.id), false);
  assert.equal(await count("mastery_snapshots"), masteryBefore, "practice completion must not manufacture a grade");
  assert.equal((await publish(f.ids.student, a)).status, "completed", "retry must not reopen completed work");
});

test("daily plans select different published tasks for equal totals, explain scoped evidence, and retain teacher priority", async (t) => {
  const f = await fixture(t);
  const s = await supportEvidence(f);
  for (const actor of ["student", "stranger"]) {
    const data = await f.workspace(f.actors[actor]);
    for (const item of data.recommendations.filter((item) => item.source_type === "diagnostic" && item.status === "pending")) {
      if (actor === "student") {
        const deferred = await f.act(f.actors[actor], "answer_review_item", { id: item.id, selectedOption: 1, revision: item.reviewRevision });
        assert.equal(deferred.correct, false);
        assert.ok(!(await f.workspace(f.actors[actor])).learningPlan.some((plan) => plan.id === item.id), "next-day review must not be selected before it opens");
        await f.act(f.actors[actor], "answer_review_item", { id: item.id, selectedOption: 0, revision: item.reviewRevision }, 409);
      } else await f.act(f.actors[actor], "answer_review_item", { id: item.id, selectedOption: 0, revision: item.reviewRevision });
    }
    await f.act(f.actors[actor], "submit_text", { assignmentId: f.assignment.id, answer: "已完成基础作品，下一步按计划练习。" }, 201);
  }
  const reading = await f.act(f.actors.teacher, "create_assignment", { classId: f.classroom.id, title: "字词与短句匹配", activityType: "阅读练习", objectiveIds: [s.objectiveId], rubric }, 201);
  await f.act(f.actors.teacher, "publish_assignment", { id: reading.id });
  const speaking = await diagnosticTask(f, "speaking", s.objectiveId);
  const general = await f.act(f.actors.teacher, "create_assignment", { classId: f.classroom.id, title: "其他目标的书面任务", activityType: "文字", objectiveIds: [f.goals[2]], rubric }, 201);
  await f.act(f.actors.teacher, "publish_assignment", { id: general.id });
  const family = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "交流一道菜", detail: "记录自己的提问与追问。" }, 201);
  const masteryBefore = (await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count;
  const a = await f.workspace(f.actors.student);
  const b = await f.workspace(f.actors.stranger);
  assert.equal(a.learningPlan.length, 3);
  assert.equal(a.learningPlan[0].id, reading.id);
  assert.equal(b.learningPlan[0].id, speaking.id);
  assert.equal(a.learningPlan[0].supportMatch, true); assert.equal(b.learningPlan[0].supportMatch, true);
  assert.ok(a.learningPlan.find((item) => item.id === family.id));
  assert.ok(a.learningPlan[0].id !== general.id, "a matching support task must outrank unrelated self-directed work");
  const refs = (data) => data.learningPlan.flatMap((item) => item.basis.flatMap((basis) => basis.records));
  assert.ok(refs(a).some((item) => item.ability === "reading" && item.score === 0));
  const foreign = new Set((await f.profile(f.actors.teacher, f.ids.stranger)).evidence.map((item) => item.id));
  assert.ok(refs(a).every((item) => !foreign.has(item.id)), "another student's evidence must not become the explanation");
  assert.ok(a.learningPlan.every((item) => item.studentUserId === f.ids.student && item.selectionReason));
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.guardian, studentUserIds: [f.ids.student, f.ids.stranger] });
  for (const [id, expected] of [[f.ids.student, reading.id], [f.ids.stranger, speaking.id]]) {
    const parent = await f.workspace(f.actors.guardian, id);
    assert.equal(parent.learningPlan[0].id, expected);
    assert.ok(parent.learningPlan.every((item) => item.studentUserId === id));
  }
  await f.db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role) VALUES (?,?,'guardian')").bind(f.tenantId, f.ids.student).run();
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.student, studentUserIds: [f.ids.stranger] });
  assert.equal((await f.workspace(f.actors.student, f.ids.stranger)).learningPlan[0].id, speaking.id);
  assert.equal((await f.workspace(f.actors.student, f.ids.student)).learningPlan[0].id, reading.id, "a student returning to their own scope must not require a self-guardian link");
  const denied = await api.workspace(new Request(`http://127.0.0.1/api/v1/workspace?studentId=${f.ids.otherGuardian}`, { headers: { cookie: f.actors.student } }));
  assert.equal(denied.status, 403, "the self-read exception must not authorize unrelated students");
  const teacher = await f.act(f.actors.teacher, "create_intervention", { studentUserId: f.ids.student, objectiveId: f.goals[0], title: "教师确认先练习追问", detail: "保留三个关键词提示。" }, 201);
  assert.equal((await f.workspace(f.actors.student)).learningPlan[0].id, teacher.id);
  await f.act(f.actors.student, "update_recommendation_status", { id: teacher.id, status: "completed" });
  assert.equal((await f.workspace(f.actors.student)).learningPlan[0].id, reading.id);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count, masteryBefore, "reading or completing a plan cannot manufacture language scores");
});

test("daily plan support remains unassessed for pending, total-only and teacher-helped work and reads evidence beyond recent submissions", async (t) => {
  const f = await fixture(t);
  const objectiveId = f.goals[1];
  const question = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId, level: "B1", prompt: "读短句选择意思", options: ["甲", "乙", "丙", "丁"], correctOption: 0 }, 201);
  const oldSpeaking = await diagnosticTask(f, "speaking", objectiveId);
  const helped = [];
  for (let index = 0; index < 2; index++) {
    await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: question.id, selectedOption: 0, revision: 1 }] }, 201);
    const work = await f.upload(f.actors.student, { assignmentId: oldSpeaking.id }); helped.push(work.id);
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { helpLevel: "prompted", objectiveScores: [{ objectiveId, score: 0 }] }));
  }
  const pending = await f.upload(f.actors.student, { assignmentId: oldSpeaking.id });
  const totalOnly = await f.upload(f.actors.student, { assignmentId: oldSpeaking.id });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(totalOnly.id, { helpLevel: "independent", score: 0 }));
  const nextSpeaking = await diagnosticTask(f, "speaking", objectiveId);
  let data = await f.workspace(f.actors.student);
  let plan = data.learningPlan.find((item) => item.id === nextSpeaking.id);
  assert.equal(plan.supportMatch, false); assert.match(plan.basis[0].note, /证据不足/);
  assert.ok(plan.basis[0].records.every((item) => ![...helped, pending.id, totalOnly.id].includes(item.id)));
  assert.equal((await f.act(f.actors.teacher, "suggest_intervention", { studentUserId: f.ids.student, objectiveId })).suggestion.ready, false, "teacher drafts must use the same exclusion rule");
  const independent = [];
  for (let index = 0; index < 2; index++) {
    const work = await f.upload(f.actors.student, { assignmentId: oldSpeaking.id }); independent.push(work.id);
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { helpLevel: "independent", objectiveScores: [{ objectiveId, score: 0 }] }));
  }
  // 普通历史作品占满最近提交页，不能截断排序所需的诊断证据。
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,score,review_status,created_at,reviewed_at)
    SELECT 'plan-history-'||n,?,?,?,'其他历史作品',80,'reviewed','2099-01-01 00:00:00','2099-01-01 00:00:00' FROM copies`)
    .bind(f.tenantId, f.assignment.id, f.ids.student).run();
  data = await f.workspace(f.actors.student); plan = data.learningPlan[0];
  assert.equal(plan.id, nextSpeaking.id); assert.equal(plan.supportMatch, true);
  assert.ok(!data.submissions.some((item) => independent.includes(item.id)));
  assert.deepEqual(plan.basis[0].records.filter((item) => item.ability === "speaking").map((item) => item.id).sort(), independent.sort());
  assert.ok(plan.basis[0].records.filter((item) => item.ability === "speaking").every((item) => item.score === 0 && item.helpLevel === "independent"));
});

test("daily plans keep available tasks ahead of waiting work and exclude locked, archived and unenrolled targets", async (t) => {
  const f = await fixture(t);
  const baseline = await f.text();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(baseline.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 40 }], helpLevel: "prompted" }));
  const waiting = [];
  for (let index = 0; index < 4; index++) {
    const sequence = await f.act(f.actors.teacher, "create_learning_sequence", { baselineSubmissionId: baseline.id, objectiveId: f.goals[0], title: `等候评价 ${index}`, practicePrompt: "练习说明理由", transferPrompt: "向同伴推荐另一道菜", transferContext: "交流对象与菜品改变" }, 201);
    const available = (await f.workspace(f.actors.student)).learningPlan.find((item) => item.id === `sequence:${sequence.id}:practice`);
    assert.equal(available.basis[0].records[0].id, baseline.id); assert.equal(available.basis[0].records[0].score, 40);
    const submission = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: sequence.id, sequenceStage: "practice", answer: "练习作品，等待教师评价。" }, 201);
    waiting.push({ sequence, submission });
  }
  const tasks = [];
  for (let index = 0; index < 2; index++) {
    const task = await f.act(f.actors.teacher, "create_assignment", { classId: f.classroom.id, title: `可操作课程任务 ${index}`, activityType: "文字", objectiveIds: [f.goals[2]], rubric }, 201);
    await f.act(f.actors.teacher, "publish_assignment", { id: task.id }); tasks.push(task.id);
  }
  const family = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "待完成的交流", detail: "采访家人并提交自己的作品。" }, 201);
  let data = await f.workspace(f.actors.student);
  assert.deepEqual(data.learningPlan.map((item) => item.id).sort(), [...tasks, family.id].sort());
  assert.ok(data.learningPlan.every((item) => !item.waitingReview));
  const reviewed = waiting[0];
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(reviewed.submission.id, { helpLevel: "prompted", objectiveScores: [{ objectiveId: f.goals[0], score: 0 }], promptCount: 2 }));
  const transfer = (await f.workspace(f.actors.student)).learningPlan[0];
  assert.equal(transfer.id, `sequence:${reviewed.sequence.id}:transfer`);
  assert.equal(transfer.basis[0].records[0].id, reviewed.submission.id);
  assert.equal(transfer.basis[0].records[0].score, 0); assert.equal(transfer.basis[0].records[0].promptCount, 2);
  assert.ok(!data.learningPlan.some((item) => item.id.endsWith(":retest") || item.id.endsWith(":transfer")), "unopened stages must not be presented as actionable");
  assert.ok(!(await f.workspace(f.actors.stranger)).learningPlan.some((item) => item.kind === "sequence" || item.id === family.id));
  await f.db.prepare("UPDATE assignments SET status='archived' WHERE id=?").bind(tasks[0]).run();
  assert.ok(!(await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === tasks[0]));
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [f.ids.stranger] });
  data = await f.workspace(f.actors.student);
  assert.deepEqual(data.learningPlan, []); assert.equal(data.learningSequences.length, 4, "history remains readable after leaving the class");
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.guardian, studentUserIds: [] });
  assert.deepEqual((await f.workspace(f.actors.guardian)).learningPlan, []);
  const denied = await api.workspace(new Request(`http://127.0.0.1/api/v1/workspace?studentId=${f.ids.student}`, { headers: { cookie: f.actors.guardian } }));
  assert.equal(denied.status, 403);
});

test("support drafts remain unassessed for missing, single, ungraded and helped evidence", async (t) => {
  const f = await fixture(t);
  const input = { studentUserId: f.ids.student, objectiveId: f.goals[1] };
  const suggest = async () => (await f.act(f.actors.teacher, "suggest_intervention", input)).suggestion;
  let draft = await suggest();
  assert.equal(draft.ready, false); assert.equal(draft.evidenceKey, null); assert.equal(draft.detail, "");
  const question = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId: input.objectiveId, level: "B1", prompt: "本目标阅读", options: ["甲", "乙", "丙", "丁"], correctOption: 0 }, 201);
  const task = await diagnosticTask(f, "speaking", input.objectiveId);
  for (let index = 0; index < 2; index++) {
    await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: question.id, selectedOption: 0, revision: 1 }] }, 201);
    const family = await f.act(f.actors.guardian, "create_family_task", { ...input, assignmentId: task.id, title: "有提示的口述", detail: "请提交录音并确认帮助程度。" }, 201);
    const work = await f.upload(f.actors.student, { assignmentId: task.id, familyTaskId: family.id });
    await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: work.id, helpLevel: "prompted" });
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: input.objectiveId, score: 90 }] }));
    if (index === 0) {
      draft = await suggest();
      assert.equal(draft.measures.find((item) => item.ability === "reading").score, null);
      assert.equal(draft.measures.find((item) => item.ability === "reading").availableCount, 1);
    }
  }
  await f.upload(f.actors.student, { assignmentId: task.id });
  const totalOnly = await f.upload(f.actors.student, { assignmentId: task.id });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(totalOnly.id));
  draft = await suggest();
  assert.equal(draft.ready, false);
  assert.equal(draft.measures.find((item) => item.ability === "speaking").availableCount, 0);
  await f.act(f.actors.teacher, "create_intervention", { ...input, title: "不得发布无依据草稿", detail: "测试", evidenceKey: "forged" }, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_recommendations WHERE source_type='teacher'").first()).count, 0);
  await f.act(f.actors.teacher, "create_intervention", { ...input, title: "教师手动安排", detail: "人工判断需要补充口述诊断。" }, 201);
});

test("support evidence is revalidated on publish and cannot cross roles, students, classes or tenants", async (t) => {
  const f = await fixture(t);
  const s = await supportEvidence(f);
  const sameSecond = "2026-10-18 10:00:00";
  await f.db.prepare("UPDATE submissions SET reviewed_at=? WHERE tenant_id=? AND student_user_id=? AND review_status='reviewed'").bind(sameSecond, f.tenantId, f.ids.student).run();
  await f.db.prepare("UPDATE diagnostic_attempts SET completed_at=? WHERE tenant_id=? AND student_user_id=?").bind(sameSecond, f.tenantId, f.ids.student).run();
  const draft = await s.suggest();
  for (const actor of ["student", "guardian", "otherGuardian"]) await s.suggest("student", actor, 403);
  for (const actor of ["otherTeacher", "otherTenant"]) await s.suggest("student", actor, 404);
  const publish = (extra = {}, expectedStatus = 409) => f.act(f.actors.teacher, "create_intervention", { studentUserId: f.ids.student, objectiveId: s.objectiveId, title: draft.title, detail: draft.detail, evidenceKey: draft.evidenceKey, ...extra }, expectedStatus);
  await publish({ studentUserId: f.ids.stranger });
  await publish({ detail: "" }, 400);
  const work = await f.upload(f.actors.student, { assignmentId: s.speaking.id, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: s.objectiveId, score: 0 }] }));
  await f.db.prepare("UPDATE submissions SET reviewed_at=? WHERE id=?").bind(sameSecond, work.id).run();
  const attempt = await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: s.reading.id, selectedOption: 0, revision: 1 }, { itemId: s.listening.id, selectedOption: 0, revision: 1 }] }, 201);
  await f.db.prepare("UPDATE diagnostic_attempts SET completed_at=? WHERE id=?").bind(sameSecond, attempt.attemptId).run();
  await publish();
  const latest = await s.suggest();
  assert.notEqual(latest.evidenceKey, draft.evidenceKey);
  assert.equal(latest.measures.find((item) => item.ability === "speaking").score, 45, "latest teacher confirmation must be used even within the same second");
  const readLatest = latest.measures.find((item) => item.ability === "reading");
  assert.equal(readLatest.score, 50);
  assert.ok(readLatest.records.some((item) => item.id === `${attempt.attemptId}:reading`), "latest same-second attempt must replace an older record");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_recommendations WHERE source_type='teacher'").first()).count, 0);
  const otherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "另一班级", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: otherClass.id, studentUserIds: [f.ids.student] });
  const scoped = await s.suggest("student", "otherTeacher");
  assert.equal(scoped.ready, false);
  assert.equal(scoped.measures.find((item) => item.ability === "speaking").availableCount, 0);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [] });
  await publish({}, 403);
});

test("family templates retain bilingual guidance and original goals and rubric through parent confirmation, edits and teacher feedback", async (t) => {
  const f = await fixture(t);
  const base = { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "原始交流任务", detail: "用自己的中文总结，写下提问与追问。", partner: "family" };
  await f.act(f.actors.guardian, "create_family_task", { ...base, templateId: "unknown-template" }, 400);
  await f.act(f.actors.guardian, "create_family_task", { ...base, partner: "unknown-partner" }, 400);
  const tasks = [];
  for (const templateId of ["home-dish", "festival-memory", "daily-choice"]) {
    const task = await f.act(f.actors.guardian, "create_family_task", { ...base, templateId }, 201);
    const stored = (await f.workspace(f.actors.student)).recommendations.find((item) => item.id === task.id);
    const plan = JSON.parse(stored.family_plan_json);
    assert.equal(plan.template.id, templateId); assert.equal(plan.revision, 1);
    assert.ok(plan.template.steps.length && plan.template.stems.length && plan.template.questions.length);
    for (const text of [...plan.template.steps, ...plan.template.stems, plan.template.work, ...plan.template.questions.flatMap((item) => [item.ask, item.followUp])]) assert.ok(text.zh && text.en, "guidance must work in both languages");
    tasks.push({ ...task, plan });
  }
  const task = tasks[0];
  const work = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, familyTaskId: task.id, familyPartner: "family", familyRevision: 1, answer: "我问先做什么，又追问为什么先炒鸡蛋。对方说先炒蛋再放番茄，因为鸡蛋更松软。" }, 201);
  const original = JSON.parse((await f.workspace(f.actors.student)).submissions.find((item) => item.id === work.id).family_snapshot_json);
  assert.deepEqual(original.plan, task.plan); assert.equal(original.title, base.title); assert.equal(original.objectiveId, base.objectiveId);
  assert.deepEqual(original.rubric.map((item) => item.name), ["提问切题", "追问与倾听", "复述与表达"]);
  await f.act(f.actors.guardian, "update_family_task", { ...base, id: task.id, title: "编辑后的任务", detail: "现在改成节日采访。", templateId: "festival-memory", partner: "teacher", revision: 1 });
  await f.act(f.actors.teacher, "confirm_alternative_exchange", { submissionId: work.id, helpLevel: "independent" }, 409);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id), 409);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: work.id, helpLevel: "prompted" });
  let stored = (await f.workspace(f.actors.guardian)).submissions.find((item) => item.id === work.id);
  assert.equal(stored.family_confirmed_by, f.ids.guardian); assert.equal(stored.family_confirmation_role, "guardian");
  assert.equal(stored.score, null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count, 0);
  await f.db.prepare("UPDATE assignments SET rubric_json=? WHERE id=?").bind(JSON.stringify([{ name: "后来修改的量规", weight: 100 }]), f.assignment.id).run();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: f.goals[1], score: 80 }] }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { dimensionScores: [{ name: "后来修改的量规", score: 80 }] }), 400);
  const dimensions = [{ name: "提问切题", score: 85 }, { name: "追问与倾听", score: 60 }, { name: "复述与表达", score: 75 }];
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: base.objectiveId, score: 75 }], dimensionScores: dimensions, comment: "问题切题，下一次请围绕做法继续追问，并减少句式提示。" }));
  for (const actor of ["student", "guardian", "teacher"]) {
    const data = await f.workspace(f.actors[actor]); stored = data.submissions.find((item) => item.id === work.id);
    assert.equal(stored.score, 80); assert.match(stored.feedback, /围绕做法继续追问/);
    assert.deepEqual(JSON.parse(stored.family_snapshot_json), original, "editing the task must not replace the submitted instructions");
  }
  assert.equal((await f.workspace(f.actors.student)).recommendations.find((item) => item.id === task.id).status, "completed");
  const review = await f.db.prepare("SELECT dimension_scores_json FROM submission_reviews WHERE submission_id=? AND status='confirmed'").bind(work.id).first();
  assert.deepEqual(JSON.parse(review.dimension_scores_json), dimensions);
});

test("peer and teacher exchanges use scoped teacher witnessing without guardian-created grades", async (t) => {
  const f = await fixture(t);
  const another = await f.act(f.actors.otherTeacher, "create_class", { name: "同学生的另一班", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: another.id, studentUserIds: [f.ids.student] });
  for (const partner of ["peer", "teacher"]) {
    const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "替代交流验证", detail: "与实际对象交流后提交自己的总结。", templateId: "daily-choice", partner }, 201);
    const work = await f.upload(f.actors.student, { familyTaskId: task.id, familyPartner: partner, familyRevision: 1 });
    const confirmation = { submissionId: work.id, helpLevel: "independent" };
    for (const actor of ["student", "guardian", "otherGuardian", "otherTeacher"]) await f.act(f.actors[actor], "confirm_alternative_exchange", confirmation, 403);
    await f.act(f.actors.otherTenant, "confirm_alternative_exchange", confirmation, 404);
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id), 409);
    await f.act(f.actors.teacher, "confirm_alternative_exchange", confirmation);
    let stored = (await f.workspace(f.actors.guardian)).submissions.find((item) => item.id === work.id);
    assert.equal(stored.family_confirmation_role, "teacher"); assert.equal(stored.family_confirmed_by, f.ids.teacher); assert.equal(stored.familyConfirmedName, "teacher");
    assert.equal(JSON.parse(stored.family_snapshot_json).partner, partner); assert.equal(stored.score, null);
    assert.equal((await f.readAudio(f.actors.student, work.id)).status, 200);
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 70 }] }));
    await f.act(f.actors.teacher, "confirm_alternative_exchange", confirmation, 409);
    stored = (await f.workspace(f.actors.student)).submissions.find((item) => item.id === work.id);
    assert.equal(stored.review_status, "reviewed"); assert.equal(stored.score, 80);
  }
});

test("family task revisions protect text and audio drafts and cannot change between validation and insertion", async (t) => {
  const f = await fixture(t);
  const base = { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "版本一", detail: "家常菜采访。", templateId: "home-dish", partner: "family" };
  const task = await f.act(f.actors.guardian, "create_family_task", base, 201);
  await f.act(f.actors.guardian, "update_family_task", { ...base, id: task.id, revision: 1, title: "版本二" });
  const text = (revision, status) => f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, familyTaskId: task.id, familyPartner: "peer", familyRevision: revision, answer: "我提出问题、追问并用自己的话总结。" }, status);
  await text(1, 409);
  await f.upload(f.actors.student, { familyTaskId: task.id, familyPartner: "peer", familyRevision: 1 }, 409);
  await f.act(f.actors.guardian, "update_family_task", { ...base, id: task.id, revision: 1 }, 409);
  await text(-1, 400);
  const prepare = f.db.prepare.bind(f.db);
  let interleaved = false;
  f.db.prepare = (sql) => {
    const statement = prepare(sql); const first = statement.first.bind(statement);
    statement.first = async (...args) => {
      const row = await first(...args);
      if (row?.id === task.id && !interleaved) {
        interleaved = true;
        await f.act(f.actors.guardian, "update_family_task", { ...base, id: task.id, revision: 2, title: "版本三", partner: "teacher" });
      }
      return row;
    };
    return statement;
  };
  await text(2, 409); assert.ok(interleaved);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM submissions").first()).count, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='submission.created'").first()).count, 0);
  const work = await text(3, 201);
  const snapshot = JSON.parse((await f.workspace(f.actors.student)).submissions.find((item) => item.id === work.id).family_snapshot_json);
  assert.equal(snapshot.title, "版本三"); assert.equal(snapshot.plan.revision, 3);
  assert.equal(snapshot.plan.partner, "teacher"); assert.equal(snapshot.partner, "peer", "actual partner is a submission-level fact");
});

test("learning sequences connect a reviewed baseline, practice and transfer with frozen criteria and measured evidence", async (t) => {
  const f = await fixture(t);
  const baseline = await f.text();
  const input = { id: crypto.randomUUID(), baselineSubmissionId: baseline.id, objectiveId: f.goals[0], title: "推荐家常菜的迁移验证", practicePrompt: "练习用先、再说明做法，并解释推荐理由。", transferPrompt: "向同伴推荐另一道菜，回答一个新问题。", transferContext: "从向家人介绍喜欢的菜，改为向同伴推荐另一道菜。" };
  await f.act(f.actors.teacher, "create_learning_sequence", input, 404);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(baseline.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 35 }], dimensionScores: [{ name: "语言表达", score: 30 }], helpLevel: "prompted" }));
  await f.act(f.actors.teacher, "create_learning_sequence", { ...input, objectiveId: f.goals[1] }, 400);
  await f.act(f.actors.teacher, "create_learning_sequence", { ...input, transferPrompt: input.practicePrompt }, 400);
  const sequence = await f.act(f.actors.teacher, "create_learning_sequence", input, 201);
  assert.equal((await f.act(f.actors.teacher, "create_learning_sequence", input, 201)).id, sequence.id);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='learning_sequence.created' AND target_id=?").bind(sequence.id).first()).count, 1);
  await f.act(f.actors.teacher, "create_learning_sequence", { ...input, title: "重试不得覆盖原任务" }, 409);
  const submit = (stage, extra = {}, status = 201) => f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: sequence.id, sequenceStage: stage, answer: `${stage}：先介绍食材，再说明理由。`, ...extra }, status);
  await submit("transfer", {}, 409);
  await submit("invalid-stage", {}, 400);
  const practice = await submit("practice");
  await submit("practice", {}, 409);
  assert.equal((await f.workspace(f.actors.student)).learningPlan.find((item) => item.kind === "sequence").waitingReview, true);
  assert.equal((await f.db.prepare("SELECT score FROM submissions WHERE id=?").bind(practice.id).first()).score, null);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(practice.id), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(practice.id, { helpLevel: "invented" }), 400);
  await f.db.prepare("UPDATE assignments SET title='课程标题已修改',rubric_json=? WHERE id=?").bind(JSON.stringify([{ name: "新维度", weight: 100 }]), f.assignment.id).run();
  await f.db.prepare("DELETE FROM assignment_objectives WHERE assignment_id=? AND objective_id=?").bind(f.assignment.id, f.goals[0]).run();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(practice.id, { helpLevel: "prompted", objectiveScores: [{ objectiveId: f.goals[1], score: 80 }] }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(practice.id, { helpLevel: "prompted", objectiveScores: [{ objectiveId: f.goals[0], score: 55 }], dimensionScores: [{ name: "语言表达", score: 50 }] }));
  const plan = (await f.workspace(f.actors.student)).learningPlan.find((item) => item.kind === "sequence");
  assert.equal(plan.id, `sequence:${sequence.id}:transfer`); assert.equal(plan.waitingReview, false);
  const transfer = await submit("transfer");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(transfer.id, { helpLevel: "independent", contextConfirmed: "yes" }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(transfer.id, { helpLevel: "independent", contextConfirmed: true, objectiveScores: [{ objectiveId: f.goals[0], score: 75 }], dimensionScores: [{ name: "语言表达", score: 70 }] }));
  for (const actor of ["student", "teacher", "guardian", "admin"]) {
    const stored = (await f.workspace(f.actors[actor])).learningSequences.find((item) => item.id === sequence.id);
    assert.equal(stored.baseline.id, baseline.id); assert.equal(stored.practice[0].id, practice.id); assert.equal(stored.transfer[0].id, transfer.id);
    assert.equal(stored.baseline.objectives[0].score, 35); assert.equal(stored.transfer[0].objectives[0].score, 75);
    assert.equal(stored.baseline.title, "介绍一道家常菜"); assert.equal(stored.practicePrompt, input.practicePrompt);
    assert.deepEqual(stored.rubric, rubric); assert.deepEqual(stored.transfer[0].rubric, rubric);
    assert.deepEqual(stored.baseline.dimensions, [{ name: "语言表达", score: 30 }]);
    assert.deepEqual(stored.transfer[0].dimensions, [{ name: "语言表达", score: 70 }]);
    assert.equal(stored.baseline.helpLevel, "prompted"); assert.equal(stored.transfer[0].helpLevel, "independent"); assert.equal(stored.transfer[0].contextConfirmed, true);
    assert.match(stored.transfer[0].textAnswer, /transfer/);
  }
  assert.ok(!(await f.workspace(f.actors.student)).learningPlan.some((item) => item.kind === "sequence"));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=? AND objective_id=?").bind(f.ids.student, f.goals[0]).first()).count, 3);
});

test("sequence audio, permissions and retries preserve the original stage and cannot cross students, classes or tenants", async (t) => {
  const f = await fixture(t);
  const baseline = await f.upload(f.actors.student);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(baseline.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 50 }], helpLevel: "unknown" }));
  const input = { baselineSubmissionId: baseline.id, objectiveId: f.goals[0], title: "录音迁移", practicePrompt: "口述并练习解释理由。", transferPrompt: "向不同同伴推荐另一道菜并回答新问题。", transferContext: "交流对象与菜品改变。" };
  for (const actor of ["student", "guardian"]) await f.act(f.actors[actor], "create_learning_sequence", input, 403);
  const otherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "另一教师的班级", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: otherClass.id, studentUserIds: [f.ids.student] });
  for (const actor of ["otherTeacher", "otherTenant"]) await f.act(f.actors[actor], "create_learning_sequence", input, 403);
  const sequence = await f.act(f.actors.teacher, "create_learning_sequence", input, 201);
  const target = { sequenceId: sequence.id, sequenceStage: "practice" };
  await f.upload(f.actors.stranger, target, 404); await f.upload(f.actors.student, { ...target, sequenceStage: "transfer" }, 409);
  await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, ...target, answer: "录音任务不能用文字代替。" }, 400);
  const id = crypto.randomUUID(); const practice = await f.upload(f.actors.student, { id, ...target });
  await f.upload(f.actors.student, { id, ...target }, 200);
  await f.upload(f.actors.student, { id, ...target, sequenceStage: "transfer" }, 409);
  await f.upload(f.actors.student, target, 409);
  for (const actor of ["stranger", "otherTeacher", "otherGuardian", "otherTenant"]) {
    const data = await f.workspace(f.actors[actor]);
    assert.ok(!data.learningSequences.some((item) => item.id === sequence.id));
    assert.ok(!data.sequenceSources.some((item) => item.work.id === baseline.id));
    assert.equal((await f.readAudio(f.actors[actor], practice.id)).status, 404);
  }
  for (const actor of ["student", "guardian"]) assert.equal((await f.workspace(f.actors[actor])).sequenceSources.length, 0);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "跨角色教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  await f.act(f.actors.otherTeacher, "create_learning_sequence", input, 403);
  assert.ok(!(await f.workspace(f.actors.otherTeacher)).sequenceSources.some((item) => item.work.id === baseline.id));
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(practice.id, { helpLevel: "assisted" }));
  const transfer = await f.upload(f.actors.student, { ...target, sequenceStage: "transfer" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(transfer.id, { helpLevel: "prompted", contextConfirmed: false }));
  const stored = (await f.workspace(f.actors.student)).learningSequences.find((item) => item.id === sequence.id);
  assert.equal(stored.transfer[0].helpLevel, "prompted"); assert.equal(stored.transfer[0].contextConfirmed, false);
  assert.deepEqual(stored.transfer[0].objectives, []); assert.deepEqual(stored.transfer[0].dimensions, []);
  assert.equal((await f.readAudio(f.actors.guardian, transfer.id)).status, 200);
});

test("legacy baseline criteria remain unknown and sequence evidence is not truncated with recent submission history", async (t) => {
  const f = await fixture(t);
  const baseline = await f.text();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(baseline.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 50 }] }));
  await f.db.prepare("UPDATE submission_reviews SET evidence_json='{}' WHERE submission_id=?").bind(baseline.id).run();
  const input = { baselineSubmissionId: baseline.id, objectiveId: f.goals[0], title: "旧作品迁移", practicePrompt: "针对初次困难练习。", transferPrompt: "在新的情境中独立表达。", transferContext: "从家庭交流改为课堂推荐。" };
  const sequence = await f.act(f.actors.teacher, "create_learning_sequence", input, 201);
  const practice = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: sequence.id, sequenceStage: "practice", answer: "先练习。" }, 201);
  for (let index = 0; index < 52; index++) await f.db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,review_status,score) VALUES (?,?,?,?,?,'reviewed',50)").bind(`later-${index}`, f.tenantId, f.assignment.id, f.ids.student, "后续普通记录").run();
  const teacher = await f.workspace(f.actors.teacher);
  assert.ok(teacher.submissions.some((item) => item.id === practice.id));
  assert.ok(teacher.sequenceSources.some((item) => item.work.id === baseline.id));
  const stored = (await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === sequence.id);
  assert.equal(stored.baseline.rubric, null); assert.equal(stored.baseline.helpLevel, "unknown");
  assert.equal(stored.practice[0].reviewed, false); assert.equal(stored.practice[0].score, null); assert.deepEqual(stored.practice[0].dimensions, []);
  await f.db.prepare("UPDATE assignments SET rubric_json=? WHERE id=?").bind(JSON.stringify([{ name: "替换量规", weight: 100 }]), f.assignment.id).run();
  assert.deepEqual((await f.workspace(f.actors.student)).learningSequences.find((item) => item.id === sequence.id).rubric, rubric);
  const diagnostic = await f.act(f.actors.teacher, "create_assignment", { classId: f.classroom.id, title: "原始量规已保留的短文", activityType: "表达", objectiveIds: [f.goals[0]], rubric, diagnosticMode: "writing", diagnosticPrompt: "写下推荐理由。" }, 201);
  await f.act(f.actors.teacher, "publish_assignment", { id: diagnostic.id });
  const writing = await f.act(f.actors.student, "submit_text", { assignmentId: diagnostic.id, answer: "因为简单又好吃。" }, 201);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(writing.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 60 }] }));
  await f.db.prepare("UPDATE submission_reviews SET evidence_json='{}' WHERE submission_id=?").bind(writing.id).run();
  const known = (await f.workspace(f.actors.teacher)).sequenceSources.find((item) => item.work.id === writing.id);
  assert.deepEqual(known.work.rubric, rubric, "existing diagnostic criteria are historical evidence, not reconstructed metadata");
});

async function reviewedTransfer(f, audio = false) {
  const baseline = audio ? await f.upload(f.actors.student) : await f.text();
  const assess = (id, score = 70) => f.act(f.actors.teacher, "confirm_submission_review", f.review(id, { helpLevel: "independent", contextConfirmed: true, objectiveScores: [{ objectiveId: f.goals[0], score }], dimensionScores: [{ name: "语言表达", score }] }));
  await assess(baseline.id, 40);
  const sequence = await f.act(f.actors.teacher, "create_learning_sequence", { baselineSubmissionId: baseline.id, objectiveId: f.goals[0], title: "家常菜延后验证", practicePrompt: "练习完整解释食材和理由。", transferPrompt: "向同伴推荐一道新菜并回答问题。", transferContext: "改变菜品和交流对象。" }, 201);
  const submit = (stage, status = 201, actor = "student") => audio ? f.upload(f.actors[actor], { sequenceId: sequence.id, sequenceStage: stage }, status)
    : f.act(f.actors[actor], "submit_text", { assignmentId: f.assignment.id, sequenceId: sequence.id, sequenceStage: stage, answer: "先说明新菜的食材，再解释推荐理由。" }, status);
  const practice = await submit("practice"); await assess(practice.id, 55);
  const transfer = await submit("transfer"); await assess(transfer.id);
  return { sequence, baseline, practice, transfer, submit, assess };
}

test("delayed retests require a reviewed transfer and a future zoned time, preserve one fixed reference, and enforce teacher scope", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const input = { sequenceId: flow.sequence.id, referenceSubmissionId: flow.transfer.id, prompt: "隔一段时间，向新同学介绍另一道菜，独立回答新问题。", context: "更换同学、菜品和问题。", availableAt: new Date(Date.now() + 60_000).toISOString() };
  const schedule = (extra = {}, actor = "teacher", status = 201) => f.act(f.actors[actor], "schedule_delayed_retest", { ...input, ...extra }, status);
  const legacy = (await f.workspace(f.actors.student)).learningSequences.find((item) => item.id === flow.sequence.id);
  assert.equal(legacy.retestAvailableAt, null); assert.equal(legacy.retestOpen, false); assert.deepEqual(legacy.retest, []);
  await flow.submit("retest", 409);
  for (const actor of ["student", "guardian", "otherTeacher"]) await schedule({}, actor, 403);
  await schedule({}, "otherTenant", 404);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "跨角色教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.ok((await f.workspace(f.actors.otherTeacher)).learningSequences.some((item) => item.id === flow.sequence.id));
  assert.equal((await f.workspace(f.actors.otherTeacher)).learningSequences.find((item) => item.id === flow.sequence.id).canScheduleRetest, false);
  await schedule({}, "otherTeacher", 403);
  for (const availableAt of ["not-a-time", "2026-12-01T10:00:00", new Date(Date.now() - 1000).toISOString()]) await schedule({ availableAt }, "teacher", 400);
  await schedule({ referenceSubmissionId: flow.baseline.id }, "teacher", 404);
  await schedule({ referenceSubmissionId: flow.practice.id }, "teacher", 404);
  const another = await reviewedTransfer(f);
  await schedule({ referenceSubmissionId: another.transfer.id }, "teacher", 404);
  const pending = await flow.submit("transfer");
  await schedule({ referenceSubmissionId: pending.id }, "teacher", 404);
  await schedule({ prompt: "向同伴推荐一道新菜并回答问题。" }, "teacher", 400);
  await schedule(); await schedule();
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='learning_sequence.retest_scheduled' AND target_id=?").bind(flow.sequence.id).first()).count, 1);
  await schedule({ prompt: "不得替换已发布的安排。" }, "teacher", 409);
  await schedule({ availableAt: new Date(Date.now() + 120_000).toISOString() }, "teacher", 409);
  await flow.assess(pending.id, 99);
  const saved = (await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === flow.sequence.id);
  assert.equal(saved.transfer[0].id, pending.id); assert.equal(saved.retestReferenceId, flow.transfer.id);
  assert.equal(saved.retestOpen, false); assert.equal(saved.retestAvailableAt, input.availableAt);
  assert.ok(!(await f.workspace(f.actors.student)).learningPlan.some((item) => item.id.endsWith(":retest")));
});

test("delayed text and audio retests stay locked until due, freeze evidence, and complete through teacher review and all role reports", async (t) => {
  const f = await fixture(t);
  const text = await reviewedTransfer(f);
  const audio = await reviewedTransfer(f, true);
  const availableAt = new Date(Date.now() + 60_000).toISOString();
  for (const flow of [text, audio]) await f.act(f.actors.teacher, "schedule_delayed_retest", { sequenceId: flow.sequence.id, referenceSubmissionId: flow.transfer.id, prompt: "独立向新邻居推荐另一道菜，并回答对方的新问题。", context: "更换为邻居与另一道菜。", availableAt }, 201);
  await text.submit("retest", 409); await audio.submit("retest", 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE sequence_stage='retest'").first()).count, 0);
  t.mock.method(Date, "now", () => Date.parse(availableAt));
  // 到达边界后开放；客户端重试已保存的安排仍可恢复原结果。
  await f.act(f.actors.teacher, "schedule_delayed_retest", { sequenceId: text.sequence.id, referenceSubmissionId: text.transfer.id, prompt: "独立向新邻居推荐另一道菜，并回答对方的新问题。", context: "更换为邻居与另一道菜。", availableAt }, 201);
  assert.ok((await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === `sequence:${text.sequence.id}:retest` && !item.waitingReview));
  await text.submit("retest", 404, "stranger"); await audio.submit("retest", 404, "stranger");
  await f.db.prepare("UPDATE assignments SET rubric_json='[]',title='课程后来变更' WHERE id=?").bind(f.assignment.id).run();
  for (const flow of [text, audio]) {
    const retest = await flow.submit("retest"); await flow.submit("retest", 409);
    const raw = await f.db.prepare("SELECT sequence_snapshot_json,score FROM submissions WHERE id=?").bind(retest.id).first();
    const snapshot = JSON.parse(raw.sequence_snapshot_json);
    assert.equal(raw.score, null); assert.equal(snapshot.referenceSubmissionId, flow.transfer.id); assert.equal(snapshot.availableAt, availableAt);
    assert.equal(snapshot.objectiveId, f.goals[0]); assert.deepEqual(snapshot.rubric, rubric); assert.equal(snapshot.stage, "retest");
    assert.equal(snapshot.context, "更换为邻居与另一道菜。");
    assert.ok((await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === `sequence:${flow.sequence.id}:retest` && item.waitingReview));
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(retest.id), 400);
    if (flow === text) await flow.assess(retest.id, 75);
    else {
      await f.upload(f.actors.student, { id: retest.id, sequenceId: flow.sequence.id, sequenceStage: "retest" }, 200);
      assert.equal((await f.readAudio(f.actors.guardian, retest.id)).status, 200);
      assert.equal((await f.readAudio(f.actors.otherGuardian, retest.id)).status, 404);
      await f.act(f.actors.teacher, "confirm_submission_review", f.review(retest.id, { helpLevel: "unknown", contextConfirmed: false }));
    }
    for (const actor of ["student", "teacher", "guardian", "admin"]) {
      const saved = (await f.workspace(f.actors[actor])).learningSequences.find((item) => item.id === flow.sequence.id);
      assert.equal(saved.retestOpen, true); assert.equal(saved.retestReferenceId, flow.transfer.id); assert.equal(saved.retest[0].id, retest.id);
      assert.deepEqual(saved.retest[0].rubric, rubric); assert.equal(saved.retest[0].reviewed, true);
      assert.equal(saved.retest[0].helpLevel, flow === text ? "independent" : "unknown"); assert.equal(saved.retest[0].contextConfirmed, flow === text);
      assert.equal(saved.retest[0].objectives.length, flow === text ? 1 : 0); assert.equal(saved.retest[0].dimensions.length, flow === text ? 1 : 0);
    }
    assert.ok(!(await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === `sequence:${flow.sequence.id}:retest`));
  }
});

test("teaching next steps enforce scoped reviewed evidence and atomically publish one immutable plan with retry recovery", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const input = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, referenceSubmissionId: flow.transfer.id, kind: "fade_support", rationale: "这份迁移作品已独立解释理由，下一轮逐步撤去关键词。", remaining: "仍需观察新问题中的独立追问。", title: "减少提示后的下一轮", practicePrompt: "先使用两个关键词，再遮住关键词复述。", transferPrompt: "向另一同学推荐新菜并独立回答新问题。", transferContext: "更换同学、菜品和问题。" };
  const publish = (extra = {}, actor = "teacher", status = 201) => f.act(f.actors[actor], "publish_teaching_next_step", { ...input, ...extra }, status);
  for (const actor of ["student", "guardian", "otherTeacher"]) await publish({}, actor, 403);
  await publish({}, "otherTenant", 404);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "跨角色教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.equal((await f.workspace(f.actors.otherTeacher)).learningSequences.find((item) => item.id === flow.sequence.id).canPlanNext, false);
  await publish({}, "otherTeacher", 403);
  for (const extra of [{ id: "invalid-id" }, { kind: "auto_pass" }, { rationale: "" }, { remaining: "" }, { practicePrompt: input.transferPrompt }]) await publish(extra, "teacher", 400);
  for (const referenceSubmissionId of [flow.baseline.id, flow.practice.id]) await publish({ referenceSubmissionId }, "teacher", 404);
  const foreign = await reviewedTransfer(f);
  await publish({ referenceSubmissionId: foreign.transfer.id }, "teacher", 404);
  const pending = await flow.submit("transfer"); await publish({ referenceSubmissionId: pending.id }, "teacher", 404);
  const before = await f.db.prepare("SELECT COUNT(*) AS count FROM learning_sequences").first();
  const published = await publish();
  assert.deepEqual(await publish(), published);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_sequences").first()).count, before.count + 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_sequence_decisions WHERE sequence_id=?").bind(flow.sequence.id).first()).count, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='learning_sequence.next_step_published' AND target_id=?").bind(flow.sequence.id).first()).count, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE kind='learning_sequence' AND title=?").bind(input.title).first()).count, 1);
  await publish({ rationale: "不能覆盖历史判断。" }, "teacher", 409);
  await publish({ id: crypto.randomUUID() }, "teacher", 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_sequences").first()).count, before.count + 1, "duplicate references must not leave orphan next-round tasks");
  await flow.assess(pending.id);
  await f.db.prepare("CREATE TRIGGER fixture_block_decision_notification BEFORE INSERT ON notifications WHEN NEW.kind='learning_sequence' BEGIN SELECT RAISE(ABORT,'fixture_notification_failed'); END").run();
  await publish({ id: crypto.randomUUID(), referenceSubmissionId: pending.id }, "teacher", 500);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_sequences").first()).count, before.count + 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM learning_sequence_decisions WHERE reference_submission_id=?").bind(pending.id).first()).count, 0);
  await f.db.prepare("DROP TRIGGER fixture_block_decision_notification").run();
  assert.deepEqual((await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === foreign.sequence.id).decisions, []);
});

test("teacher-confirmed next rounds retain retest or incomplete transfer evidence, and text and audio proceed through assessment and all reports", async (t) => {
  const f = await fixture(t);
  const text = await reviewedTransfer(f);
  const audio = await reviewedTransfer(f, true);
  const availableAt = new Date(Date.now() + 60_000).toISOString();
  await f.act(f.actors.teacher, "schedule_delayed_retest", { sequenceId: text.sequence.id, referenceSubmissionId: text.transfer.id, prompt: "隔时向邻居解释另一道菜的做法。", context: "改为邻居和新菜。", availableAt }, 201);
  t.mock.method(Date, "now", () => Date.parse(availableAt));
  const retest = await text.submit("retest"); await text.assess(retest.id, 75);
  const unmeasured = await audio.submit("transfer");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(unmeasured.id, { helpLevel: "unknown", contextConfirmed: false }));
  const beforeMastery = (await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count;
  await f.db.prepare("UPDATE assignments SET title='课程后来修改',rubric_json='[]' WHERE id=?").bind(f.assignment.id).run();
  for (const flow of [text, audio]) {
    const reference = flow === text ? retest : unmeasured;
    const countBeforePublish = (await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count;
    const result = await f.act(f.actors.teacher, "publish_teaching_next_step", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, referenceSubmissionId: reference.id,
      kind: flow === text ? "challenge" : "collect_evidence", rationale: "教师核对了原始作品和完成条件，确认此轮任务方向。", remaining: "仍需在另一对象和新问题中观察表现。", title: flow === text ? "增加追问挑战" : "补充独立口述证据", practicePrompt: "围绕同一目标组织理由并练习追问。", transferPrompt: "换为新邻居，介绍另一道菜并回答新问题。", transferContext: "对象、菜品和问题均更换。" }, 201);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count, countBeforePublish, "teaching decisions must not manufacture assessment evidence");
    for (const actor of ["student", "teacher", "guardian", "admin"]) {
      const data = await f.workspace(f.actors[actor]);
      const parent = data.learningSequences.find((item) => item.id === flow.sequence.id);
      const next = data.learningSequences.find((item) => item.id === result.nextSequenceId);
      assert.equal(parent.decisions[0].reference.id, reference.id); assert.equal(parent.decisions[0].nextSequenceId, next.id);
      assert.equal(next.baseline.id, reference.id); assert.equal(next.origin.sequenceId, flow.sequence.id); assert.equal(next.origin.kind, flow === text ? "challenge" : "collect_evidence");
      assert.equal(next.objectiveId, f.goals[0]); assert.deepEqual(next.rubric, rubric); assert.equal(next.medium, flow === text ? "text" : "audio");
      assert.equal(next.retestAvailableAt, null); assert.deepEqual(next.decisions, []);
      if (flow === audio) { assert.deepEqual(next.baseline.objectives, []); assert.equal(next.baseline.helpLevel, "unknown"); assert.equal(next.baseline.contextConfirmed, false); }
    }
    for (const actor of ["stranger", "otherGuardian", "otherTeacher", "otherTenant"]) assert.ok(!(await f.workspace(f.actors[actor])).learningSequences.some((item) => item.id === result.nextSequenceId));
    const submit = (stage, status = 201) => flow === audio ? f.upload(f.actors.student, { sequenceId: result.nextSequenceId, sequenceStage: stage }, status)
      : f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: result.nextSequenceId, sequenceStage: stage, answer: "下一轮：先说明食材，再说明理由并提出新问题。" }, status);
    assert.ok((await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === `sequence:${result.nextSequenceId}:practice`));
    await submit("transfer", 409);
    const practice = await submit("practice");
    await flow.assess(practice.id, 80);
    assert.ok((await f.workspace(f.actors.student)).learningPlan.some((item) => item.id === `sequence:${result.nextSequenceId}:transfer`));
    const transfer = await submit("transfer"); await flow.assess(transfer.id, 82);
    if (flow === audio) { assert.equal((await f.readAudio(f.actors.guardian, transfer.id)).status, 200); assert.equal((await f.readAudio(f.actors.stranger, transfer.id)).status, 404); }
    const saved = (await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === result.nextSequenceId);
    assert.equal(saved.transfer[0].objectives[0].score, 82); assert.equal(saved.transfer[0].helpLevel, "independent"); assert.equal(saved.transfer[0].contextConfirmed, true);
    assert.deepEqual(saved.transfer[0].rubric, rubric);
    assert.ok(!(await f.workspace(f.actors.student)).learningPlan.some((item) => item.id.startsWith(`sequence:${result.nextSequenceId}:`)));
    // 只把真实后续作品的教师评价纳入下一轮计数。
    const count = (await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots").first()).count;
    if (flow === text) assert.equal(count, beforeMastery + 2);
  }
});

test("trial records retain actual workload and failure observations without changing grades, with idempotent and atomic writes", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const before = await f.db.prepare("SELECT COUNT(*) AS count,SUM(mastery) AS total FROM mastery_snapshots").first();
  const input = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "preparation", method: "platform", minutes: 0, referenceSubmissionId: flow.baseline.id, note: "本次复用已完成备课，实际新增备课为零分钟。" };
  const save = (extra = {}, status = 201) => f.act(f.actors.teacher, "create_trial_record", { ...input, ...extra }, status);
  for (const extra of [{ id: "bad-id" }, { kind: "improved" }, { method: "automatic" }, { minutes: null }, { minutes: "0" }, { minutes: -1 }, { minutes: 1.5 }, { minutes: 1441 }, { note: " " }]) await save(extra, 400);
  const unrelated = await f.text();
  await save({ referenceSubmissionId: unrelated.id }, 400);
  const another = await reviewedTransfer(f);
  await save({ referenceSubmissionId: another.transfer.id }, 400);
  await Promise.all([save(), save()]); await save();
  await save({ minutes: 12 }, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='trial_record.created' AND target_id=?").bind(input.id).first()).count, 1);
  for (const kind of ["not_completed", "withdrawn", "no_improvement"]) {
    await save({ id: crypto.randomUUID(), kind, method: null, minutes: null, referenceSubmissionId: null, note: `实际观察：${kind}，尚需了解具体原因。` });
    await save({ id: crypto.randomUUID(), kind, method: null, minutes: 0 }, 400);
  }
  await f.db.prepare("UPDATE assignments SET title='后来改名' WHERE id=?").bind(f.assignment.id).run();
  const records = (await f.workspace(f.actors.teacher)).trialEntries;
  const stored = records.find((item) => item.id === input.id);
  assert.equal(stored.minutes, 0); assert.equal(stored.referenceTitle, "介绍一道家常菜"); assert.equal(stored.note, input.note);
  assert.equal(records.length, 4);
  const summary = api.trialSummary(records, []);
  assert.deepEqual(summary.workload.find((item) => item.kind === "preparation" && item.method === "platform"), { kind: "preparation", method: "platform", count: 1, minutes: 0 });
  assert.equal(summary.workload.find((item) => item.method === "previous").minutes, null);
  assert.deepEqual(summary.observations.map((item) => item.count), [1, 1, 1]);
  // 另一完整任务组产生三份评分；试用记录本身不增加成绩证据。
  const after = await f.db.prepare("SELECT COUNT(*) AS count,SUM(mastery) AS total FROM mastery_snapshots").first();
  assert.equal(after.count, before.count + 3);
  await f.db.prepare("CREATE TRIGGER fail_trial_audit BEFORE INSERT ON audit_logs WHEN NEW.action='trial_record.created' BEGIN SELECT RAISE(ABORT,'trial_audit_unavailable'); END").run();
  const failedId = crypto.randomUUID();
  await save({ id: failedId }, 500);
  assert.equal(await f.db.prepare("SELECT id FROM learning_trial_records WHERE id=?").bind(failedId).first(), null);
});

test("trial privacy uses teaching authority independently of guardian roles and retains access for withdrawal documentation", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const input = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "review", method: "platform", minutes: 8, note: "教师本人实记批阅用时。" };
  await f.act(f.actors.teacher, "create_trial_record", input, 201);
  const observation = { ...input, id: crypto.randomUUID(), kind: "not_completed", method: null, minutes: null, note: "无法完成：需要更简短的任务说明。" };
  await f.act(f.actors.teacher, "create_trial_record", observation, 201);
  for (const actor of ["student", "guardian", "otherTeacher", "otherGuardian"]) {
    assert.deepEqual((await f.workspace(f.actors[actor])).trialEntries, []);
    await f.act(f.actors[actor], "create_trial_record", { ...input, id: crypto.randomUUID() }, 403);
    await f.act(f.actors[actor], "void_trial_record", { id: input.id, reason: "越权撤销" }, 403);
  }
  await f.act(f.actors.otherTenant, "create_trial_record", { ...input, id: crypto.randomUUID() }, 404);
  await f.act(f.actors.otherTenant, "void_trial_record", { id: input.id, reason: "跨租户" }, 404);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "跨角色教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.ok((await f.workspace(f.actors.otherTeacher)).learningSequences.some((item) => item.id === flow.sequence.id));
  assert.deepEqual((await f.workspace(f.actors.otherTeacher)).trialEntries, []);
  await f.act(f.actors.otherTeacher, "create_trial_record", { ...input, id: crypto.randomUUID() }, 403);
  // 更换任课教师后，新教师只能读班级观察，不能读前任教师个人耗时，也不能撤销其记录。
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  const replacement = (await f.workspace(f.actors.otherTeacher)).trialEntries;
  assert.deepEqual(replacement.map((item) => item.id), [observation.id]); assert.equal(replacement[0].canVoid, false);
  await f.act(f.actors.otherTeacher, "void_trial_record", { id: observation.id, reason: "不是本人记录" }, 403);
  await f.act(f.actors.teacher, "void_trial_record", { id: input.id, reason: "已失去班级权限" }, 403);
  assert.equal((await f.workspace(f.actors.admin)).trialEntries.length, 2);
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.teacher, f.classroom.id).run();
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [f.ids.stranger] });
  await f.act(f.actors.teacher, "create_trial_record", { ...observation, id: crypto.randomUUID(), kind: "withdrawn", note: "学生离班后补记退出原因。" }, 201);
  assert.ok((await f.workspace(f.actors.teacher)).learningSequences.some((item) => item.id === flow.sequence.id));
});

test("voided trial records keep reasons, exclude summaries, and do not duplicate audit events on retries", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const input = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "ai_revision", method: "previous", minutes: 12, note: "记录方式填错，需保留更正过程。" };
  await f.act(f.actors.teacher, "create_trial_record", input, 201);
  const voided = { id: input.id, reason: "工作方式应为平台辅助；撤销后另记。" };
  await f.act(f.actors.teacher, "void_trial_record", { ...voided, reason: " " }, 400);
  await Promise.all([f.act(f.actors.teacher, "void_trial_record", voided), f.act(f.actors.teacher, "void_trial_record", voided)]);
  await f.act(f.actors.teacher, "void_trial_record", voided);
  await f.act(f.actors.admin, "void_trial_record", { ...voided, reason: "不得覆盖原撤销原因" }, 409);
  const entries = (await f.workspace(f.actors.admin)).trialEntries;
  assert.equal(entries.length, 1); assert.ok(entries[0].voidedAt); assert.equal(entries[0].voidReason, voided.reason); assert.equal(entries[0].canVoid, false);
  assert.ok(api.trialSummary(entries, []).workload.every((item) => item.count === 0 && item.minutes === null));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='trial_record.voided' AND target_id=?").bind(input.id).first()).count, 1);
});

test("teacher prompt counts stay optional, validate actual help, freeze across next rounds and remain visible in text and audio evidence", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const work = await flow.submit("transfer");
  for (const promptCount of ["0", -1, 0.5, 1001]) await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { helpLevel: "unknown", promptCount }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { helpLevel: "independent", promptCount: 1 }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { helpLevel: "prompted", promptCount: 0 }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { helpLevel: "prompted", promptCount: 2, contextConfirmed: true, objectiveScores: [{ objectiveId: f.goals[0], score: 65 }] }));
  const next = await f.act(f.actors.teacher, "publish_teaching_next_step", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, referenceSubmissionId: work.id, kind: "fade_support", rationale: "仍需两次提示，下一轮逐步减少支持。", remaining: "观察新对象下的独立表达。", title: "减少提示的后续练习", practicePrompt: "借助关键词练习说明。", transferPrompt: "向新邻居介绍另一道菜。", transferContext: "改变菜品及对象。" }, 201);
  for (const actor of ["student", "guardian", "teacher", "admin"]) {
    const sequences = (await f.workspace(f.actors[actor])).learningSequences;
    const parent = sequences.find((item) => item.id === flow.sequence.id);
    assert.equal(parent.baseline.promptCount, null); assert.equal(parent.transfer.find((item) => item.id === work.id).promptCount, 2);
    assert.equal(parent.decisions[0].reference.promptCount, 2); assert.equal(sequences.find((item) => item.id === next.nextSequenceId).baseline.promptCount, 2);
    assert.deepEqual(api.trialSummary([], sequences).prompts, { known: 1, missing: 3 });
  }
  // 历史快照缺字段保持未知，读取不回填或改写历史 JSON。
  await f.db.prepare("UPDATE learning_sequence_decisions SET reference_snapshot_json=json_remove(reference_snapshot_json,'$.promptCount') WHERE next_sequence_id=?").bind(next.nextSequenceId).run();
  const legacy = (await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === flow.sequence.id);
  assert.equal(legacy.decisions[0].reference.promptCount, null);
  const audio = await reviewedTransfer(f, true);
  const spoken = await audio.submit("transfer");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(spoken.id, { helpLevel: "independent", promptCount: 0, contextConfirmed: true }));
  const evidence = (await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === audio.sequence.id).transfer[0];
  assert.equal(evidence.promptCount, 0); assert.deepEqual(evidence.objectives, []); assert.equal((await f.readAudio(f.actors.guardian, spoken.id)).status, 200);
  const family = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, objectiveId: f.goals[0], assignmentId: f.assignment.id, title: "核对家庭交流提示次数", detail: "交流后说明实际提供的提示。" }, 201);
  const familyWork = await f.text(family.id);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: familyWork.id, helpLevel: "prompted" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(familyWork.id, { helpLevel: "unknown", promptCount: 0 }), 400);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(familyWork.id, { helpLevel: "unknown", promptCount: 3 }));
});

test("unit reports recheck all role and tenant permissions, exclude internal observations, and never write grades", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  await f.act(f.actors.teacher, "create_trial_record", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "review", method: "platform", minutes: 12, note: "仅教师及机构可见的内部耗时依据" }, 201);
  await f.act(f.actors.teacher, "create_trial_record", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "no_improvement", note: "不进入学生报告的内部观察原因" }, 201);
  const before = await f.db.prepare("SELECT COUNT(*) AS count,SUM(mastery) AS total FROM mastery_snapshots").first();
  for (const actor of ["student", "guardian", "teacher", "admin"]) {
    const { response, html } = await f.unitReport(f.actors[actor], flow.sequence.id);
    assert.match(response.headers.get("content-type"), /text\/html/); assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    for (const id of [flow.baseline.id, flow.practice.id, flow.transfer.id]) assert.ok(html.includes(id));
    assert.ok(html.includes("未记录")); assert.ok(html.includes("尚未安排延后复测"));
    assert.ok(!html.includes("仅教师及机构可见的内部耗时依据")); assert.ok(!html.includes("不进入学生报告的内部观察原因"));
  }
  for (const actor of ["stranger", "otherGuardian", "otherTeacher", "otherTenant"]) await f.unitReport(f.actors[actor], flow.sequence.id, 404);
  await f.unitReport(null, flow.sequence.id, 401);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "跨角色教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  await f.unitReport(f.actors.otherTeacher, flow.sequence.id);
  await f.internalReport(f.actors.otherTeacher, flow.sequence.id, 404);
  assert.deepEqual(await f.db.prepare("SELECT COUNT(*) AS count,SUM(mastery) AS total FROM mastery_snapshots").first(), before);
  for (const actor of ["teacher", "student", "guardian"]) {
    await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids[actor]).run();
    const gated = await f.unitReport(f.actors[actor], flow.sequence.id, 403);
    assert.ok(gated.html.includes("请先修改初始密码")); assert.ok(!gated.html.includes(flow.baseline.id));
    if (actor === "teacher") assert.ok((await f.internalReport(f.actors[actor], undefined, 403)).html.includes("请先修改初始密码"));
    await f.db.prepare("UPDATE users SET must_change_password=0 WHERE id=?").bind(f.ids[actor]).run();
    await f.unitReport(f.actors[actor], flow.sequence.id);
  }
});

test("unit reports preserve full histories, pending and unknown evidence, fixed retest references and next-round snapshots with escaped content", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f, true);
  const extra = await flow.submit("transfer");
  const untrusted = '<script>window.bad=1</script> & "原始反馈"';
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(extra.id, { score: 0, comment: untrusted, helpLevel: "independent", promptCount: 0, contextConfirmed: true }));
  const availableAt = new Date(Date.now() + 60_000).toISOString();
  await f.act(f.actors.teacher, "schedule_delayed_retest", { sequenceId: flow.sequence.id, referenceSubmissionId: flow.transfer.id, prompt: "隔时向新邻居介绍另一道菜。", context: "改为邻居和新菜品。", availableAt }, 201);
  t.mock.method(Date, "now", () => Date.parse(availableAt));
  const retest = await flow.submit("retest");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(retest.id, { helpLevel: "unknown" }));
  const next = await f.act(f.actors.teacher, "publish_teaching_next_step", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, referenceSubmissionId: extra.id, kind: "collect_evidence", rationale: "缺少目标评价，保留本次原始作品。", remaining: "仍需观察独立新情境表现。", title: "后续单元证据", practicePrompt: "围绕同一目标练习。", transferPrompt: "向新同学介绍另一道菜。", transferContext: "改变交流对象与菜品。" }, 201);
  await f.db.prepare("UPDATE learning_sequences SET title=?,baseline_snapshot_json=json_remove(json_set(baseline_snapshot_json,'$.rubric',json('null')),'$.promptCount') WHERE id=?").bind('<img src=x onerror="bad()">原始单元', flow.sequence.id).run();
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,review_status,sequence_id,sequence_stage,sequence_snapshot_json)
    SELECT 'report-history-'||n,s.tenant_id,s.assignment_id,s.student_user_id,'历史原文 '||n,'reviewed',s.sequence_id,'practice',s.sequence_snapshot_json
    FROM submissions s,copies WHERE s.id=?`).bind(flow.practice.id).run();
  let { html } = await f.unitReport(f.actors.guardian, flow.sequence.id);
  assert.ok(html.includes("练习 56 份")); assert.ok(html.includes("report-history-55")); assert.ok(html.includes("历史原文 55"));
  assert.ok(html.includes(`固定参照作品 ID：${flow.transfer.id}`)); assert.ok(html.includes(retest.id));
  assert.ok(html.includes("历史量规未保留")); assert.ok(html.includes("暂不计算前后差值"));
  assert.ok(html.includes("教师确认总分：0")); assert.ok(html.includes("提示次数：0"));
  assert.ok(html.includes(`/api/v1/submissions/${extra.id}/audio`)); assert.ok(html.includes("PDF 不嵌入录音"));
  assert.ok(!html.includes(untrusted)); assert.ok(html.includes("&lt;script&gt;window.bad=1&lt;/script&gt; &amp; &quot;原始反馈&quot;"));
  assert.ok(!html.includes('<img src=x onerror=')); assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  const child = (await f.unitReport(f.actors.student, next.nextSequenceId)).html;
  assert.ok(child.includes("本组来自")); assert.ok(child.includes(encodeURIComponent(flow.sequence.id))); assert.ok(child.includes("提示次数：0"));
  const pending = await flow.submit("transfer");
  await f.db.prepare("UPDATE assignments SET rubric_json='[]' WHERE id=?").bind(f.assignment.id).run();
  const pendingEvidence = (await f.workspace(f.actors.guardian)).learningSequences.find((item) => item.id === flow.sequence.id).transfer.find((item) => item.id === pending.id);
  assert.deepEqual(pendingEvidence.rubric, rubric, "pending sequence work retains its submitted criteria even before a review exists");
  assert.deepEqual(pendingEvidence.dimensions, []);
  html = (await f.unitReport(f.actors.guardian, flow.sequence.id)).html;
  assert.ok(html.includes(pending.id)); assert.ok(html.includes("迁移作品待教师评价"));
  assert.ok(html.includes("待批阅时不回退到旧成绩"));
});

test("internal printable reports separate personal workload, class observations, tenant scope and voided history", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f);
  const first = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "preparation", method: "platform", minutes: 0, note: "前任教师个人耗时私有标记" };
  await f.act(f.actors.teacher, "create_trial_record", first, 201);
  await f.act(f.actors.teacher, "create_trial_record", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "withdrawn", note: "本班退出观察 <script>bad()</script>" }, 201);
  for (const actor of ["student", "guardian", "otherGuardian"]) await f.internalReport(f.actors[actor], undefined, 403);
  await f.internalReport(null, undefined, 401);
  await f.internalReport(f.actors.otherTenant, flow.sequence.id, 404);
  await f.internalReport(f.actors.teacher, "", 400);
  const firstReport = (await f.internalReport(f.actors.teacher, flow.sequence.id)).html;
  assert.ok(firstReport.includes("0 分钟")); assert.ok(firstReport.includes("未记录")); assert.ok(firstReport.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  const replacement = (await f.internalReport(f.actors.otherTeacher, flow.sequence.id)).html;
  assert.ok(!replacement.includes(first.note)); assert.ok(replacement.includes("本班退出观察"));
  await f.internalReport(f.actors.teacher, flow.sequence.id, 404);
  const second = { ...first, id: crypto.randomUUID(), kind: "review", minutes: 7, note: "新任教师个人耗时标记" };
  await f.act(f.actors.otherTeacher, "create_trial_record", second, 201);
  await f.act(f.actors.admin, "void_trial_record", { id: second.id, reason: "保留原始更正原因" });
  const { response, html } = await f.internalReport(f.actors.admin);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.ok(html.includes(first.note)); assert.ok(html.includes(second.note)); assert.ok(html.includes("已撤销")); assert.ok(html.includes("保留原始更正原因"));
  assert.ok(html.includes("全部记录与撤销原因 · 3 条"));
  const another = await f.act(f.actors.admin, "create_learning_sequence", { baselineSubmissionId: flow.baseline.id, objectiveId: f.goals[0], title: "另一任务组", practicePrompt: "组织理由。", transferPrompt: "向同学介绍另一道菜。", transferContext: "改变对象与菜品。" }, 201);
  const empty = (await f.internalReport(f.actors.admin, another.id)).html;
  assert.ok(empty.includes("当前范围尚无试用记录")); assert.ok(!empty.includes(first.note)); assert.ok(!empty.includes(second.note));
});

test("family portfolios retain text and audio exchanges, independent confirmation and assessment, and subsequent teaching evidence", async (t) => {
  const f = await fixture(t);
  const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "原始家常菜采访", detail: "记录实际问题、追问和自己的总结。", templateId: "home-dish", partner: "family" }, 201);
  const work = await f.text(task.id);
  let entry = (await f.portfolio(f.actors.student, f.ids.student)).data.entries[0];
  assert.equal(entry.confirmedAt, null); assert.equal(entry.work.reviewed, false); assert.equal(entry.work.score, null); assert.deepEqual(entry.work.objectives, []);
  assert.equal(entry.snapshot.title, "原始家常菜采访"); assert.equal(entry.snapshot.plan.template.id, "home-dish");
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: work.id, helpLevel: "prompted" });
  entry = (await f.portfolio(f.actors.guardian, f.ids.student)).data.entries[0];
  assert.ok(entry.confirmedAt); assert.equal(entry.confirmedByName, "guardian"); assert.equal(entry.confirmationRole, "guardian"); assert.equal(entry.familyHelpLevel, "prompted");
  assert.equal(entry.work.score, null); assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).count, 0);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { score: 0, helpLevel: "prompted", promptCount: 1, objectiveScores: [{ objectiveId: f.goals[0], score: 0 }], dimensionScores: [{ name: "提问切题", score: 0 }] }));
  const sequence = await f.act(f.actors.teacher, "create_learning_sequence", { baselineSubmissionId: work.id, objectiveId: f.goals[0], title: "作品集关联迁移", practicePrompt: "用关键词练习整理做法。", transferPrompt: "向新同伴介绍另一道菜并回答新问题。", transferContext: "改变对象、菜品与问题。" }, 201);
  for (const stage of ["practice", "transfer"]) {
    const submitted = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: sequence.id, sequenceStage: stage, answer: "先说明食材，再解释推荐理由。" }, 201);
    await f.act(f.actors.teacher, "confirm_submission_review", f.review(submitted.id, { helpLevel: "independent", promptCount: 0, contextConfirmed: true }));
  }
  const reference = (await f.workspace(f.actors.student)).learningSequences.find((item) => item.id === sequence.id).transfer[0];
  const next = await f.act(f.actors.teacher, "publish_teaching_next_step", { id: crypto.randomUUID(), sequenceId: sequence.id, referenceSubmissionId: reference.id, kind: "collect_evidence", rationale: "补充目标分项观察。", remaining: "仍需观察新情境表现。", title: "作品集后续安排", practicePrompt: "针对原目标练习说明。", transferPrompt: "向新邻居介绍另一道菜。", transferContext: "改变交流对象与菜品。" }, 201);
  await f.act(f.actors.teacher, "create_trial_record", { id: crypto.randomUUID(), sequenceId: sequence.id, kind: "review", method: "platform", minutes: 5, note: "不应进入家庭作品集的内部耗时" }, 201);
  const audioTask = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[2], title: "替代对象交流", detail: "说明双方的日常选择和理由。", templateId: "daily-choice", partner: "peer" }, 201);
  const spoken = await f.upload(f.actors.student, { familyTaskId: audioTask.id, familyPartner: "teacher" });
  await f.act(f.actors.teacher, "confirm_alternative_exchange", { submissionId: spoken.id, helpLevel: "assisted" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(spoken.id));
  await f.act(f.actors.guardian, "archive_family_task", { id: task.id });
  await f.db.prepare("UPDATE learning_recommendations SET title='后来改名的任务',detail='后来要求',family_plan_json='{}' WHERE id=?").bind(task.id).run();
  await f.db.prepare("UPDATE learning_objectives SET title='后来改名的目标' WHERE id=?").bind(f.goals[0]).run();
  const before = await f.db.prepare("SELECT COUNT(*) AS count,SUM(mastery) AS total FROM mastery_snapshots").first();
  for (const actor of ["student", "guardian", "teacher", "admin"]) {
    const { response, data } = await f.portfolio(f.actors[actor], f.ids.student);
    assert.match(response.headers.get("cache-control"), /private, no-store/); assert.equal(data.entries.length, 2);
    const text = data.entries.find((item) => item.work.id === work.id);
    assert.equal(text.snapshot.title, "原始家常菜采访"); assert.equal(text.snapshot.objectiveTitle, "口语目标"); assert.equal(text.snapshot.plan.template.id, "home-dish");
    assert.equal(text.work.reviewed, true); assert.equal(text.work.score, 0); assert.equal(text.work.objectives[0].score, 0); assert.equal(text.work.promptCount, 1);
    assert.deepEqual(text.sequences.map((item) => [item.id, item.direct]).sort(), [[sequence.id, true], [next.nextSequenceId, false]].sort());
    const audio = data.entries.find((item) => item.work.id === spoken.id);
    assert.equal(audio.snapshot.partner, "teacher"); assert.equal(audio.snapshot.plan.partner, "peer"); assert.equal(audio.confirmationRole, "teacher"); assert.equal(audio.confirmedByName, "teacher"); assert.equal(audio.familyHelpLevel, "assisted");
    assert.equal(audio.work.hasAudio, true); assert.deepEqual(audio.work.objectives, []); assert.equal(audio.work.promptCount, null);
    assert.ok(!JSON.stringify(data).includes("不应进入家庭作品集的内部耗时"));
    await f.unitReport(f.actors[actor], next.nextSequenceId);
  }
  assert.equal((await f.readAudio(f.actors.guardian, spoken.id)).status, 200); assert.equal((await f.readAudio(f.actors.stranger, spoken.id)).status, 404);
  assert.deepEqual(await f.db.prepare("SELECT COUNT(*) AS count,SUM(mastery) AS total FROM mastery_snapshots").first(), before);
});

test("family portfolio candidates and histories respect original classes, tenant and mixed-role scope, revoked bindings and password gates", async (t) => {
  const f = await fixture(t);
  const original = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "原班作品", detail: "记录家常菜交流。" }, 201);
  const first = await f.text(original.id);
  for (const actor of ["stranger", "otherGuardian", "otherTeacher", "otherTenant"]) await f.portfolio(f.actors[actor], f.ids.student, 404);
  await f.portfolio(null, f.ids.student, 401); await f.portfolio(f.actors.student, "", 400);
  assert.deepEqual((await f.portfolio(f.actors.otherTeacher)).data.students, []);
  const otherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "另一个班", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: otherClass.id, studentUserIds: [f.ids.student] });
  const accessibleStudent = (await f.portfolio(f.actors.otherTeacher, f.ids.student)).data;
  assert.equal(accessibleStudent.student.id, f.ids.student); assert.deepEqual(accessibleStudent.entries, []);
  const assignment = await f.act(f.actors.otherTeacher, "create_assignment", { classId: otherClass.id, title: "另一个班的任务", activityType: "交流", objectiveIds: [f.goals[0]], rubric }, 201);
  await f.act(f.actors.otherTeacher, "publish_assignment", { id: assignment.id });
  const otherTask = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: assignment.id, objectiveId: f.goals[0], title: "另一班作品", detail: "记录另一场交流。" }, 201);
  const second = await f.act(f.actors.student, "submit_text", { assignmentId: assignment.id, familyTaskId: otherTask.id, answer: "另一个班的交流作品。" }, 201);
  assert.deepEqual((await f.portfolio(f.actors.teacher, f.ids.student)).data.entries.map((item) => item.work.id), [first.id]);
  assert.deepEqual((await f.portfolio(f.actors.otherTeacher, f.ids.student)).data.entries.map((item) => item.work.id), [second.id]);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "跨角色教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.equal((await f.portfolio(f.actors.otherTeacher, f.ids.student)).data.entries.length, 2);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [] });
  assert.deepEqual((await f.portfolio(f.actors.otherTeacher, f.ids.student)).data.entries.map((item) => item.work.id), [second.id]);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.guardian, studentUserIds: [] });
  await f.portfolio(f.actors.guardian, f.ids.student, 404);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [f.ids.stranger] });
  const history = (await f.portfolio(f.actors.teacher)).data;
  assert.ok(history.students.some((item) => item.id === f.ids.student));
  assert.deepEqual((await f.portfolio(f.actors.teacher, f.ids.student)).data.entries.map((item) => item.work.id), [first.id]);
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  await f.portfolio(f.actors.teacher, f.ids.student, 404);
  for (const actor of ["student", "otherTeacher"]) {
    await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids[actor]).run();
    assert.equal((await f.portfolio(f.actors[actor], f.ids.student, 403)).data.error, "password_change_required");
    await f.db.prepare("UPDATE users SET must_change_password=0 WHERE id=?").bind(f.ids[actor]).run();
    assert.equal((await f.portfolio(f.actors[actor], f.ids.student)).data.entries.length, 2);
  }
});

test("family portfolios include reviewed history beyond recent submissions and preserve unknown legacy requirements", async (t) => {
  const f = await fixture(t);
  const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "较早的交流作品", detail: "原始说明。", templateId: "festival-memory" }, 201);
  const original = await f.text(task.id);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: original.id, helpLevel: "independent" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(original.id));
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,score,review_status,family_task_id,family_snapshot_json)
    SELECT 'family-history-'||n,s.tenant_id,s.assignment_id,s.student_user_id,'历史交流原文 '||n,81,'reviewed',s.family_task_id,s.family_snapshot_json FROM submissions s,copies WHERE s.id=?`).bind(original.id).run();
  await f.db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,score,review_status,family_task_id) VALUES ('legacy-family',?,?,?,'旧作品原文',84,'reviewed',?)")
    .bind(f.tenantId, f.assignment.id, f.ids.student, task.id).run();
  await f.db.prepare("UPDATE learning_recommendations SET title='不能当作旧要求的新标题',detail='不能当作旧要求的新说明',family_plan_json='{}' WHERE id=?").bind(task.id).run();
  assert.ok(!(await f.workspace(f.actors.student)).submissions.some((item) => item.id === original.id));
  const { data } = await f.portfolio(f.actors.guardian, f.ids.student);
  assert.equal(data.entries.length, 57); assert.ok(data.entries.some((item) => item.work.id === original.id)); assert.ok(data.entries.some((item) => item.work.id === "family-history-55"));
  assert.equal(data.entries.find((item) => item.work.id === original.id).snapshot.plan.template.id, "festival-memory");
  const legacy = data.entries.find((item) => item.work.id === "legacy-family");
  assert.equal(legacy.snapshot, null); assert.equal(legacy.work.title, "历史家庭交流作品"); assert.equal(legacy.work.prompt, ""); assert.equal(legacy.work.rubric, null);
  assert.equal(legacy.work.score, 84); assert.equal(legacy.confirmedAt, null); assert.equal(legacy.confirmationRole, null); assert.equal(legacy.familyHelpLevel, "unknown");
  assert.deepEqual(legacy.work.objectives, []); assert.deepEqual(legacy.sequences, []);
  assert.ok(!JSON.stringify(legacy).includes("不能当作旧要求"));
});

test("teaching followups distinguish missing target evidence from measured zero and keep all ordinary pending work actionable beyond recent history", async (t) => {
  const f = await fixture(t);
  const emptyClass = await f.act(f.actors.teacher, "create_class", { name: "空班也可筛选", level: "A2" }, 201);
  let { data, response } = await f.followups();
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(data.items.length, 6); assert.ok(data.items.every((item) => item.kind === "initial" && item.work === null));
  assert.ok(data.classes.some((item) => item.id === emptyClass.id));
  assert.deepEqual(data.students.map((item) => item.id).sort(), [f.ids.student, f.ids.stranger].sort());
  assert.deepEqual(data.objectives.map((item) => item.id).sort(), f.goals.slice().sort());
  const work = await f.text();
  assert.equal((await f.followups()).data.items.filter((item) => item.studentId === f.ids.student).length, 1, "one pending work can cover several goals without duplicate grading tasks");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 0 }] }));
  data = (await f.followups()).data;
  const measured = data.items.find((item) => item.studentId === f.ids.student && item.goals.some((goal) => goal.id === f.goals[0]));
  assert.equal(measured.kind, "transfer_setup"); assert.equal(measured.work.objectives[0].score, 0);
  assert.deepEqual(measured.action, { kind: "source", studentId: f.ids.student, sourceId: work.id, objectiveId: f.goals[0] });
  const unmeasured = data.items.find((item) => item.studentId === f.ids.student && item.goals.some((goal) => goal.id === f.goals[1]));
  assert.equal(unmeasured.kind, "initial"); assert.equal(unmeasured.work.score, 80); assert.equal(unmeasured.work.objectives.length, 1);
  const pending = await f.text();
  await f.db.prepare("UPDATE submissions SET created_at='2000-01-01 00:00:00' WHERE id=?").bind(pending.id).run();
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,score,review_status)
    SELECT 'backlog-history-'||n,tenant_id,assignment_id,student_user_id,'较新的已阅作品',81,'reviewed' FROM submissions,copies WHERE id=?`).bind(work.id).run();
  const gradesBefore = (await f.db.prepare("SELECT COUNT(*) AS n FROM mastery_snapshots").first()).n;
  data = (await f.followups()).data;
  assert.ok(data.items.some((item) => item.action.submissionId === pending.id));
  assert.ok((await f.workspace(f.actors.teacher)).submissions.some((item) => item.id === pending.id), "the grading destination must also include ordinary pending work beyond its recent page");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM mastery_snapshots").first()).n, gradesBefore);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(pending.id));
  assert.ok(!(await f.followups()).data.items.some((item) => item.action.submissionId === pending.id));
  await f.db.prepare("UPDATE assignments SET status='archived' WHERE id=?").bind(f.assignment.id).run();
  assert.equal((await f.followups()).data.items.length, 0, "archived tasks do not demand fresh submissions");
});

test("teaching followups keep family confirmation separate and enforce original class authority for mixed roles and former students", async (t) => {
  const f = await fixture(t);
  const task = await f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "原家庭目标", detail: "先交流再提交自己的口述。" }, 201);
  const work = await f.upload(f.actors.student, { familyTaskId: task.id });
  await f.db.prepare("DELETE FROM assignment_objectives WHERE assignment_id=? AND objective_id=?").bind(f.assignment.id, f.goals[0]).run();
  let item = (await f.followups()).data.items.find((item) => item.work?.id === work.id);
  assert.equal(item.kind, "confirmation"); assert.equal(item.work.hasAudio, true); assert.deepEqual(item.goals.map((goal) => goal.id), [f.goals[0]]);
  await f.act(f.actors.guardian, "confirm_family_submission", { submissionId: work.id, helpLevel: "prompted" });
  item = (await f.followups()).data.items.find((item) => item.work?.id === work.id);
  assert.equal(item.kind, "review"); assert.equal(item.work.score, null); assert.equal(item.work.helpLevel, "prompted");
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [f.ids.stranger] });
  await f.db.prepare("UPDATE assignments SET status='archived' WHERE id=?").bind(f.assignment.id).run();
  assert.ok((await f.followups()).data.students.some((student) => student.id === f.ids.student), "former students with pending original-class work remain actionable");
  for (const actor of ["student", "guardian", "otherGuardian"]) await f.followups(f.actors[actor], 403);
  await f.followups(null, 401);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "复合角色", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  for (const actor of ["otherTeacher", "otherTenant"]) {
    const { data } = await f.followups(f.actors[actor]);
    assert.deepEqual(data.items, []); assert.deepEqual(data.students, []); assert.deepEqual(data.classes, []);
  }
  assert.equal((await f.readAudio(f.actors.teacher, work.id)).status, 200);
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  assert.deepEqual((await f.followups()).data.items, []);
  assert.ok((await f.followups(f.actors.otherTeacher)).data.items.some((item) => item.work?.id === work.id));
  await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids.otherTeacher).run();
  assert.equal((await f.followups(f.actors.otherTeacher, 403)).data.error, "password_change_required");
  assert.ok((await f.followups(f.actors.admin)).data.items.some((item) => item.work?.id === work.id));
});

test("teaching followups advance through practice, transfer and evidence-based next arrangements without reusing older graded work", async (t) => {
  const f = await fixture(t);
  const baseline = await f.text();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(baseline.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 30 }] }));
  const group = await f.act(f.actors.teacher, "create_learning_sequence", { baselineSubmissionId: baseline.id, objectiveId: f.goals[0], title: "待办阶段验证", practicePrompt: "练习说明理由。", transferPrompt: "向新同学解释另一道菜。", transferContext: "更换菜品和对象。" }, 201);
  const related = async () => (await f.followups()).data.items.filter((item) => item.action.sequenceId === group.id || (practice && item.work?.id === practice.id) || (transfer && item.work?.id === transfer.id));
  let practice, transfer;
  assert.equal((await related())[0].kind, "practice");
  practice = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: group.id, sequenceStage: "practice", answer: "理由练习作品。" }, 201);
  assert.deepEqual((await related()).map((item) => item.kind), ["review"]);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(practice.id, { helpLevel: "prompted", objectiveScores: [{ objectiveId: f.goals[0], score: 60 }] }));
  assert.equal((await related()).find((item) => item.action.sequenceId === group.id).kind, "transfer");
  transfer = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: group.id, sequenceStage: "transfer", answer: "换对象的迁移作品。" }, 201);
  assert.deepEqual((await related()).map((item) => item.kind), ["review"]);
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(transfer.id, { helpLevel: "unknown", contextConfirmed: false }));
  const gap = (await related()).find((item) => item.kind === "evidence");
  assert.equal(gap.work.id, transfer.id); assert.deepEqual(gap.work.objectives, []);
  const newer = await f.act(f.actors.student, "submit_text", { assignmentId: f.assignment.id, sequenceId: group.id, sequenceStage: "transfer", answer: "新的迁移作品尚未评价。" }, 201);
  assert.ok(!(await related()).some((item) => item.kind === "evidence"), "latest pending evidence must not silently fall back to an older reviewed work");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(newer.id, { helpLevel: "prompted", contextConfirmed: true, promptCount: 2, objectiveScores: [{ objectiveId: f.goals[0], score: 0 }] }));
  assert.equal((await related()).find((item) => item.kind === "evidence").work.promptCount, 2);
  const next = await f.act(f.actors.teacher, "publish_teaching_next_step", { id: crypto.randomUUID(), sequenceId: group.id, referenceSubmissionId: newer.id, kind: "collect_evidence", rationale: "在减少提示后补充独立作品。", remaining: "独立表达尚待验证。", title: "下一轮补证据", practicePrompt: "减少关键词练习。", transferPrompt: "向另一对象推荐新菜。", transferContext: "对象与菜品改变。" }, 201);
  assert.ok(!(await related()).some((item) => item.kind === "evidence"));
  assert.ok((await f.followups()).data.items.some((item) => item.action.sequenceId === next.nextSequenceId && item.kind === "practice"));
});

test("teaching followups show retests only when due and remove reviewed independent evidence even when its target score is zero", async (t) => {
  const f = await fixture(t);
  const flow = await reviewedTransfer(f, true);
  const groupItems = async () => (await f.followups()).data.items.filter((item) => item.action.sequenceId === flow.sequence.id);
  assert.deepEqual(await groupItems(), [], "complete evidence does not force an endless next round");
  const availableAt = new Date(Date.now() + 60_000).toISOString();
  await f.act(f.actors.teacher, "schedule_delayed_retest", { sequenceId: flow.sequence.id, referenceSubmissionId: flow.transfer.id, prompt: "延后向新邻居介绍另一道菜。", context: "间隔时间并更换对象。", availableAt }, 201);
  assert.deepEqual(await groupItems(), []);
  t.mock.method(Date, "now", () => Date.parse(availableAt));
  const due = (await groupItems())[0];
  assert.equal(due.kind, "retest"); assert.equal(due.time, availableAt); assert.equal(due.work.id, flow.transfer.id);
  const work = await flow.submit("retest");
  assert.deepEqual(await groupItems(), []);
  assert.equal((await f.followups()).data.items.find((item) => item.work?.id === work.id).kind, "review");
  await flow.assess(work.id, 0);
  assert.deepEqual(await groupItems(), []);
  await f.db.prepare("UPDATE learning_objectives SET status='inactive' WHERE id=?").bind(f.goals[0]).run();
  assert.ok(!(await f.followups()).data.items.some((item) => item.kind !== "review" && item.goals.some((goal) => goal.id === f.goals[0])));
});

const familyFeedbackInput = (taskId, extra = {}) => ({ action: "record", id: crypto.randomUUID(), taskId, revision: 1, participation: "unable", instructions: "needs_explanation", operationHelp: "guidance", alternative: "not_tried", note: "看不懂上传步骤，需要操作指引，尚未安排替代交流。", ...extra });
async function feedbackTask(f) {
  return f.act(f.actors.guardian, "create_family_task", { studentUserId: f.ids.student, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "家庭使用反馈验证任务", detail: "用自己的话复述一次交流。", templateId: "home-dish", partner: "peer" }, 201);
}

test("family usability feedback records non-completion before any work and never confirms exchanges, completes tasks or writes language scores", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const input = familyFeedbackInput(task.id);
  assert.equal((await f.feedback()).data.tasks.find((item) => item.id === task.id).revision, 1);
  for (const extra of [{ participation: "" }, { operationHelp: "auto_score" }, { revision: "1" }, { note: "" }, { note: "长".repeat(1501) }]) await f.feedbackAction(f.actors.guardian, { ...input, ...extra }, 400);
  await f.feedbackAction(f.actors.guardian, input); await f.feedbackAction(f.actors.guardian, input);
  await f.feedbackAction(f.actors.guardian, { ...input, note: "同 ID 不得覆盖" }, 409);
  const concurrent = familyFeedbackInput(task.id, { participation: "completed", instructions: "clear", operationHelp: "none", alternative: "not_needed", note: "" });
  await Promise.all([f.feedbackAction(f.actors.guardian, concurrent), f.feedbackAction(f.actors.guardian, concurrent)]);
  const { data, response } = await f.feedback();
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(data.entries.length, 2);
  const stored = data.entries.find((item) => item.id === input.id);
  assert.equal(stored.participation, "unable"); assert.equal(stored.operationHelp, "guidance"); assert.equal(stored.snapshot.plan.template.id, "home-dish"); assert.equal(stored.classId, f.classroom.id);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM submissions").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).n, 0);
  assert.equal((await f.db.prepare("SELECT status FROM learning_recommendations WHERE id=?").bind(task.id).first()).status, "pending");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='family_feedback.created'").first()).n, 2);
  const work = await f.upload(f.actors.student, { familyTaskId: task.id, familyPartner: "peer", familyRevision: 1 });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id), 409);
  await f.act(f.actors.teacher, "confirm_alternative_exchange", { submissionId: work.id, helpLevel: "prompted" });
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(work.id, { objectiveScores: [{ objectiveId: f.goals[0], score: 0 }], helpLevel: "prompted", promptCount: 2 }));
  const gradeBefore = await f.db.prepare("SELECT score,family_help_level,family_confirmed_at FROM submissions WHERE id=?").bind(work.id).first();
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { participation: "stopped", alternative: "did_not_work" }));
  assert.deepEqual(await f.db.prepare("SELECT score,family_help_level,family_confirmed_at FROM submissions WHERE id=?").bind(work.id).first(), gradeBefore);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).n, 1, "only the teacher-rated work produces language evidence");
});

test("family usability feedback restricts parent writing, original-class teaching reads, tenant scope, revoked bindings and password gates", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const input = familyFeedbackInput(task.id);
  await f.feedbackAction(f.actors.guardian, input);
  for (const actor of ["student", "teacher"]) await f.feedbackAction(f.actors[actor], familyFeedbackInput(task.id), 403);
  const unboundAdmin = await api.familyFeedbackAction(new Request("http://127.0.0.1/api/v1/family-feedback", { method: "POST", headers: { cookie: f.actors.admin, "content-type": "application/json" }, body: JSON.stringify(familyFeedbackInput(task.id)) }));
  assert.ok([403, 404].includes(unboundAdmin.status), "administrator access alone never impersonates a bound parent");
  await f.feedback(null, "guardian", f.ids.student, 401);
  await f.feedback(f.actors.student, "guardian", f.ids.student, 403);
  await f.feedback(f.actors.student, "teaching", undefined, 403);
  await f.feedback(f.actors.otherGuardian, "guardian", f.ids.student, 403);
  assert.equal((await f.feedback(f.actors.teacher, "teaching")).data.entries.length, 1);
  assert.equal((await f.feedback(f.actors.otherTeacher, "teaching")).data.entries.length, 0);
  assert.equal((await f.feedback(f.actors.otherTenant, "teaching")).data.entries.length, 0);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "教师与监护复合角色", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.equal((await f.feedback(f.actors.otherTeacher, "guardian")).data.entries.length, 1);
  assert.equal((await f.feedback(f.actors.otherTeacher, "teaching")).data.entries.length, 0, "guardian rights never expand teaching feedback scope");
  await f.feedbackAction(f.actors.otherTeacher, { action: "void", id: input.id, reason: "不能撤销另一家长记录" }, 403);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.guardian, studentUserIds: [] });
  await f.feedback(f.actors.guardian, "guardian", f.ids.student, 403);
  await f.feedbackAction(f.actors.guardian, input, 403);
  await f.feedbackAction(f.actors.guardian, { action: "void", id: input.id, reason: "绑定已撤销" }, 403);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [] });
  assert.equal((await f.feedback(f.actors.teacher, "teaching")).data.entries.length, 1, "withdrawal does not erase original-class records");
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  assert.equal((await f.feedback(f.actors.teacher, "teaching")).data.entries.length, 0);
  assert.equal((await f.feedback(f.actors.otherTeacher, "teaching")).data.entries.length, 1);
  await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids.otherTeacher).run();
  assert.equal((await f.feedback(f.actors.otherTeacher, "teaching", undefined, 403)).data.error, "password_change_required");
  assert.equal((await f.feedbackAction(f.actors.otherTeacher, familyFeedbackInput(task.id), 403)).error, "password_change_required");
  assert.equal((await f.feedback(f.actors.admin, "teaching")).data.entries[0].canVoid, true);
});

test("family usability feedback freezes versions and teaching scope, recovers retries after task edits, and atomically rejects changed tasks or failed audits", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const original = familyFeedbackInput(task.id);
  await f.feedbackAction(f.actors.guardian, original);
  const nextClass = await f.act(f.actors.otherTeacher, "create_class", { name: "新任务原班", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: nextClass.id, studentUserIds: [f.ids.student] });
  const nextAssignment = await f.act(f.actors.otherTeacher, "create_assignment", { classId: nextClass.id, title: "新教学任务", activityType: "文字", objectiveIds: [f.goals[1]], rubric }, 201);
  await f.act(f.actors.otherTeacher, "publish_assignment", { id: nextAssignment.id });
  await f.act(f.actors.guardian, "update_family_task", { id: task.id, assignmentId: nextAssignment.id, objectiveId: f.goals[1], title: "新任务说明", detail: "当前新要求不能覆盖旧反馈。", partner: "teacher", revision: 1 });
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id), 409);
  await f.feedbackAction(f.actors.guardian, original);
  const newer = familyFeedbackInput(task.id, { revision: 2 }); await f.feedbackAction(f.actors.guardian, newer);
  const oldTeacher = (await f.feedback(f.actors.teacher, "teaching")).data;
  assert.deepEqual(oldTeacher.tasks, []); assert.equal(oldTeacher.entries.length, 1); assert.equal(oldTeacher.entries[0].snapshot.title, "家庭使用反馈验证任务"); assert.equal(oldTeacher.entries[0].revision, 1);
  const newTeacher = (await f.feedback(f.actors.otherTeacher, "teaching")).data;
  assert.equal(newTeacher.tasks[0].snapshot.title, "新任务说明"); assert.deepEqual(newTeacher.entries.map((item) => item.id), [newer.id]);
  const originalBatch = f.db.batch.bind(f.db);
  const race = t.mock.method(f.db, "batch", async (statements) => { await f.db.prepare("UPDATE learning_recommendations SET title='并发更新的要求' WHERE id=?").bind(task.id).run(); return originalBatch(statements); });
  const racing = familyFeedbackInput(task.id, { revision: 2 }); await f.feedbackAction(f.actors.guardian, racing, 409); race.mock.restore();
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM family_usability_feedback WHERE id=?").bind(racing.id).first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='family_feedback.created'").first()).n, 2);
  await f.db.prepare("CREATE TRIGGER feedback_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='family_feedback.created' BEGIN SELECT RAISE(ABORT,'fixture_feedback_audit_failed'); END").run();
  const failed = familyFeedbackInput(task.id, { revision: 2 }); await f.feedbackAction(f.actors.guardian, failed, 500);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM family_usability_feedback WHERE id=?").bind(failed.id).first()).n, 0, "audit failure must roll back the feedback");
});

test("family usability history includes all task candidates, keeps archived non-completion, and voids records without replacing their evidence", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const original = familyFeedbackInput(task.id);
  await f.feedbackAction(f.actors.guardian, original);
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO learning_recommendations (id,tenant_id,student_user_id,assignment_id,objective_id,source_type,source_id,title,detail,created_by,family_plan_json)
    SELECT 'feedback-task-'||n,tenant_id,student_user_id,assignment_id,objective_id,'family','feedback-task-'||n,'更多任务 '||n,detail,created_by,family_plan_json FROM learning_recommendations,copies WHERE id=?`).bind(task.id).run();
  assert.equal((await f.feedback()).data.tasks.length, 56);
  await f.act(f.actors.guardian, "archive_family_task", { id: task.id });
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { participation: "stopped", alternative: "did_not_work" }));
  assert.equal((await f.feedback()).data.tasks.find((item) => item.id === task.id).status, "archived");
  await f.feedbackAction(f.actors.guardian, { action: "void", id: original.id, reason: "" }, 400);
  await f.feedbackAction(f.actors.guardian, { action: "void", id: original.id, reason: "误记为本次使用，保留原因撤销。" }, 200);
  await f.feedbackAction(f.actors.guardian, { action: "void", id: original.id, reason: "误记为本次使用，保留原因撤销。" }, 200);
  await f.feedbackAction(f.actors.guardian, { action: "void", id: original.id, reason: "不能覆盖原原因" }, 409);
  await f.feedbackAction(f.actors.guardian, original, 409);
  const entries = (await f.feedback()).data.entries;
  assert.equal(entries.length, 2); assert.equal(entries.filter((item) => !item.voidedAt).length, 1);
  assert.equal(entries.find((item) => item.id === original.id).note, original.note); assert.ok(entries.find((item) => item.id === original.id).voidReason);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='family_feedback.voided'").first()).n, 1);
  for (const body of [null, [], "invalid"]) await f.feedbackAction(f.actors.guardian, body, 400);
  const malformed = await api.familyFeedbackAction(new Request("http://127.0.0.1/api/v1/family-feedback", { method: "POST", headers: { cookie: f.actors.guardian }, body: "{" })); assert.equal(malformed.status, 400);
});

async function batchInput(f, extra = {}, actor = f.actors.teacher) {
  const classroom = (await f.batches(actor)).data.classes.find((item) => item.id === f.classroom.id);
  return { action: "create", id: crypto.randomUUID(), title: "家常菜单元试用 <script>unsafe()</script>", classId: classroom.id, objectiveId: f.goals[0],
    participantIds: classroom.participants.map((person) => person.id), sequenceIds: [], familyTasks: [], catalogVersion: classroom.version,
    startDate: "2000-01-01", endDate: "2099-12-31", workScope: "相同单元、目标及量规；按实际备课和批阅范围核对两种方式，不预设节省时间。", ...extra };
}

test("trial batches freeze the cohort and scope, explicitly append links, recover concurrent retries and never change language evidence", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f, true); const task = await feedbackTask(f);
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id));
  const grades = await f.db.prepare("SELECT id,score,review_status FROM submissions ORDER BY id").all();
  const input = await batchInput(f); await Promise.all([f.batchAction(f.actors.teacher, input), f.batchAction(f.actors.teacher, input)]);
  await f.batchAction(f.actors.teacher, { ...input, workScope: "相同 ID 不能换范围。" }, 409);
  const before = (await f.batches(f.actors.teacher, input.id)).data;
  assert.equal(before.participants.length, 2); assert.ok(before.participants.every((person) => person.groups.length === 0));
  const catalog = (await f.batches()).data.classes.find((item) => item.id === f.classroom.id);
  const link = { action: "link", id: input.id, revision: 1, catalogVersion: catalog.version, sequenceIds: [flow.sequence.id], familyTasks: [{ id: task.id, revision: 1 }] };
  await Promise.all([f.batchAction(f.actors.teacher, link), f.batchAction(f.actors.teacher, link)]);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='trial_batch.linked'").first()).n, 1);
  await f.db.prepare("UPDATE users SET display_name='改名后的学生' WHERE id=?").bind(f.ids.student).run();
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [] });
  await f.batchAction(f.actors.teacher, input); await f.batchAction(f.actors.teacher, link);
  const report = (await f.batches(f.actors.teacher, input.id)).data;
  assert.equal(report.batch.revision, 2); assert.equal(report.batch.scope.sequences.length, 1);
  const person = report.participants.find((person) => person.id === f.ids.student);
  assert.equal(person.name, "student"); assert.notEqual(person.currentStatus, "active"); assert.equal(person.groups[0].source.medium, "audio");
  assert.equal(report.feedback.length, 1); assert.equal(api.batchSummary(report).withoutGroups, 1);
  assert.deepEqual(await f.db.prepare("SELECT id,score,review_status FROM submissions ORDER BY id").all(), grades);
  const printed = await f.batches(f.actors.teacher, input.id, 200, true);
  assert.ok(printed.data.includes("&lt;script&gt;unsafe()&lt;/script&gt;")); assert.ok(!printed.data.includes("<script>unsafe()"));
  assert.match(printed.response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(printed.response.headers.get("cache-control"), "private, no-store");
  assert.ok(printed.data.includes(flow.sequence.id) && printed.data.includes("未关联任务组"));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='trial_batch.created'").first()).n, 1);
});

test("trial batch reports retain zero scores and prompts, use the observation window and frozen family versions, and keep withdrawals separate", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f); const task = await feedbackTask(f);
  const zero = await flow.submit("transfer");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(zero.id, { score: 0, helpLevel: "independent", promptCount: 0, contextConfirmed: true, objectiveScores: [{ objectiveId: f.goals[0], score: 0 }], dimensionScores: [] }));
  await f.db.prepare("UPDATE learning_sequences SET baseline_snapshot_json=json_set(baseline_snapshot_json,'$.submittedAt','2001-02-01 01:00:00','$.reviewedAt','2001-02-01 02:00:00') WHERE id=?").bind(flow.sequence.id).run();
  await f.db.prepare("UPDATE submissions SET created_at='2001-02-02 16:00:00',reviewed_at='2001-02-02 16:00:00' WHERE id=?").bind(zero.id).run();
  const input = await batchInput(f, { startDate: "2001-02-03", endDate: "2001-02-03", sequenceIds: [flow.sequence.id], familyTasks: [{ id: task.id, revision: 1 }] });
  await f.batchAction(f.actors.teacher, input);
  const record = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "review", method: "platform", minutes: 0, note: "本次实际没有额外批阅用时。" };
  await f.act(f.actors.teacher, "create_trial_record", record, 201);
  const withdrawn = { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "withdrawn", note: "家长说明观察周期内无法继续参与。" };
  await f.act(f.actors.teacher, "create_trial_record", withdrawn, 201);
  await f.db.prepare("UPDATE learning_trial_records SET created_at='2001-02-03 02:00:00'").run();
  const firstFeedback = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, firstFeedback);
  await f.db.prepare("UPDATE family_usability_feedback SET created_at='2001-02-02 16:00:00' WHERE id=?").bind(firstFeedback.id).run();
  await f.act(f.actors.guardian, "update_family_task", { id: task.id, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "版本二交流", detail: "当前新要求", partner: "teacher", revision: 1 });
  const secondFeedback = familyFeedbackInput(task.id, { revision: 2 }); await f.feedbackAction(f.actors.guardian, secondFeedback);
  await f.db.prepare("UPDATE family_usability_feedback SET created_at='2001-02-03 03:00:00' WHERE id=?").bind(secondFeedback.id).run();
  const report = (await f.batches(f.actors.teacher, input.id)).data;
  const group = report.participants.find((person) => person.id === f.ids.student).groups[0];
  assert.equal(group.baseline.inPeriod, false); assert.equal(group.baseline.goalScore, 40);
  assert.equal(group.transfer.length, 1); assert.equal(group.transfer[0].goalScore, 0); assert.equal(group.transfer[0].promptCount, 0);
  assert.equal(api.batchSummary(report).independentTransfer, 1); assert.equal(api.batchSummary(report).missingTransfer, 1);
  assert.deepEqual(report.feedback.map((entry) => entry.id), [firstFeedback.id]);
  const summary = api.trialSummary(report.entries, []);
  assert.equal(summary.workload.find((item) => item.kind === "review" && item.method === "platform").minutes, 0);
  assert.equal(summary.workload.find((item) => item.kind === "review" && item.method === "previous").minutes, null);
  assert.equal(summary.observations.find((item) => item.kind === "withdrawn").count, 1);
  await f.db.prepare("UPDATE submissions SET reviewed_at='2001-02-03 16:00:00' WHERE id=?").bind(zero.id).run();
  const bounded = (await f.batches(f.actors.teacher, input.id)).data;
  const boundedWork = bounded.participants.find((person) => person.id === f.ids.student).groups[0].transfer[0];
  assert.equal(boundedWork.reviewed, false); assert.equal(boundedWork.goalScore, null); assert.equal(api.batchSummary(bounded).independentTransfer, 0);
  await f.db.prepare("UPDATE submissions SET created_at='2001-02-03 16:00:00' WHERE id=?").bind(zero.id).run();
  assert.equal((await f.batches(f.actors.teacher, input.id)).data.participants.find((person) => person.id === f.ids.student).groups[0].transfer.length, 0, "Beijing end date is inclusive but the next midnight is excluded");
  const currentCatalog = (await f.batches()).data.classes.find((item) => item.id === f.classroom.id);
  await f.batchAction(f.actors.teacher, { action: "link", id: input.id, revision: 1, catalogVersion: currentCatalog.version, sequenceIds: [], familyTasks: [{ id: task.id, revision: 2 }] });
  assert.equal((await f.batches(f.actors.teacher, input.id)).data.feedback.length, 2, "the new task version enters only after an explicit append");
  await f.feedbackAction(f.actors.guardian, { action: "void", id: firstFeedback.id, reason: "误记的本次反馈。" }, 200);
  const voided = (await f.batches(f.actors.teacher, input.id)).data;
  assert.equal(voided.feedback.length, 2); assert.ok(voided.feedback.find((entry) => entry.id === firstFeedback.id).voidedAt); assert.equal(api.batchSummary(voided).familyRecords, 1); assert.equal(api.batchSummary(voided).missingFamilyTasks, 1);
});

test("trial batches can retrospectively associate actual historical family versions after a task moves to a new class", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const feedback = familyFeedbackInput(task.id);
  await f.feedbackAction(f.actors.guardian, feedback);
  const otherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "家庭任务新班", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: otherClass.id, studentUserIds: [f.ids.student] });
  const assignment = await f.act(f.actors.otherTeacher, "create_assignment", { classId: otherClass.id, title: "新班交流", activityType: "文字", objectiveIds: f.goals, rubric }, 201);
  await f.act(f.actors.otherTeacher, "publish_assignment", { id: assignment.id });
  await f.act(f.actors.guardian, "update_family_task", { id: task.id, assignmentId: assignment.id, objectiveId: f.goals[0], title: "新班版本二", detail: "新版要求", partner: "teacher", revision: 1 });
  const original = (await f.batches()).data.classes.find((item) => item.id === f.classroom.id);
  assert.equal(original.familyTasks.length, 1); assert.equal(original.familyTasks[0].revision, 1); assert.equal(original.familyTasks[0].historical, true);
  assert.equal((await f.batches(f.actors.otherTeacher)).data.classes[0].familyTasks.some((item) => item.revision === 1), false);
  const input = await batchInput(f, { familyTasks: [{ id: task.id, revision: 1 }] }); await f.batchAction(f.actors.teacher, input);
  const report = (await f.batches(f.actors.teacher, input.id)).data;
  assert.deepEqual(report.feedback.map((entry) => entry.id), [feedback.id]); assert.equal(report.batch.scope.familyTasks[0].title, "家庭使用反馈验证任务");
  const append = await batchInput(f); await f.batchAction(f.actors.teacher, append);
  await f.batchAction(f.actors.teacher, { action: "link", id: append.id, revision: 1, catalogVersion: original.version, sequenceIds: [], familyTasks: [{ id: task.id, revision: 1 }] });
  assert.equal((await f.batches(f.actors.teacher, append.id)).data.feedback.length, 1);
});

test("trial batches enforce staff and original-class access, personal workload privacy, composite roles and password gates", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f); const input = await batchInput(f, { sequenceIds: [flow.sequence.id] });
  await f.batchAction(f.actors.teacher, input);
  for (const actor of ["student", "guardian"]) {
    await f.batches(f.actors[actor], undefined, 403); await f.batches(f.actors[actor], input.id, 403); await f.batches(f.actors[actor], input.id, 403, true);
    await f.batchAction(f.actors[actor], input, 403);
  }
  await f.batches(null, undefined, 401);
  await f.batches(f.actors.otherTenant, input.id, 404); await f.batches(f.actors.otherTeacher, input.id, 404);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "复合教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.equal((await f.batches(f.actors.otherTeacher)).data.batches.length, 0); await f.batches(f.actors.otherTeacher, input.id, 404);
  const save = (actor, kind, minutes) => f.act(f.actors[actor], "create_trial_record", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind, ...(minutes === undefined ? {} : { method: "platform", minutes }), note: `${actor} 的实际记录` }, 201);
  await save("teacher", "review", 3); await save("admin", "review", 17); await save("teacher", "no_improvement");
  assert.equal((await f.batches(f.actors.teacher, input.id)).data.entries.length, 2);
  assert.equal((await f.batches(f.actors.admin, input.id)).data.entries.length, 3);
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  await f.batches(f.actors.teacher, input.id, 404); await f.batchAction(f.actors.teacher, input, 404);
  const nextTeacher = (await f.batches(f.actors.otherTeacher, input.id)).data;
  assert.equal(nextTeacher.entries.length, 1); assert.equal(nextTeacher.entries[0].kind, "no_improvement"); assert.equal(nextTeacher.batch.canVoid, false);
  await f.batchAction(f.actors.otherTeacher, { action: "void", id: input.id, reason: "非本人批次" }, 403);
  await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids.otherTeacher).run();
  await f.batches(f.actors.otherTeacher, input.id, 403); await f.batches(f.actors.otherTeacher, input.id, 403, true);
  await f.batchAction(f.actors.otherTeacher, { action: "void", id: input.id, reason: "改密前" }, 403);
  await f.batches(f.actors.admin, input.id);
});

test("trial batch saves reject invalid or stale scope and roll back failed audits; withdrawing a batch preserves all records", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f); const base = await batchInput(f, { sequenceIds: [flow.sequence.id] });
  for (const extra of [{ startDate: "2001-02-30" }, { endDate: "1999-12-31" }, { participantIds: [] }, { participantIds: [f.ids.guardian] }, { objectiveId: f.goals[1] }, { workScope: "" }]) await f.batchAction(f.actors.teacher, { ...base, ...extra }, 400);
  const originalBatch = f.db.batch.bind(f.db);
  const race = t.mock.method(f.db, "batch", async (statements) => { await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE class_id=? AND student_user_id=?").bind(f.classroom.id, f.ids.student).run(); return originalBatch(statements); });
  await f.batchAction(f.actors.teacher, base, 409); race.mock.restore();
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM learning_trial_batches").first()).n, 0);
  await f.batchAction(f.actors.teacher, base, 409);
  const current = await batchInput(f);
  await f.db.prepare("CREATE TRIGGER batch_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action IN ('trial_batch.created','trial_batch.linked') BEGIN SELECT RAISE(ABORT,'fixture_batch_audit_failed'); END").run();
  await f.batchAction(f.actors.teacher, current, 500);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM learning_trial_batches").first()).n, 0);
  await f.db.prepare("DROP TRIGGER batch_audit_failure").run(); await f.batchAction(f.actors.teacher, current);
  await f.db.prepare("CREATE TRIGGER batch_link_failure BEFORE INSERT ON audit_logs WHEN NEW.action='trial_batch.linked' BEGIN SELECT RAISE(ABORT,'fixture_batch_link_failed'); END").run();
  const link = { action: "link", id: current.id, revision: 1, catalogVersion: current.catalogVersion, sequenceIds: [flow.sequence.id], familyTasks: [] };
  await f.batchAction(f.actors.teacher, link, 500);
  assert.equal((await f.batches(f.actors.teacher, current.id)).data.batch.scope.sequences.length, 0);
  await f.db.prepare("DROP TRIGGER batch_link_failure").run(); await f.batchAction(f.actors.teacher, link);
  const reason = { action: "void", id: current.id, reason: "误建的范围，保留本批次历史。" };
  await f.batchAction(f.actors.teacher, { ...reason, reason: "" }, 400);
  await Promise.all([f.batchAction(f.actors.teacher, reason), f.batchAction(f.actors.teacher, reason)]);
  await f.batchAction(f.actors.teacher, { ...reason, reason: "不能覆盖原原因" }, 409);
  await f.batchAction(f.actors.teacher, current, 409); await f.batchAction(f.actors.teacher, link, 409);
  const report = (await f.batches(f.actors.teacher, current.id)).data;
  assert.ok(report.batch.voidedAt); assert.equal(report.batch.voidReason, reason.reason); assert.equal(report.batch.scope.sequences.length, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='trial_batch.voided'").first()).n, 1);
  const bad = await api.batchAction(new Request("http://127.0.0.1/api/v1/trial-batches", { method: "POST", headers: { cookie: f.actors.teacher }, body: "{" })); assert.equal(bad.status, 400);
  for (const body of [null, [], "bad"]) {
    const response = await api.batchAction(new Request("http://127.0.0.1/api/v1/trial-batches", { method: "POST", headers: { cookie: f.actors.teacher }, body: JSON.stringify(body) })); assert.equal(response.status, 400);
  }
});

test("trial batch catalogs and linked evidence cover more than a browsing page without exceeding D1 parameter limits", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f);
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<120)
    INSERT INTO learning_sequences (id,tenant_id,student_user_id,assignment_id,objective_id,objective_title,baseline_submission_id,baseline_snapshot_json,title,practice_prompt,transfer_prompt,transfer_context,rubric_json,medium,created_by)
    SELECT 'batch-group-'||n,tenant_id,student_user_id,assignment_id,objective_id,objective_title,baseline_submission_id,baseline_snapshot_json,'任务组 '||n,practice_prompt,transfer_prompt,transfer_context,rubric_json,medium,created_by FROM learning_sequences,copies WHERE id=?`).bind(flow.sequence.id).run();
  const prepared = f.db.prepare.bind(f.db); let largest = 0;
  t.mock.method(f.db, "prepare", (sql) => { const statement = prepared(sql); const bind = statement.bind.bind(statement); statement.bind = (...args) => { largest = Math.max(largest, args.length); assert.ok(args.length <= 100, "D1 binding limit must hold for complete selections"); return bind(...args); }; return statement; });
  const catalog = (await f.batches()).data.classes.find((item) => item.id === f.classroom.id);
  assert.equal(catalog.sequences.length, 121);
  const input = await batchInput(f, { sequenceIds: catalog.sequences.map((item) => item.id) }); await f.batchAction(f.actors.teacher, input);
  const report = (await f.batches(f.actors.teacher, input.id)).data;
  assert.equal(report.participants.find((person) => person.id === f.ids.student).groups.length, 121); assert.ok(largest < 100);
  await f.db.prepare("UPDATE assignments SET class_id='unreadable-class' WHERE id=?").bind(f.assignment.id).run();
  const missing = (await f.batches(f.actors.teacher, input.id)).data;
  assert.equal(api.batchSummary(missing).unavailableGroups, 121); assert.equal(missing.entries.length, 0);
});

const supportInput = (feedbackId, extra = {}) => ({ action: "respond", id: crypto.randomUUID(), feedbackId, kind: "operation", detail: "先打开家庭任务，再选择录音上传；可请同伴交流。", ...extra });

test("family support preserves original and follow-up versions, explicit outcomes and ordered history without writing learning evidence", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const original = familyFeedbackInput(task.id);
  await f.feedbackAction(f.actors.guardian, original);
  const entries = async () => (await f.feedback()).data.entries;
  const state = async () => { const all = await entries(); return api.feedbackCaseState(all.find((item) => item.id === original.id), all); };
  assert.equal(await state(), "unrecorded");
  const response = supportInput(original.id);
  await Promise.all([f.feedbackAction(f.actors.teacher, response), f.feedbackAction(f.actors.teacher, response)]);
  await f.feedbackAction(f.actors.teacher, { ...response, detail: "不可覆盖" }, 409);
  assert.equal(await state(), "awaiting");
  await f.act(f.actors.guardian, "update_family_task", { id: task.id, assignmentId: f.assignment.id, objectiveId: f.goals[0], title: "家庭任务新版本", detail: "新版录音说明", partner: "peer", revision: 1 });
  const followup = familyFeedbackInput(task.id, { revision: 2, responseId: response.id, followupOutcome: "partly" });
  for (const extra of [{ followupOutcome: null }, { followupOutcome: "automatic" }, { responseId: [] }, { responseId: null }, { note: "", participation: "completed", instructions: "clear", operationHelp: "none", alternative: "not_needed" }]) await f.feedbackAction(f.actors.guardian, { ...followup, ...extra }, 400);
  await Promise.all([f.feedbackAction(f.actors.guardian, followup), f.feedbackAction(f.actors.guardian, followup)]);
  assert.equal(await state(), "needs_followup");
  const resolved = familyFeedbackInput(task.id, { revision: 2, responseId: response.id, followupOutcome: "resolved", participation: "in_progress", instructions: "clear", operationHelp: "none", alternative: "worked", note: "现在会上传了，孩子作品仍未提交。" });
  await f.feedbackAction(f.actors.guardian, resolved);
  assert.equal(await state(), "resolved");
  let all = await entries(); const root = all.find((item) => item.id === original.id);
  assert.equal(root.snapshot.title, "家庭使用反馈验证任务"); assert.equal(root.revision, 1); assert.equal(root.responses.length, 1);
  assert.equal(all.find((item) => item.id === resolved.id).snapshot.title, "家庭任务新版本");
  const withdrawal = { action: "void", id: resolved.id, reason: "本次结果误记" }; await f.feedbackAction(f.actors.guardian, withdrawal, 200);
  assert.equal(await state(), "needs_followup");
  const secondResponse = supportInput(original.id, { kind: "partner", detail: "再次安排由教师交流，家长另行反馈。" }); await f.feedbackAction(f.actors.teacher, secondResponse);
  assert.equal(await state(), "awaiting", "new support never inherits a result for an older response");
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { revision: 2, responseId: secondResponse.id, followupOutcome: "not_tried" }));
  assert.equal(await state(), "not_tried");
  const voidResponse = { action: "void_response", id: secondResponse.id, reason: "替代安排需要改约时间" };
  await f.feedbackAction(f.actors.teacher, voidResponse, 200); await f.feedbackAction(f.actors.teacher, voidResponse, 200);
  await f.feedbackAction(f.actors.teacher, { ...voidResponse, reason: "不得覆盖" }, 409);
  await f.feedbackAction(f.actors.teacher, secondResponse, 409);
  assert.equal(await state(), "needs_followup");
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { revision: 2, responseId: secondResponse.id, followupOutcome: "resolved" }), 409);
  await f.feedbackAction(f.actors.teacher, supportInput(followup.id), 400);
  await f.feedbackAction(f.actors.guardian, { action: "void", id: original.id, reason: "撤销原反馈但保留全部处理历史" }, 200);
  await f.feedbackAction(f.actors.teacher, supportInput(original.id), 409);
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { revision: 2, responseId: response.id, followupOutcome: "unresolved" }), 409);
  all = await entries(); assert.equal(all.find((item) => item.id === original.id).responses.length, 2); assert.equal(await state(), "withdrawn");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM submissions").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM mastery_snapshots WHERE student_user_id=?").bind(f.ids.student).first()).n, 0);
  assert.equal((await f.db.prepare("SELECT status FROM learning_recommendations WHERE id=?").bind(task.id).first()).status, "pending");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='family_response.created'").first()).n, 2);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='family_response.voided'").first()).n, 1);
});

test("family support enforces original-class and author permissions, guardian bindings, mixed roles and password gates", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const original = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, original);
  for (const actor of ["guardian", "student", "otherTeacher", "otherTenant"]) await f.feedbackAction(f.actors[actor], supportInput(original.id), 403);
  await f.feedbackAction(null, supportInput(original.id), 401);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "有监护绑定的其他教师", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  await f.feedbackAction(f.actors.otherTeacher, supportInput(original.id), 403);
  const support = supportInput(original.id); await f.feedbackAction(f.actors.teacher, support);
  assert.equal((await f.feedback()).data.entries[0].responses[0].canVoid, false);
  assert.equal((await f.feedback(f.actors.otherTeacher, "guardian")).data.entries[0].responses[0].detail, support.detail);
  for (const actor of ["guardian", "otherTeacher", "student"]) await f.feedbackAction(f.actors[actor], { action: "void_response", id: support.id, reason: "无权撤销" }, 403);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [] });
  await f.act(f.actors.guardian, "archive_family_task", { id: task.id });
  await f.feedbackAction(f.actors.teacher, supportInput(original.id));
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.guardian, studentUserIds: [] });
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { responseId: support.id, followupOutcome: "resolved" }), 404);
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  await f.feedbackAction(f.actors.teacher, support, 403);
  await f.feedbackAction(f.actors.otherTeacher, supportInput(original.id));
  await f.feedbackAction(f.actors.otherTeacher, { action: "void_response", id: support.id, reason: "不是原处理人" }, 403);
  assert.deepEqual((await f.feedback(f.actors.teacher, "teaching")).data.entries, []);
  await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids.otherTeacher).run();
  assert.equal((await f.feedbackAction(f.actors.otherTeacher, supportInput(original.id), 403)).error, "password_change_required");
  await f.feedbackAction(f.actors.admin, { action: "void_response", id: support.id, reason: "管理员撤销误记" }, 200);
  await f.db.prepare("UPDATE family_usability_feedback SET class_id=NULL WHERE id=?").bind(original.id).run();
  await f.feedbackAction(f.actors.teacher, supportInput(original.id), 403);
  await f.feedbackAction(f.actors.admin, supportInput(original.id));
});

test("family support atomically rejects withdrawn sources and changed classes, and rolls back saves and withdrawals if audit fails", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const original = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, original);
  const response = supportInput(original.id);
  for (const extra of [{ kind: "invalid" }, { detail: " " }, { detail: "字".repeat(2001) }, { id: "invalid" }]) await f.feedbackAction(f.actors.teacher, { ...response, ...extra }, 400);
  await f.db.prepare("CREATE TRIGGER support_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='family_response.created' BEGIN SELECT RAISE(ABORT,'support_audit_failed'); END").run();
  await f.feedbackAction(f.actors.teacher, response, 500);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM family_feedback_responses").first()).n, 0);
  await f.db.prepare("DROP TRIGGER support_audit_failure").run(); await f.feedbackAction(f.actors.teacher, response);
  const batch = f.db.batch.bind(f.db);
  const race = t.mock.method(f.db, "batch", async (statements) => { await f.db.prepare("UPDATE family_feedback_responses SET voided_at=CURRENT_TIMESTAMP WHERE id=?").bind(response.id).run(); return batch(statements); });
  const followup = familyFeedbackInput(task.id, { responseId: response.id, followupOutcome: "unresolved" });
  await f.feedbackAction(f.actors.guardian, followup, 409); race.mock.restore();
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM family_usability_feedback WHERE response_id IS NOT NULL").first()).n, 0);
  const next = supportInput(original.id); await f.feedbackAction(f.actors.teacher, next);
  await f.db.prepare("CREATE TRIGGER followup_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='family_feedback.created' BEGIN SELECT RAISE(ABORT,'followup_audit_failed'); END").run();
  await f.feedbackAction(f.actors.guardian, { ...followup, responseId: next.id }, 500);
  await f.db.prepare("DROP TRIGGER followup_audit_failure").run();
  await f.db.prepare("CREATE TRIGGER support_void_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='family_response.voided' BEGIN SELECT RAISE(ABORT,'support_void_audit_failed'); END").run();
  await f.feedbackAction(f.actors.teacher, { action: "void_response", id: next.id, reason: "测试事务" }, 500);
  assert.equal((await f.db.prepare("SELECT voided_at FROM family_feedback_responses WHERE id=?").bind(next.id).first()).voided_at, null);
  await f.db.prepare("DROP TRIGGER support_void_audit_failure").run();
  const otherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "换班后的任务", level: "A2" }, 201);
  const changeClass = t.mock.method(f.db, "batch", async (statements) => { await f.db.prepare("UPDATE assignments SET class_id=? WHERE id=?").bind(otherClass.id, f.assignment.id).run(); return batch(statements); });
  await f.feedbackAction(f.actors.guardian, { ...followup, responseId: next.id }, 409); changeClass.mock.restore();
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { responseId: next.id, followupOutcome: "resolved" }), 409);
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id));
  assert.equal((await f.feedback(f.actors.teacher, "teaching")).data.entries.length, 1, "new-class feedback is not disclosed to the former teacher");
  const rootRace = t.mock.method(f.db, "batch", async (statements) => { await f.db.prepare("UPDATE family_usability_feedback SET voided_at=CURRENT_TIMESTAMP WHERE id=?").bind(original.id).run(); return batch(statements); });
  await f.feedbackAction(f.actors.teacher, supportInput(original.id), 409); rootRace.mock.restore();
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM family_feedback_responses").first()).n, 2);
});

test("family support reads complete ordered histories and trial reports include only period-scoped support with escaped details", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const original = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, original);
  const response = supportInput(original.id, { detail: "原处理 <script>unsafeSupport()</script> & \"内容\"" }); await f.feedbackAction(f.actors.teacher, response);
  const followup = familyFeedbackInput(task.id, { responseId: response.id, followupOutcome: "resolved" }); await f.feedbackAction(f.actors.guardian, followup);
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO family_feedback_responses (id,tenant_id,feedback_id,kind,detail,created_by,created_at)
    SELECT 'support-history-'||n,tenant_id,feedback_id,kind,'期外处理 '||n,created_by,'2001-02-03 16:00:00' FROM family_feedback_responses,copies WHERE id=?`).bind(response.id).run();
  const all = (await f.feedback()).data.entries; const root = all.find((entry) => entry.id === original.id);
  assert.equal(root.responses.length, 56); assert.equal(root.responses[0].id, response.id, "current timestamp sorts above historical support");
  await f.db.prepare("UPDATE family_usability_feedback SET created_at='2001-02-03 01:00:00' WHERE id=?").bind(original.id).run();
  await f.db.prepare("UPDATE family_usability_feedback SET created_at='2001-02-03 02:00:00' WHERE id=?").bind(followup.id).run();
  await f.db.prepare("UPDATE family_feedback_responses SET created_at='2001-02-03 01:01:00' WHERE id=?").bind(response.id).run();
  const input = await batchInput(f, { startDate: "2001-02-03", endDate: "2001-02-03", familyTasks: [{ id: task.id, revision: 1 }] }); await f.batchAction(f.actors.teacher, input);
  const report = (await f.batches(f.actors.teacher, input.id)).data;
  assert.equal(report.feedback.find((entry) => entry.id === original.id).responses.length, 1);
  assert.equal(report.feedback.find((entry) => entry.id === followup.id).followupOutcome, "resolved");
  const { data: html } = await f.batches(f.actors.teacher, input.id, 200, true);
  assert.ok(html.includes("本项使用困难已解决") && html.includes("unsafeSupport()") && html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>unsafeSupport()") && !html.includes("期外处理 55"));
  await f.db.prepare("UPDATE family_feedback_responses SET created_at='2001-02-02 15:59:59' WHERE id=?").bind(response.id).run();
  assert.equal((await f.batches(f.actors.teacher, input.id)).data.feedback.find((entry) => entry.id === original.id).responses.length, 0);
  const latest = (await f.feedback()).data.entries; const latestRoot = latest.find((entry) => entry.id === original.id);
  assert.equal(latestRoot.responses[0].id, "support-history-55", "same-second ties retain insertion order");
  assert.equal(api.feedbackCaseState(latestRoot, latest), "awaiting", "latest support cannot inherit a resolved outcome from an older response");
});

test("student case timeline connects original choices, support, family feedback, audio works, retests and teacher decisions without creating learning effects", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f, true);
  const question = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId: f.goals[0], level: "B1", prompt: "原始目标题面", options: ["甲", "乙", "丙", "丁"], correctOption: 0 }, 201);
  const otherQuestion = await f.act(f.actors.admin, "upsert_diagnostic_item", { objectiveId: f.goals[1], level: "B1", prompt: "另一目标题面", options: ["一", "二", "三", "四"], correctOption: 0 }, 201);
  await f.act(f.actors.student, "submit_diagnostic", { level: "B1", answers: [{ itemId: question.id, selectedOption: 1, revision: 1 }, { itemId: otherQuestion.id, selectedOption: 0, revision: 1 }] }, 201);
  const support = await f.act(f.actors.teacher, "create_intervention", { studentUserId: f.ids.student, objectiveId: f.goals[0], title: "关键词支持", detail: "先用关键词复述，再逐步减少提示。" }, 201);
  const task = await feedbackTask(f); const original = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, original);
  const response = supportInput(original.id); await f.feedbackAction(f.actors.teacher, response);
  const followup = familyFeedbackInput(task.id, { responseId: response.id, followupOutcome: "unresolved" }); await f.feedbackAction(f.actors.guardian, followup);
  await f.feedbackAction(f.actors.teacher, { action: "void_response", id: response.id, reason: "原指引需补充" }, 200);
  const availableAt = new Date(Date.now() + 60_000).toISOString();
  await f.act(f.actors.teacher, "schedule_delayed_retest", { sequenceId: flow.sequence.id, referenceSubmissionId: flow.transfer.id, prompt: "延后向新邻居推荐另一道菜。", context: "间隔时间且改变对象和菜品。", availableAt }, 201);
  t.mock.method(Date, "now", () => Date.parse(availableAt));
  const retest = await flow.submit("retest");
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(retest.id, { score: 0, helpLevel: "independent", promptCount: 0, contextConfirmed: true, objectiveScores: [{ objectiveId: f.goals[0], score: 0 }], dimensionScores: [{ name: "语言表达", score: 0 }] }));
  const decision = await f.act(f.actors.teacher, "publish_teaching_next_step", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, referenceSubmissionId: retest.id, kind: "collect_evidence", rationale: "本次目标为 0，继续观察。", remaining: "独立迁移的稳定性仍待验证。", title: "下一轮证据", practicePrompt: "减少支持练习。", transferPrompt: "向新同学推荐早餐。", transferContext: "改变对象与食物。" }, 201);
  const before = await f.db.prepare("SELECT id,score,review_status,family_confirmed_at FROM submissions ORDER BY id").all();
  const masteryBefore = await f.db.prepare("SELECT * FROM mastery_snapshots ORDER BY id").all();
  const { data, response: http } = await f.studentCase();
  assert.equal(http.headers.get("cache-control"), "private, no-store"); assert.equal(data.student.id, f.ids.student);
  const kinds = new Set(data.events.map((event) => event.kind));
  for (const kind of ["choice", "work", "review", "sequence", "retest", "decision", "feedback", "support", "withdrawal"]) assert.ok(kinds.has(kind), kind);
  assert.ok(data.events.every((event, index) => index === 0 || api.caseTimestamp(data.events[index - 1].at) <= api.caseTimestamp(event.at)));
  const choices = data.events.filter((event) => event.kind === "choice");
  assert.equal(choices.length, 2); assert.ok(choices.every((event) => event.goals.length === 1));
  assert.equal(choices.find((event) => event.snapshot.prompt === "原始目标题面").correct, false);
  const work = data.events.find((event) => event.kind === "work" && event.work.id === retest.id);
  assert.equal(work.stage, "延后复测"); assert.equal(work.work.hasAudio, true); assert.equal(work.work.objectives[0].score, 0); assert.equal(work.work.promptCount, 0);
  assert.ok(work.sequenceIds.includes(flow.sequence.id)); assert.equal((await f.readAudio(f.actors.guardian, retest.id)).status, 200);
  assert.equal(data.events.find((event) => event.kind === "decision").decision.nextSequenceId, decision.nextSequenceId);
  assert.equal(data.events.find((event) => event.kind === "retest").referenceId, flow.transfer.id);
  assert.equal(data.events.find((event) => event.kind === "feedback" && event.entry.id === followup.id).entry.responseId, response.id);
  assert.equal(data.events.find((event) => event.kind === "support").feedbackId, original.id);
  assert.ok(data.events.some((event) => event.kind === "withdrawal" && event.sourceId === response.id));
  assert.ok(data.tasks.some((item) => item.id === support.id && item.kind === "teacher"));
  assert.deepEqual(await f.db.prepare("SELECT id,score,review_status,family_confirmed_at FROM submissions ORDER BY id").all(), before);
  assert.deepEqual(await f.db.prepare("SELECT * FROM mastery_snapshots ORDER BY id").all(), masteryBefore);
  const student = (await f.studentCase(f.actors.student, "student")).data;
  assert.ok(!student.events.some((event) => ["feedback", "support", "withdrawal"].includes(event.kind)));
  assert.ok(student.events.some((event) => event.kind === "work" && event.work.id === retest.id));
});

test("student case timeline isolates viewing roles, original class history, revoked guardian links, tenant scope and password gates", async (t) => {
  const f = await fixture(t); const task = await feedbackTask(f); const feedback = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, feedback);
  const diagnostic = await diagnosticTask(f, "writing");
  await f.act(f.actors.student, "submit_text", { assignmentId: diagnostic.id, answer: "自己的原始诊断作品" }, 201);
  await f.studentCase(null, "teaching", f.ids.student, 401);
  await f.studentCase(f.actors.guardian, "teaching", f.ids.student, 403);
  await f.studentCase(f.actors.teacher, "student", f.ids.student, 403);
  await f.studentCase(f.actors.student, "student", f.ids.stranger, 404);
  await f.studentCase(f.actors.otherTeacher, "teaching", f.ids.student, 404);
  await f.studentCase(f.actors.otherTenant, "teaching", f.ids.student, 404);
  await f.act(f.actors.admin, "create_member", { email: "otherteacher@school.example", displayName: "复合教师监护人", role: "guardian", temporaryPassword: "FixturePassword123" }, 201);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.otherTeacher, studentUserIds: [f.ids.student] });
  assert.ok((await f.studentCase(f.actors.otherTeacher, "guardian")).data.events.some((event) => event.kind === "feedback"));
  await f.studentCase(f.actors.otherTeacher, "teaching", f.ids.student, 404);
  assert.deepEqual((await f.studentCase(f.actors.otherTeacher, "teaching", null)).data.students, []);
  await f.act(f.actors.admin, "set_guardian_links", { guardianUserId: f.ids.guardian, studentUserIds: [] });
  await f.studentCase(f.actors.guardian, "guardian", f.ids.student, 404);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: f.classroom.id, studentUserIds: [] });
  assert.ok((await f.studentCase()).data.events.some((event) => event.kind === "feedback"), "former students retain original-class historical records");
  await f.db.prepare("UPDATE classes SET teacher_user_id=? WHERE id=?").bind(f.ids.otherTeacher, f.classroom.id).run();
  await f.studentCase(f.actors.teacher, "teaching", f.ids.student, 404);
  assert.ok((await f.studentCase(f.actors.otherTeacher)).data.events.some((event) => event.kind === "feedback"));
  await f.db.prepare("UPDATE users SET must_change_password=1 WHERE id=?").bind(f.ids.otherTeacher).run();
  assert.equal((await f.studentCase(f.actors.otherTeacher, "teaching", f.ids.student, 403)).data.error, "password_change_required");
  assert.ok((await f.studentCase(f.actors.admin)).data.events.length > 0);
  for (const view of ["all", "", "administrator"]) await f.studentCase(f.actors.admin, view, f.ids.student, 400);
  await f.studentCase(f.actors.admin, "teaching", " ", 400);
});

test("student case timeline keeps complete histories, unknown goals and pending ratings without borrowing current assignment links", async (t) => {
  const f = await fixture(t); const original = await f.text(); const writing = await diagnosticTask(f, "writing", f.goals[0]);
  const pending = await f.act(f.actors.student, "submit_text", { assignmentId: writing.id, answer: "原目标的待评价表达" }, 201);
  await f.db.prepare(`WITH RECURSIVE copies(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM copies WHERE n<55)
    INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,diagnostic_snapshot_json,created_at)
    SELECT 'case-history-'||n,tenant_id,assignment_id,student_user_id,'更多原作品 '||n,diagnostic_snapshot_json,'2001-01-01 01:00:00' FROM submissions,copies WHERE id=?`).bind(pending.id).run();
  await f.db.prepare("DELETE FROM assignment_objectives WHERE assignment_id=? AND objective_id=?").bind(writing.id, f.goals[0]).run();
  await f.db.prepare("UPDATE assignments SET title='当前新标题' WHERE id=?").bind(writing.id).run();
  const task = await feedbackTask(f); const old = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, old);
  await f.act(f.actors.guardian, "update_family_task", { id: task.id, assignmentId: f.assignment.id, objectiveId: f.goals[1], title: "新目标家庭任务", detail: "目标改版后的说明", partner: "teacher", revision: 1 });
  await f.feedbackAction(f.actors.guardian, familyFeedbackInput(task.id, { revision: 2 }));
  const addedGoal = await f.act(f.actors.admin, "upsert_learning_objective", { code: "CASE-NEW", title: "提交以后新增的目标", skill: "阅读", level: "A2" }, 201);
  await f.db.prepare("DELETE FROM assignment_objectives WHERE assignment_id=?").bind(f.assignment.id).run();
  await f.db.prepare("INSERT INTO assignment_objectives (tenant_id,assignment_id,objective_id) VALUES (?,?,?)").bind(f.tenantId, f.assignment.id, addedGoal.id).run();
  await f.act(f.actors.teacher, "confirm_submission_review", f.review(original.id));
  const data = (await f.studentCase()).data;
  assert.equal(data.events.filter((event) => event.kind === "work").length, 57);
  const unknown = data.events.find((event) => event.kind === "work" && event.work.id === original.id);
  assert.deepEqual(unknown.goals, [], "total-only review must not assign an ordinary old work to goals added after submission");
  assert.deepEqual(data.events.find((event) => event.kind === "review" && event.work.id === original.id).goals, []);
  const writingEvent = data.events.find((event) => event.kind === "work" && event.work.id === pending.id);
  assert.equal(writingEvent.goals[0].id, f.goals[0]); assert.notEqual(writingEvent.work.title, "当前新标题"); assert.equal(writingEvent.work.score, null);
  assert.equal(writingEvent.work.objectives.length, 0); assert.equal(writingEvent.work.promptCount, null);
  assert.equal(data.events.find((event) => event.kind === "feedback" && event.entry.id === old.id).goals[0].id, f.goals[0]);
  assert.ok(data.events.some((event) => event.kind === "feedback" && event.entry.revision === 2 && event.goals[0].id === f.goals[1]));
  assert.equal(data.tasks.find((item) => item.id === task.id).revision, 2); assert.equal(data.tasks.find((item) => item.id === task.id).goal.id, f.goals[1]);
  assert.ok(data.objectives.some((item) => item.id === f.goals[0]) && data.objectives.some((item) => item.id === f.goals[1]));
  assert.equal(data.events.filter((event) => event.kind === "review").length, 1);
});

test("student case timeline separates internal trial records and other-class family versions from authorised learner evidence", async (t) => {
  const f = await fixture(t); const flow = await reviewedTransfer(f); const task = await feedbackTask(f);
  const feedback = familyFeedbackInput(task.id); await f.feedbackAction(f.actors.guardian, feedback);
  await f.act(f.actors.teacher, "create_trial_record", { id: crypto.randomUUID(), sequenceId: flow.sequence.id, kind: "preparation", method: "platform", minutes: 12, note: "仅内部用时细节，不进入案例" }, 201);
  const otherClass = await f.act(f.actors.otherTeacher, "create_class", { name: "另一班级案例", level: "A2" }, 201);
  await f.act(f.actors.admin, "set_class_enrollments", { classId: otherClass.id, studentUserIds: [f.ids.student] });
  const assignment = await f.act(f.actors.otherTeacher, "create_assignment", { classId: otherClass.id, title: "新班教学任务", activityType: "文字", objectiveIds: [f.goals[1]], rubric }, 201);
  await f.act(f.actors.otherTeacher, "publish_assignment", { id: assignment.id });
  await f.act(f.actors.guardian, "update_family_task", { id: task.id, assignmentId: assignment.id, objectiveId: f.goals[1], title: "另一班的新家庭版本", detail: "新班要求不能转移旧反馈的权限。", partner: "teacher", revision: 1 });
  const newer = familyFeedbackInput(task.id, { revision: 2 }); await f.feedbackAction(f.actors.guardian, newer);
  const teacher = (await f.studentCase()).data; const other = (await f.studentCase(f.actors.otherTeacher)).data;
  assert.ok(teacher.events.some((event) => event.kind === "feedback" && event.entry.id === feedback.id));
  assert.ok(!teacher.events.some((event) => event.kind === "feedback" && event.entry.id === newer.id));
  assert.ok(!teacher.tasks.some((item) => item.id === task.id));
  assert.ok(other.events.some((event) => event.kind === "feedback" && event.entry.id === newer.id));
  assert.ok(!other.events.some((event) => event.kind === "feedback" && event.entry.id === feedback.id));
  for (const [actor, view] of [["student", "student"], ["guardian", "guardian"], ["teacher", "teaching"], ["admin", "teaching"]]) assert.ok(!JSON.stringify((await f.studentCase(f.actors[actor], view)).data).includes("仅内部用时细节"));
});

test("additive migration upgrades existing data and runtime initialization is repeatable", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const files = (await readdir(path.join(root, "drizzle"))).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      if (name === "0008_family_exchange.sql") db.exec(`INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,score,review_status) VALUES ('legacy-exchange','legacy-tenant','legacy-assignment','legacy-student',81,'reviewed')`);
      if (name === "0010_delayed_retest.sql") db.exec(`INSERT INTO learning_sequences (id,tenant_id,student_user_id,assignment_id,objective_id,objective_title,baseline_submission_id,baseline_snapshot_json,title,practice_prompt,transfer_prompt,transfer_context,rubric_json,medium,created_by) VALUES ('legacy-sequence','legacy-tenant','legacy-student','legacy-assignment','goal','旧目标','legacy-exchange','{}','旧任务组','原练习','原迁移','原情境','[]','text','legacy-teacher')`);
      if (name === "0015_family_feedback_followups.sql") db.exec(`INSERT INTO family_usability_feedback (id,tenant_id,family_task_id,student_user_id,task_revision,task_snapshot_json,participation,instructions,operation_help,alternative,note,created_by) VALUES ('legacy-feedback','legacy-tenant','legacy-task','legacy-student',1,'{}','unable','unclear','guidance','not_tried','旧困难','legacy-guardian')`);
      db.exec(await readFile(path.join(root, "drizzle", name), "utf8"));
    }
    assert.deepEqual({ ...db.prepare("SELECT score,family_snapshot_json,family_confirmed_by,family_confirmation_role FROM submissions WHERE id='legacy-exchange'").get() }, { score: 81, family_snapshot_json: "{}", family_confirmed_by: null, family_confirmation_role: null });
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('submission_reviews') WHERE name='objective_scores_json'").get());
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('submissions') WHERE name='family_confirmed_at'").get());
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0006_learning_workflow_evidence.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0007_ability_evidence.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0008_family_exchange.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0009_learning_sequences.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0010_delayed_retest.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0011_teaching_next_steps.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0012_trial_records.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0013_family_usability_feedback.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0014_trial_batches.sql'").get());
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0015_family_feedback_followups.sql'").get());
    assert.deepEqual({ ...db.prepare("SELECT response_id,followup_outcome FROM family_usability_feedback WHERE id='legacy-feedback'").get() }, { response_id: null, followup_outcome: null });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM family_feedback_responses").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM learning_trial_batches").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM family_usability_feedback").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM learning_trial_records").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM learning_sequence_decisions").get().count, 0);
    assert.deepEqual({ ...db.prepare("SELECT title,retest_prompt,retest_context,retest_available_at,retest_reference_id FROM learning_sequences WHERE id='legacy-sequence'").get() }, { title: "旧任务组", retest_prompt: "", retest_context: "", retest_available_at: null, retest_reference_id: null });
    assert.deepEqual({ ...db.prepare("SELECT score,sequence_id,sequence_stage,sequence_snapshot_json FROM submissions WHERE id='legacy-exchange'").get() }, { score: 81, sequence_id: null, sequence_stage: null, sequence_snapshot_json: "{}" });
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('submissions') WHERE name='diagnostic_snapshot_json'").get());
    db.exec("ALTER TABLE learning_sequence_decisions RENAME COLUMN remaining TO incomplete_remaining; DELETE FROM d1_migrations WHERE name='0011_teaching_next_steps.sql'");
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.equal(db.prepare("SELECT name FROM d1_migrations WHERE name='0011_teaching_next_steps.sql'").get(), undefined, "incomplete structures must not be registered as applied migrations");
    db.exec("ALTER TABLE learning_trial_records RENAME COLUMN void_reason TO incomplete_void_reason; DELETE FROM d1_migrations WHERE name='0012_trial_records.sql'");
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.equal(db.prepare("SELECT name FROM d1_migrations WHERE name='0012_trial_records.sql'").get(), undefined);
    db.exec("ALTER TABLE family_usability_feedback RENAME COLUMN operation_help TO incomplete_operation_help; DELETE FROM d1_migrations WHERE name='0013_family_usability_feedback.sql'");
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.equal(db.prepare("SELECT name FROM d1_migrations WHERE name='0013_family_usability_feedback.sql'").get(), undefined);
    db.exec("ALTER TABLE learning_trial_batches RENAME COLUMN scope_json TO incomplete_scope_json; DELETE FROM d1_migrations WHERE name='0014_trial_batches.sql'");
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.equal(db.prepare("SELECT name FROM d1_migrations WHERE name='0014_trial_batches.sql'").get(), undefined);
    db.exec("ALTER TABLE family_feedback_responses RENAME COLUMN detail TO incomplete_detail; DELETE FROM d1_migrations WHERE name='0015_family_feedback_followups.sql'");
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.equal(db.prepare("SELECT name FROM d1_migrations WHERE name='0015_family_feedback_followups.sql'").get(), undefined);
  } finally { db.close(); }
  const runtimeDb = new api.NodeSqliteDatabase("file::memory:");
  try { await api.ensurePlatformSchema(runtimeDb); await api.ensurePlatformSchema(runtimeDb); } finally { runtimeDb.close(); }
});
