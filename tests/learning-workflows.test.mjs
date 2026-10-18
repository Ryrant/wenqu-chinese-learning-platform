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
    export { POST as upload } from './app/api/v1/speech/submissions/route';
    export { POST as submit } from './app/api/v1/submissions/route';
    export { GET as audio } from './app/api/v1/submissions/[id]/audio/route';
    export { GET as profile } from './app/api/v1/ability-profile/route';
    export { POST as uploadMedia } from './app/api/v1/diagnostic-media/route';
    export { GET as media } from './app/api/v1/diagnostic-media/[id]/route';
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
  const workspace = async (cookie) => {
    const response = await api.workspace(new Request("http://127.0.0.1/api/v1/workspace", { headers: { cookie } }));
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
  return { db, act, actors, ids, tenantId, goals, assignment, classroom, text, review, upload, readAudio, workspace, profile, uploadMedia, readMedia };
}

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

test("additive migration upgrades existing data and runtime initialization is repeatable", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const files = (await readdir(path.join(root, "drizzle"))).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      if (name === "0008_family_exchange.sql") db.exec(`INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,score,review_status) VALUES ('legacy-exchange','legacy-tenant','legacy-assignment','legacy-student',81,'reviewed')`);
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
    assert.deepEqual({ ...db.prepare("SELECT score,sequence_id,sequence_stage,sequence_snapshot_json FROM submissions WHERE id='legacy-exchange'").get() }, { score: 81, sequence_id: null, sequence_stage: null, sequence_snapshot_json: "{}" });
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('submissions') WHERE name='diagnostic_snapshot_json'").get());
  } finally { db.close(); }
  const runtimeDb = new api.NodeSqliteDatabase("file::memory:");
  try { await api.ensurePlatformSchema(runtimeDb); await api.ensurePlatformSchema(runtimeDb); } finally { runtimeDb.close(); }
});
