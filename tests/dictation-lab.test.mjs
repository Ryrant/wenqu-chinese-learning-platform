import assert from "node:assert/strict";
import test from "node:test";
import { api, practiceFixture } from "./helpers/practice-fixture.mjs";

const selected = (data, id) => data.recent?.find((item) => item.id === id) ?? data.active;
async function open(f, patch = {}, expected = 200) { const body = { action: "start", id: crypto.randomUUID(), kind: "words", lessonId: "park-morning", sourceRevision: 0, ...patch }; const data = await f.request("student", "/dictation", body, expected); return { data, body, session: data.active }; }
async function answer(f, session, value = session.question.speechText, patch = {}, expected = 200) { const body = { action: "answer", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision, answer: value, playCount: 1, ...patch }; const data = await f.request("student", "/dictation", body, expected); return { body, data, session: selected(data, session.id) }; }
function teacherLesson() { const { title, level, sentences, terms, focusWords } = structuredClone(api.readingLessons[0]); return { action: "publish", id: crypto.randomUUID(), revision: 0, classId: "class", title: `${title}听写版`, level, sentences, terms, focusWords }; }

test("dictation comparison identifies missing extra and substituted Unicode characters", () => {
  assert.equal(api.compareDictation("我在公园看书。", " 我 在 公园看书！").correct, true);
  assert.equal(api.compareDictation("ＡＩ１２", "ai12").correct, true);
  assert.deepEqual(api.compareDictation("我在公园", "我公园").differences.filter((item) => item.kind !== "same"), [{ kind: "missing", expected: "在", actual: "" }]);
  assert.deepEqual(api.compareDictation("公园", "公园里").differences.filter((item) => item.kind !== "same"), [{ kind: "extra", expected: "", actual: "里" }]);
  assert.deepEqual(api.compareDictation("公园", "公圆").differences.filter((item) => item.kind !== "same"), [{ kind: "different", expected: "园", actual: "圆" }]);
  assert.equal(api.compareDictation("𠮷日", "𠮷日").differences.length, 2);
});

test("dictation routes enforce authentication roles method and owner isolation", async (t) => {
  const f = await practiceFixture(t);
  await f.request(null, "/dictation", undefined, 401);
  for (const person of ["teacher", "guardian", "temporary", "admin"]) await f.request(person, "/dictation", undefined, 403);
  await f.request("student", "/dictation", undefined, 405, "DELETE");
  await open(f, { kind: "vocabulary" }, 409);
  const { session } = await open(f);
  const body = { action: "answer", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0, answer: "公园", playCount: 1 };
  await f.request("peer", "/dictation", body, 404); await f.request("foreign", "/dictation", body, 404);
  assert.equal((await f.request("peer", "/dictation")).recent.length, 0);
  const catalog = await f.request("student", "/dictation"); assert.equal("sentences" in catalog.lessons[0], false);
});

test("starts keep one active round and reject another intent without acknowledging an unbound ID", async (t) => {
  const f = await practiceFixture(t); const body = { action: "start", id: crypto.randomUUID(), kind: "words", lessonId: "park-morning", sourceRevision: 0 };
  const [first, second] = await Promise.all([f.request("student", "/dictation", body), f.request("student", "/dictation", body)]);
  assert.deepEqual(second, first); assert.equal(first.active.total, 5); assert.equal(await f.count("dictation_sessions"), 1);
  await f.request("student", "/dictation", { ...body, kind: "sentences" }, 409);
  await open(f, { kind: "sentences" }, 409);
  assert.equal((await f.request("student", "/dictation")).active.id, first.active.id);
  assert.equal(await f.count("dictation_sessions"), 1);
  const finished = { action: "finish", sessionId: first.active.id, requestId: crypto.randomUUID(), revision: 0 };
  await f.request("student", "/dictation", finished); await f.request("student", "/dictation", finished);
  const id = crypto.randomUUID();
  const results = await Promise.allSettled(["words", "sentences"].map((kind) => f.request("student", "/dictation", { ...body, id, kind })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /dictation_conflict/);
});

test("answers persist truthful differences and duplicate retries commit one operation", async (t) => {
  const f = await practiceFixture(t); const { session } = await open(f);
  const body = { action: "answer", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0, answer: `${session.question.speechText}错`, playCount: 2, correct: true };
  const [first, second] = await Promise.all([f.request("student", "/dictation", body), f.request("student", "/dictation", body)]);
  assert.deepEqual(first, second); const updated = first.active;
  assert.equal(updated.index, 1); assert.equal(updated.answers.length, 1); assert.equal(updated.answers[0].correct, false);
  assert.ok(updated.answers[0].differences.some((item) => item.kind === "extra" && item.actual === "错"));
  assert.equal(updated.answers[0].playCount, 2);
  await f.request("student", "/dictation", { ...body, answer: "不同输入" }, 409);
  await f.request("student", "/dictation", { ...body, requestId: crypto.randomUUID() }, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='dictation.answer'").first()).count, 1);
  assert.equal(await f.count("submissions"), 0); assert.equal(await f.count("mastery_snapshots"), 0);
});

test("reference-assisted practice is explicitly marked and audio-free submissions need it", async (t) => {
  const f = await practiceFixture(t); let { session } = await open(f);
  await answer(f, session, session.question.speechText, { playCount: 0 }, 400);
  const hint = { action: "hint", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0 };
  const first = await f.request("student", "/dictation", hint); assert.deepEqual(await f.request("student", "/dictation", hint), first);
  session = first.active; assert.equal(session.question.referenceVisible, true);
  const result = await answer(f, session, session.question.speechText, { playCount: 0 });
  assert.equal(result.session.answers[0].correct, true); assert.equal(result.session.answers[0].usedReference, true); assert.equal(result.session.answers[0].playCount, 0);
});

test("completed rounds create separate wrong-item retries without changing original answers", async (t) => {
  const f = await practiceFixture(t); let { session } = await open(f); const originalId = session.id;
  const wrongText = `错${session.question.speechText.slice(1)}`;
  session = (await answer(f, session, wrongText)).session;
  while (!session.complete) session = (await answer(f, session)).session;
  const before = structuredClone(session.answers); assert.equal(before.filter((item) => !item.correct).length, 1);
  const body = { action: "retry", id: crypto.randomUUID(), sessionId: originalId };
  let retried = (await f.request("student", "/dictation", body)).active;
  assert.equal(retried.total, 1); assert.notEqual(retried.id, originalId); assert.ok(retried.sourceTitle.startsWith("错项重练"));
  retried = (await answer(f, retried)).session; assert.equal(retried.complete, true); assert.equal(retried.answers[0].correct, true);
  assert.deepEqual((await f.request("student", `/dictation?sessionId=${originalId}`)).recent.find((item) => item.id === originalId).answers, before);
  await f.request("student", "/dictation", { action: "retry", id: crypto.randomUUID(), sessionId: retried.id }, 409);
});

test("teacher readings keep round snapshots but withdrawal prevents new material or answers", async (t) => {
  const f = await practiceFixture(t); const body = teacherLesson(); await f.request("teacher", "/reading/lessons", body);
  let { session } = await open(f, { kind: "sentences", lessonId: body.id, sourceRevision: 1 });
  const firstText = session.question.speechText;
  await f.request("teacher", "/reading/lessons", { ...body, revision: 1, title: "后续版本" });
  session = (await answer(f, session)).session; assert.equal(session.answers[0].expected, firstText);
  await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE student_user_id='student'").run();
  const revoked = (await f.request("student", "/dictation")).active; assert.equal(revoked.available, false); assert.equal(revoked.question, null);
  await answer(f, session, session.question.speechText, {}, 409);
  await f.request("student", "/dictation", { action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision });
  assert.equal((await f.request("student", "/dictation")).active, null);
  await open(f, { kind: "words", lessonId: body.id, sourceRevision: 2 }, 409);
});

test("source archival between resolution and allocation cannot create a new dictation round", async (t) => {
  const f = await practiceFixture(t); const body = teacherLesson(); await f.request("teacher", "/reading/lessons", body);
  const batch = f.db.batch.bind(f.db); let intercept = true;
  f.db.batch = async (statements) => { if (intercept) { intercept = false; await f.db.prepare("UPDATE teacher_reading_lessons SET status='archived',revision=revision+1 WHERE id=?").bind(body.id).run(); } return batch(statements); };
  await open(f, { kind: "words", lessonId: body.id, sourceRevision: 1 }, 409);
  assert.equal(await f.count("dictation_sessions"), 0);
});

test("audit failures roll back hints and answers with the complete session state", async (t) => {
  const f = await practiceFixture(t); const { session } = await open(f);
  for (const action of ["hint", "answer"]) {
    await f.db.prepare(`CREATE TRIGGER reject_dictation BEFORE INSERT ON audit_logs WHEN NEW.action='dictation.${action}' BEGIN SELECT RAISE(ABORT,'fixture_dictation_audit_failure'); END`).run();
    const body = { action, sessionId: session.id, requestId: crypto.randomUUID(), revision: 0, answer: session.question.speechText, playCount: 1 };
    await f.request("student", "/dictation", body, 500);
    const unchanged = (await f.request("student", "/dictation")).active; assert.equal(unchanged.revision, 0); assert.equal(unchanged.answers.length, 0); assert.equal(unchanged.question.referenceVisible, false);
    await f.db.prepare("DROP TRIGGER reject_dictation").run();
  }
  await answer(f, session);
});
