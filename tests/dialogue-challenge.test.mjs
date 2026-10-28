import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { dialogueTemplates, matchedDialogueExpression } from './lib/dialogue-types';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createSessionToken } from './lib/auth-token';
    export { createApiApp } from './server/app';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: {} });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  const people = { teacher: "teacher", colleague: "teacher", admin: "admin", student: "student", peer: "student", outsider: "student", foreign: "student", guardian: "guardian", temporary: "student" };
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','对话学校'),('other-school','其他学校')"),
    ...Object.keys(people).map((id) => db.prepare("INSERT INTO users(id,email,display_name,must_change_password) VALUES (?,?,?,?)").bind(id, `${id}@dialogue.test`, id, id === "temporary" ? 1 : 0)),
    ...Object.entries(people).map(([id, role]) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,?)").bind(id === "foreign" ? "other-school" : "school", id, role)),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','中文一班','A2','teacher','2026'),('other-class','school','中文二班','A2','colleague','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student'),('school','other-class','peer')"),
  ]);
  const secret = await api.ensureSiteJwtSecret(db);
  const tokens = Object.fromEntries(await Promise.all(Object.keys(people).map(async (id) => [id, await api.createSessionToken({ email: `${id}@dialogue.test`, displayName: id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, sessionVersion: 0 }, secret)])));
  const app = api.createApiApp();
  const request = async (person, body, expected = 200, query = "", method = body ? "POST" : "GET") => {
    const response = await app.fetch(new Request(`http://127.0.0.1/api/v1/dialogue${query}`, { method,
      headers: { ...(person ? { authorization: `Bearer ${tokens[person]}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }));
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data));
    if (response.ok) assert.equal(response.headers.get("cache-control"), "private, no-store");
    return data;
  };
  const scenario = { action: "publish", id: crypto.randomUUID(), revision: 0, classId: "class", ...structuredClone(api.dialogueTemplates[0]) };
  const publish = async (patch = {}) => request("teacher", { ...scenario, ...patch });
  const start = async (scenarioId = scenario.id, id = crypto.randomUUID()) => (await request("student", { action: "start", id, scenarioId })).sessions.find((item) => item.id === id);
  const turn = (session, text, requestId = crypto.randomUUID()) => ({ action: "send", sessionId: session.id, revision: session.revision, requestId, text });
  const counts = async (table) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
  return { db, request, scenario, publish, start, turn, counts };
}

test("templates offer usable hints and match expressions with punctuation while leaving semantics to teachers", () => {
  assert.equal(api.dialogueTemplates.length, 3);
  for (const template of api.dialogueTemplates) for (const goal of template.content.goals) {
    assert.ok(goal.prompt && goal.response && goal.hint);
    assert.ok(api.matchedDialogueExpression(goal.hint, goal), `${template.title}: ${goal.title}`);
    assert.equal(api.matchedDialogueExpression("完全无关的句子", goal), null);
  }
  assert.equal(api.matchedDialogueExpression("你好，我 想 买 两 份 包子！", api.dialogueTemplates[0].content.goals[0]), "我想买两份包子");
});

test("dialogue routes enforce authentication roles password change and method registration", async (t) => {
  const f = await fixture(t);
  await f.request(null, undefined, 401);
  await f.request("temporary", undefined, 403);
  await f.request("guardian", undefined, 403);
  await f.request("teacher", undefined, 403);
  await f.request("admin", undefined, 403);
  await f.request("student", undefined, 403, "?view=teacher");
  await f.request("student", f.scenario, 403);
  await f.request("student", undefined, 400, "?view=invalid");
  await f.request("student", undefined, 405, "", "DELETE");
  await f.db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id='student'").run();
  await f.request("student", undefined, 403);
});

test("publication is class scoped idempotent and revision checked without trusting client ownership", async (t) => {
  const f = await fixture(t);
  await f.request("colleague", f.scenario, 403);
  await f.publish(); await f.publish();
  assert.equal(await f.counts("dialogue_scenarios"), 1);
  assert.equal(await f.counts("audit_logs"), 1);
  assert.equal((await f.request("teacher", undefined, 200, "?view=teacher")).scenarios[0].revision, 1);
  assert.equal((await f.request("colleague", undefined, 200, "?view=teacher")).scenarios.length, 0);
  assert.equal((await f.request("admin", undefined, 200, "?view=teacher")).scenarios.length, 1);
  assert.equal((await f.request("peer")).scenarios.length, 0);
  assert.equal((await f.request("foreign")).scenarios.length, 0);
  const student = await f.request("student");
  assert.deepEqual(student.scenarios[0].goals, f.scenario.content.goals.map(({ title }) => ({ title })));
  assert.equal(student.aiConfigured, false);
  await f.request("outsider", { action: "start", id: crypto.randomUUID(), scenarioId: f.scenario.id }, 409);
  await f.request("teacher", { ...f.scenario, title: "修改标题", revision: 0 }, 409);
  await f.publish({ title: "修改标题", revision: 1 });
  await f.request("teacher", { ...f.scenario, title: "过期版本", revision: 1 }, 409);
  await f.request("admin", { ...f.scenario, revision: 2, classId: "other-class" }, 409);
  await f.request("teacher", { ...f.scenario, id: crypto.randomUUID(), content: { ...f.scenario.content, goals: [{ ...f.scenario.content.goals[0], expressions: ["谢谢", "谢 谢！"] }] } }, 400);
});

test("round starts hints and turns survive retries and never write course grades", async (t) => {
  const f = await fixture(t); await f.publish();
  let session = await f.start();
  assert.deepEqual(await f.start(f.scenario.id, session.id), session);
  const hint = { action: "hint", sessionId: session.id, revision: session.revision, requestId: crypto.randomUUID() };
  session = (await f.request("student", hint)).sessions[0];
  assert.equal(session.hintCount, 1); assert.equal(session.step, 0);
  assert.deepEqual((await f.request("student", hint)).sessions[0], session);
  const unmatched = f.turn(session, "今天天气很好");
  session = (await f.request("student", unmatched)).sessions[0];
  assert.equal(session.step, 0); assert.equal(session.turns.at(-1).text, f.scenario.content.goals[0].prompt);
  const first = f.turn(session, "你好，我想买两份包子。一共多少钱？谢谢！");
  session = (await f.request("student", first)).sessions[0];
  assert.equal(session.step, 1);
  assert.equal(session.turns.at(-2).matchedExpression, "我想买两份包子");
  assert.deepEqual((await f.request("student", first)).sessions[0], session);
  await f.request("student", { ...first, text: "修改过的发言" }, 409);
  await f.request("student", { ...hint, requestId: first.requestId }, 409);
  await f.request("student", f.turn({ ...session, revision: 1 }, "一共多少钱"), 409);
  session = (await f.request("student", f.turn(session, "请问，一共多少钱？"))).sessions[0];
  session = (await f.request("student", f.turn(session, "好的，谢谢你！"))).sessions[0];
  assert.equal(session.complete, true); assert.equal(session.hintCount, 1); assert.equal(session.step, 3);
  assert.deepEqual((await f.request("student")).sessions[0], session);
  await f.request("student", f.turn(session, "谢谢"), 400);
  await f.request("peer", f.turn(session, "一共多少钱"), 404);
  await f.request("foreign", f.turn(session, "一共多少钱"), 404);
  const review = await f.request("teacher", undefined, 200, "?view=teacher");
  assert.deepEqual(review.sessions[0].turns, session.turns);
  assert.equal((await f.request("colleague", undefined, 200, "?view=teacher")).sessions.length, 0);
  assert.equal(await f.counts("submissions"), 0); assert.equal(await f.counts("mastery_snapshots"), 0); assert.equal(await f.counts("submission_reviews"), 0);
  const fresh = await f.start(); assert.notEqual(fresh.id, session.id); assert.equal(fresh.step, 0); assert.equal(fresh.hintCount, 0);
});

test("teacher edits preserve started snapshots and archive or unenrollment stops further turns", async (t) => {
  const f = await fixture(t); await f.publish();
  const old = await f.start();
  await f.publish({ revision: 1, content: { ...f.scenario.content, opening: "新开场", brief: "新版要求", goals: [{ ...f.scenario.content.goals[0], response: "新版回复" }] } });
  const latest = await f.start();
  assert.equal(latest.scenario.revision, 2); assert.equal(old.scenario.revision, 1);
  const continued = (await f.request("student", f.turn(old, "我要两份包子"))).sessions.find((item) => item.id === old.id);
  assert.equal(continued.scenario.goals.length, 3);
  assert.equal(continued.turns.at(-1).text, f.scenario.content.goals[0].response);
  await f.request("colleague", { action: "archive", id: f.scenario.id, revision: 2 }, 404);
  await f.request("teacher", { action: "archive", id: f.scenario.id, revision: 1 }, 409);
  await f.request("teacher", { action: "archive", id: f.scenario.id, revision: 2 });
  await f.request("teacher", { action: "archive", id: f.scenario.id, revision: 2 });
  await f.request("student", f.turn(continued, "一共多少钱"), 409);
  const history = await f.request("student");
  assert.equal(history.scenarios.length, 0); assert.equal(history.sessions.length, 2); assert.equal(history.sessions[0].canContinue, false);
  await f.publish({ revision: 3 });
  await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE student_user_id='student'").run();
  await f.request("student", f.turn(continued, "一共多少钱"), 409);
  await f.request("student", { action: "start", id: crypto.randomUUID(), scenarioId: f.scenario.id }, 409);
  assert.equal((await f.request("student")).sessions.length, 2);
});

test("turn limits bound repeated practice while allowing a separate fresh round", async (t) => {
  const f = await fixture(t); await f.publish();
  let session = await f.start();
  for (let attempt = 0; attempt < 20; attempt++) session = (await f.request("student", f.turn(session, "你好"))).sessions[0];
  assert.equal(session.step, 0);
  const count = session.turns.length;
  const limited = await f.request("student", f.turn(session, "你好"), 400);
  assert.equal(limited.error, "invalid_dialogue_turn_limit");
  assert.equal((await f.request("student")).sessions[0].turns.length, count);
  assert.equal((await f.start()).turns.length, 1);
});

test("publication and transcript changes roll back with audit failures and release pending leases", async (t) => {
  const f = await fixture(t);
  await f.db.prepare("CREATE TRIGGER reject_publish BEFORE INSERT ON audit_logs WHEN NEW.action='dialogue.published' BEGIN SELECT RAISE(ABORT,'fixture_dialogue_audit_failure'); END").run();
  await f.request("teacher", f.scenario, 500);
  assert.equal(await f.counts("dialogue_scenarios"), 0);
  await f.db.prepare("DROP TRIGGER reject_publish").run(); await f.publish();
  let session = await f.start();
  for (const [action, name] of [["send", "dialogue.turn"], ["hint", "dialogue.hint"]]) {
    await f.db.prepare(`CREATE TRIGGER reject_turn BEFORE INSERT ON audit_logs WHEN NEW.action='${name}' BEGIN SELECT RAISE(ABORT,'fixture_dialogue_audit_failure'); END`).run();
    const body = { ...f.turn(session, "我要两份包子"), action };
    await f.request("student", body, 500);
    assert.deepEqual((await f.request("student")).sessions[0], session);
    await f.db.prepare("DROP TRIGGER reject_turn").run();
    session = (await f.request("student", body)).sessions[0];
  }
});

async function enableAi(f) {
  await f.db.prepare("INSERT INTO app_settings(key,value) VALUES ('openai_api_key','fixture-only-not-a-real-key'),('ai_model','configured-fixture-model')").run();
  await f.publish({ revision: 0, content: { ...f.scenario.content, aiEnabled: true } });
}
function aiResponse() { return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "好的，两份包子。你还想了解什么？[1]" }] }], usage: { input_tokens: 30, output_tokens: 15 } }); }

test("optional Responses calls use configured model no storage and one lease across concurrent retries", async (t) => {
  const f = await fixture(t); await enableAi(f);
  const entered = Promise.withResolvers(); const release = Promise.withResolvers(); let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses");
    const input = JSON.parse(options.body); assert.equal(input.model, "configured-fixture-model"); assert.equal(input.store, false); assert.ok(options.signal);
    assert.ok(input.input[1].content.includes("我想买两份包子"));
    entered.resolve(); await release.promise; return aiResponse();
  });
  const session = await f.start(); const body = f.turn(session, "我想买两份包子");
  const first = f.request("student", body); await entered.promise;
  assert.equal((await f.request("student")).sessions[0].pending, true);
  await f.request("student", body, 409);
  await f.request("student", { ...body, text: "不同内容" }, 409);
  await f.request("student", { ...body, action: "hint", requestId: crypto.randomUUID() }, 409);
  release.resolve(); const receipt = await first;
  assert.equal(receipt.sessions[0].turns.at(-1).provider, "openai");
  assert.equal(receipt.sessions[0].turns.at(-1).model, "configured-fixture-model");
  assert.deepEqual(await f.request("student", body), receipt); assert.equal(calls, 1);
  assert.equal(await f.counts("ai_sessions"), 1);
  const usage = await f.db.prepare("SELECT purpose,input_tokens,output_tokens FROM ai_sessions").first();
  assert.deepEqual(usage, { purpose: "dialogue", input_tokens: 30, output_tokens: 15 });
});

test("missing or failing AI falls back to the teacher script with truthful provenance", async (t) => {
  const f = await fixture(t); await f.publish({ content: { ...f.scenario.content, aiEnabled: true } });
  let session = await f.start();
  session = (await f.request("student", f.turn(session, "我要两份包子"))).sessions[0];
  assert.equal(session.turns.at(-1).provider, "fallback");
  assert.equal(session.turns.at(-1).text, f.scenario.content.goals[0].response);
  await f.db.prepare("INSERT INTO app_settings(key,value) VALUES ('ai_api_key','fixture-only-key')").run();
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  session = (await f.request("student", f.turn(session, "一共多少钱"))).sessions[0];
  assert.equal(session.turns.at(-1).provider, "fallback");
  assert.equal(session.turns.at(-1).text, f.scenario.content.goals[1].response);
  assert.equal(await f.counts("ai_sessions"), 0);
});

test("revoking enrollment while AI is running prevents transcript and usage commits", async (t) => {
  const f = await fixture(t); await enableAi(f);
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  t.mock.method(globalThis, "fetch", async () => { entered.resolve(); await release.promise; return aiResponse(); });
  const session = await f.start(); const first = f.request("student", f.turn(session, "我要两份包子"), 409);
  await entered.promise;
  await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE student_user_id='student'").run();
  release.resolve(); await first;
  const actual = (await f.request("student")).sessions[0];
  assert.equal(actual.turns.length, 1); assert.equal(actual.pending, false); assert.equal(actual.canContinue, false);
  assert.equal(await f.counts("ai_sessions"), 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='dialogue.turn'").first()).count, 0);
});

test("late lease owners cannot clear or overwrite a newer retry of the same request", async (t) => {
  const f = await fixture(t); await enableAi(f);
  const entered = [Promise.withResolvers(), Promise.withResolvers()]; const releases = [Promise.withResolvers(), Promise.withResolvers()]; let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { const index = calls++; entered[index].resolve(); await releases[index].promise; return aiResponse(); });
  const session = await f.start(); const body = f.turn(session, "我要两份包子");
  const first = f.request("student", body, 409); await entered[0].promise;
  await f.db.prepare("UPDATE dialogue_sessions SET pending_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(session.id).run();
  await f.request("student", { ...body, text: "相同 ID 的不同内容" }, 409);
  const second = f.request("student", body); await entered[1].promise;
  releases[0].resolve(); await first;
  assert.equal((await f.request("student")).sessions[0].pending, true);
  releases[1].resolve(); const result = (await second).sessions[0];
  assert.equal(result.pending, false); assert.equal(result.turns.length, 3); assert.equal(result.step, 1);
  assert.equal(await f.counts("ai_sessions"), 1);
});
