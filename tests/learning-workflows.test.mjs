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
  const upload = async (cookie, { id = crypto.randomUUID(), familyTaskId, bytes = new Uint8Array(512).fill(7) } = {}, status = 201) => {
    const form = new FormData();
    form.set("audio", new File([bytes], "recording.wav", { type: "audio/wav" }));
    form.set("assignmentId", assignment.id);
    form.set("submissionId", id);
    if (familyTaskId) form.set("familyTaskId", familyTaskId);
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
  return { db, act, actors, ids, tenantId, goals, assignment, text, review, upload, readAudio, workspace };
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

test("additive migration upgrades existing data and runtime initialization is repeatable", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const files = (await readdir(path.join(root, "drizzle"))).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) db.exec(await readFile(path.join(root, "drizzle", name), "utf8"));
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('submission_reviews') WHERE name='objective_scores_json'").get());
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('submissions') WHERE name='family_confirmed_at'").get());
    db.exec(await readFile(path.join(root, "scripts/baseline-d1-migrations.sql"), "utf8"));
    assert.ok(db.prepare("SELECT name FROM d1_migrations WHERE name='0006_learning_workflow_evidence.sql'").get());
  } finally { db.close(); }
  const runtimeDb = new api.NodeSqliteDatabase("file::memory:");
  try { await api.ensurePlatformSchema(runtimeDb); await api.ensurePlatformSchema(runtimeDb); } finally { runtimeDb.close(); }
});
