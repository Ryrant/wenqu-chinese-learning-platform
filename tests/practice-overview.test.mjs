import assert from "node:assert/strict";
import test from "node:test";
import { api, practiceFixture } from "./helpers/practice-fixture.mjs";

async function consent(f, status = "granted") {
  await f.db.prepare("INSERT INTO consent_records(id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,'school','student','guardian','learning_analytics',?)").bind(crypto.randomUUID(), status).run();
}
async function collect(f) { await f.request("student", "/reading/vocabulary", { action: "save", lessonId: "park-morning", sourceRevision: 0, word: "公园" }); }
async function dictation(f) { return (await f.request("student", "/dictation", { action: "start", id: crypto.randomUUID(), kind: "words", lessonId: "park-morning", sourceRevision: 0 })).active; }

test("practice overview is protected and analytics consent controls personal recommendations", async (t) => {
  const f = await practiceFixture(t);
  await f.request(null, "/practice/overview", undefined, 401);
  for (const person of ["teacher", "guardian", "admin", "temporary"]) await f.request(person, "/practice/overview", undefined, 403);
  await f.request("student", "/practice/overview", undefined, 405, "POST");
  await collect(f);
  let overview = await f.request("student", "/practice/overview");
  assert.equal(overview.available, false); assert.deepEqual(overview.nextActions, []);
  await consent(f);
  overview = await f.request("student", "/practice/overview");
  assert.equal(overview.nextActions.length, 1); assert.equal(overview.nextActions[0].practiceHref, "/student/vocabulary");
  await consent(f, "withdrawn");
  overview = await f.request("student", "/practice/overview");
  assert.equal(overview.consentStatus, "withdrawn"); assert.deepEqual(overview.nextActions, []);
  assert.equal((await f.request("student", "/reading/vocabulary")).vocabulary.length, 1);
});

test("today plan resumes the owner's saved rounds and removes unavailable class journeys", async (t) => {
  const f = await practiceFixture(t); await consent(f); await f.publish(); const journey = await f.start();
  await collect(f);
  const vocabulary = (await f.request("student", "/vocabulary-review", { action: "start", id: crypto.randomUUID(), mode: "due" })).active;
  const audio = await dictation(f);
  await f.request("peer", "/dictation", { action: "start", id: crypto.randomUUID(), kind: "sentences", lessonId: "park-morning", sourceRevision: 0 });
  const before = await f.count("audit_logs");
  const overview = await f.request("student", "/practice/overview?studentId=peer");
  assert.deepEqual(new Set(overview.nextActions.map((item) => item.practiceHref)), new Set([
    "/student/journeys?run=" + journey.id,
    "/student/vocabulary?sessionId=" + vocabulary.id,
    "/student/dictation?sessionId=" + audio.id,
  ]));
  const workspace = await f.request("student", "/workspace?include=progress");
  assert.deepEqual(new Set(workspace.learningPlan.map((item) => item.practiceHref)), new Set(overview.nextActions.map((item) => item.practiceHref)));
  const teacher = await f.request("teacher", "/workspace?include=progress&studentId=student");
  assert.equal(teacher.learningPlan.some((item) => item.kind === "practice"), false);
  assert.equal(await f.count("audit_logs"), before);
  await f.db.prepare("UPDATE dialogue_scenarios SET status='archived' WHERE id=?").bind(f.scenario.id).run();
  assert.equal((await f.request("student", "/practice/overview")).nextActions.some((item) => item.practiceHref.includes(journey.id)), false);
});

test("teacher arrangements and near deadlines precede personal continuation with at most three items", () => {
  const items = [
    { id: "retry", kind: "practice", practicePriority: "retry" },
    { id: "due", kind: "practice", practicePriority: "due" },
    { id: "resume", kind: "practice", practicePriority: "resume" },
    { id: "urgent", kind: "assignment", dueAt: "2026-10-30T00:00:00Z" },
    { id: "teacher", kind: "teacher" },
  ];
  assert.deepEqual(api.rankLearningPlan(items, new Date("2026-10-29T00:00:00Z")).map((item) => item.id), ["teacher", "urgent", "resume"]);
});

test("the latest completed dictation offers wrong items and a corrected retry clears the suggestion", async (t) => {
  const f = await practiceFixture(t); await consent(f);
  let session = await dictation(f);
  const changed = await f.request("student", "/dictation", { action: "answer", sessionId: session.id, requestId: crypto.randomUUID(), revision: 0, answer: session.question.speechText + "错", playCount: 1 });
  session = changed.active;
  await f.request("student", "/dictation", { action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision });
  let overview = await f.request("student", "/practice/overview");
  assert.equal(overview.nextActions[0].practicePriority, "retry");
  assert.equal(overview.nextActions[0].practiceHref, "/student/dictation?sessionId=" + session.id);
  const retry = (await f.request("student", "/dictation", { action: "retry", id: crypto.randomUUID(), sessionId: session.id })).active;
  await f.request("student", "/dictation", { action: "answer", sessionId: retry.id, requestId: crypto.randomUUID(), revision: 0, answer: retry.question.speechText, playCount: 1 });
  overview = await f.request("student", "/practice/overview");
  assert.equal(overview.nextActions.some((item) => item.practicePriority === "retry"), false);
});

test("ending a partially corrected retry retains the unanswered original mistake", async (t) => {
  const f = await practiceFixture(t); await consent(f);
  let original = await dictation(f);
  for (let index = 0; index < 2; index++) original = (await f.request("student", "/dictation", { action: "answer", sessionId: original.id, requestId: crypto.randomUUID(), revision: original.revision, answer: original.question.speechText + "错", playCount: 1 })).active;
  await f.request("student", "/dictation", { action: "finish", sessionId: original.id, requestId: crypto.randomUUID(), revision: original.revision });
  let retry = (await f.request("student", "/dictation", { action: "retry", id: crypto.randomUUID(), sessionId: original.id })).active;
  assert.equal(retry.total, 2);
  retry = (await f.request("student", "/dictation", { action: "answer", sessionId: retry.id, requestId: crypto.randomUUID(), revision: 0, answer: retry.question.speechText, playCount: 1 })).active;
  const remaining = retry.question.speechText;
  const ended = await f.request("student", "/dictation", { action: "finish", sessionId: retry.id, requestId: crypto.randomUUID(), revision: retry.revision });
  assert.equal(ended.recent.find((item) => item.id === retry.id).retryCount, 1);
  const plan = await f.request("student", "/practice/overview");
  assert.equal(plan.nextActions[0].practiceHref, "/student/dictation?sessionId=" + retry.id);
  const again = (await f.request("student", "/dictation", { action: "retry", id: crypto.randomUUID(), sessionId: retry.id })).active;
  assert.equal(again.total, 1); assert.equal(again.question.speechText, remaining);
  await f.request("student", "/dictation", { action: "answer", sessionId: again.id, requestId: crypto.randomUUID(), revision: 0, answer: remaining, playCount: 1 });
  assert.deepEqual((await f.request("student", "/practice/overview")).nextActions, []);
  const saved = (await f.request("student", "/dictation?sessionId=" + original.id)).recent.find((item) => item.id === original.id);
  assert.equal(saved.answers.filter((item) => !item.correct).length, 2); assert.equal(saved.retryCount, 0);
});

test("unresolved dictation mistakes remain actionable beyond the recent ten round list", async (t) => {
  const f = await practiceFixture(t); await consent(f);
  let original = await dictation(f);
  original = (await f.request("student", "/dictation", { action: "answer", sessionId: original.id, requestId: crypto.randomUUID(), revision: 0, answer: original.question.speechText + "错", playCount: 1 })).active;
  await f.request("student", "/dictation", { action: "finish", sessionId: original.id, requestId: crypto.randomUUID(), revision: original.revision });
  for (let index = 0; index < 11; index++) { const round = await dictation(f); await f.request("student", "/dictation", { action: "finish", sessionId: round.id, requestId: crypto.randomUUID(), revision: 0 }); }
  assert.equal((await f.request("student", "/practice/overview")).nextActions[0].practiceHref, "/student/dictation?sessionId=" + original.id);
});
