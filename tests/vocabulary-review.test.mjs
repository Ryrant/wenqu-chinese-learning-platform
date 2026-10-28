import assert from "node:assert/strict";
import test from "node:test";
import { api, practiceFixture } from "./helpers/practice-fixture.mjs";

async function words(f, count = 5) {
  for (const word of api.readingLessons[0].focusWords.slice(0, count)) await f.request("student", "/reading/vocabulary", { action: "save", lessonId: "park-morning", word });
}
const current = (data, id) => data.recent.find((item) => item.id === id) ?? data.active;
async function start(f, mode = "due", id = crypto.randomUUID()) { return (await f.request("student", "/vocabulary-review", { action: "start", id, mode })).active; }
async function answer(f, session, correct = true, requestId = crypto.randomUUID(), expected = 200) {
  const row = await f.db.prepare("SELECT snapshot_json FROM vocabulary_review_sessions WHERE id=?").bind(session.id).first();
  const item = JSON.parse(row.snapshot_json).find((item) => item.vocabularyId === session.question.vocabularyId);
  const body = { action: "answer", sessionId: session.id, requestId, revision: session.revision, selectedOption: correct ? item.answerIndex : (item.answerIndex + 1) % item.options.length };
  return { data: await f.request("student", "/vocabulary-review", body, expected), body, item };
}

test("vocabulary review is protected and only uses the student's saved words", async (t) => {
  const f = await practiceFixture(t);
  await f.request(null, "/vocabulary-review", undefined, 401);
  for (const person of ["teacher", "guardian", "temporary", "admin"]) await f.request(person, "/vocabulary-review", undefined, 403);
  await f.request("student", "/vocabulary-review", undefined, 405, "DELETE");
  await f.request("student", "/vocabulary-review", { action: "start", id: crypto.randomUUID(), mode: "due" }, 409);
  await words(f, 2); const session = await start(f);
  assert.equal(session.total, 2); assert.equal("answerIndex" in session.question, false);
  assert.equal((await f.request("peer", "/vocabulary-review")).totalWords, 0);
  assert.equal((await f.request("foreign", "/vocabulary-review")).recent.length, 0);
  await f.request("peer", "/vocabulary-review", { action: "answer", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0, selectedOption: 0 }, 404);
});

test("one active round is resumed across starts and concurrent retry", async (t) => {
  const f = await practiceFixture(t); await words(f);
  const id = crypto.randomUUID(); const body = { action: "start", id, mode: "due" };
  const [first, second] = await Promise.all([f.request("student", "/vocabulary-review", body), f.request("student", "/vocabulary-review", body)]);
  assert.equal(first.active.id, second.active.id); assert.equal(await f.count("vocabulary_review_sessions"), 1);
  assert.equal((await start(f, "free")).id, id);
  await f.request("student", "/vocabulary-review", { ...body, mode: "free" }, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='vocabulary_review.started'").first()).count, 1);
});

test("meaning and cloze answers requeue wrong words and schedule from first attempts", async (t) => {
  const f = await practiceFixture(t); await words(f);
  let session = await start(f); const id = session.id; const kinds = new Set([session.question.kind]);
  const wrong = await answer(f, session, false); session = current(wrong.data, id);
  assert.equal(session.feedback.correct, false); assert.equal(session.remaining, 5); assert.ok(session.feedback.nextDueAt);
  const originalDue = session.feedback.nextDueAt;
  const initialWordId = wrong.item.vocabularyId;
  while (!session.complete) {
    kinds.add(session.question.kind); const result = await answer(f, session); session = current(result.data, id);
    assert.ok(session.attemptCount <= 15);
  }
  assert.deepEqual([...kinds].sort(), ["cloze", "meaning"]);
  assert.equal(session.firstCorrect, 4); assert.equal(session.attemptCount, 6);
  const plan = await f.db.prepare("SELECT stage,due_at FROM vocabulary_review_state WHERE vocabulary_id=?").bind(initialWordId).first();
  assert.equal(plan.stage, 0); assert.equal(plan.due_at, originalDue);
  const catalog = await f.request("student", "/vocabulary-review"); assert.equal(catalog.dueCount, 0); assert.equal(catalog.active, null); assert.ok(catalog.nextDueAt > new Date().toISOString());
  assert.equal(await f.count("submissions"), 0); assert.equal(await f.count("mastery_snapshots"), 0);
});

test("concurrent starts with the same ID and different modes reject the changed request", async (t) => {
  const f = await practiceFixture(t); await words(f, 2); const id = crypto.randomUUID();
  const results = await Promise.allSettled(["due", "free"].map((mode) => f.request("student", "/vocabulary-review", { action: "start", id, mode })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected"); assert.match(rejected.reason.message, /vocabulary_review_conflict/);
  assert.equal(await f.count("vocabulary_review_sessions"), 1);
});

test("duplicate answer retries acknowledge one attempt and reject changed payloads", async (t) => {
  const f = await practiceFixture(t); await words(f, 1); const session = await start(f);
  const row = await f.db.prepare("SELECT snapshot_json FROM vocabulary_review_sessions WHERE id=?").bind(session.id).first();
  const item = JSON.parse(row.snapshot_json)[0];
  const body = { action: "answer", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0, selectedOption: item.answerIndex };
  const [first, second] = await Promise.all([f.request("student", "/vocabulary-review", body), f.request("student", "/vocabulary-review", body)]);
  assert.deepEqual(second, first); assert.equal(first.recent[0].attemptCount, 1);
  await f.request("student", "/vocabulary-review", { ...body, selectedOption: (item.answerIndex + 1) % item.options.length }, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='vocabulary_review.answered'").first()).count, 1);
  assert.equal(await f.count("vocabulary_review_state"), 1);
});

test("wrong-word loops are bounded and free practice leaves future plans unchanged", async (t) => {
  const f = await practiceFixture(t); await words(f, 1);
  let session = await start(f); const id = session.id;
  while (!session.complete) session = current((await answer(f, session, false)).data, id);
  assert.equal(session.attemptCount, 3); assert.equal(session.firstCorrect, 0);
  const before = (await f.db.prepare("SELECT * FROM vocabulary_review_state").all()).results;
  session = await start(f, "free"); const freeId = session.id;
  while (!session.complete) session = current((await answer(f, session)).data, freeId);
  assert.deepEqual((await f.db.prepare("SELECT * FROM vocabulary_review_state").all()).results, before);
});

test("finishing keeps incomplete words due and removing words prevents new scheduling", async (t) => {
  const f = await practiceFixture(t); await words(f, 2); let session = await start(f);
  const body = { action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0 };
  const finished = await f.request("student", "/vocabulary-review", body);
  assert.deepEqual(await f.request("student", "/vocabulary-review", body), finished); assert.equal(finished.dueCount, 2);
  session = await start(f);
  const vocabularyId = session.question.vocabularyId;
  await f.request("student", "/reading/vocabulary", { action: "remove", id: vocabularyId });
  const answerResult = await answer(f, session); assert.equal(current(answerResult.data, session.id).feedback.nextDueAt, null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM vocabulary_review_state WHERE vocabulary_id=?").bind(vocabularyId).first()).count, 0);
});

test("answer and scheduling roll back together when the audit cannot commit", async (t) => {
  const f = await practiceFixture(t); await words(f, 1); const session = await start(f);
  await f.db.prepare("CREATE TRIGGER reject_vocabulary BEFORE INSERT ON audit_logs WHEN NEW.action='vocabulary_review.answered' BEGIN SELECT RAISE(ABORT,'fixture_vocabulary_audit_failure'); END").run();
  await answer(f, session, true, crypto.randomUUID(), 500);
  const unchanged = await f.request("student", "/vocabulary-review"); assert.equal(unchanged.active.revision, 0); assert.equal(unchanged.active.attemptCount, 0);
  assert.equal(await f.count("vocabulary_review_state"), 0);
  await f.db.prepare("DROP TRIGGER reject_vocabulary").run();
  await answer(f, session);
});
