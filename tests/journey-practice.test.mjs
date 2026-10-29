import assert from "node:assert/strict";
import test from "node:test";
import { practiceFixture } from "./helpers/practice-fixture.mjs";

test("practice and journeys enforce login role password and tenant boundaries", async (t) => {
  const f = await practiceFixture(t);
  for (const path of ["/practice", "/journeys"]) {
    await f.request(null, path, undefined, 401);
    for (const person of ["teacher", "guardian", "temporary", "admin"]) await f.request(person, path, undefined, 403);
    await f.request("student", path, undefined, 405, "DELETE");
  }
  await f.publish(); const run = await f.start();
  assert.equal((await f.request("peer", "/journeys")).journeys.length, 0);
  assert.equal((await f.request("foreign", "/journeys")).journeys.length, 0);
  await f.request("peer", "/practice", f.reading(run), 404);
  await f.request("foreign", "/practice", f.writing(run), 404);
  await f.request("peer", `/practice?journeyRunId=${run.id}`, undefined, 404);
});

test("teacher journey definitions validate available reading characters and publication scope", async (t) => {
  const f = await practiceFixture(t);
  await f.publish({ content: { ...f.scenario.content, journey: { lessonId: "missing", characters: ["人"] } } }, 400);
  await f.publish({ content: { ...f.scenario.content, journey: { lessonId: "park-morning", characters: ["字"] } } }, 400);
  await f.publish({ content: { ...f.scenario.content, journey: { lessonId: "park-morning", characters: [] } } }, 400);
  await f.request("colleague", "/dialogue", f.scenario, 403);
  await f.publish();
  const catalog = await f.request("student", "/journeys");
  assert.equal(catalog.journeys.length, 1); assert.deepEqual(catalog.journeys[0].characters, ["人", "天"]);
  assert.equal(JSON.stringify(catalog).includes("expressions"), false);
});

test("expanded reading characters can be assigned to a journey and saved through its writing gate", async (t) => {
  const f = await practiceFixture(t);
  await f.publish({ content: { ...f.scenario.content, journey: { lessonId: "park-morning", characters: ["树", "公"] } } });
  const run = await f.start(); assert.deepEqual(run.characters, ["树", "公"]);
  await f.request("student", "/practice", f.reading(run));
  for (const character of run.characters) await f.request("student", "/practice", f.writing(run, character));
  const saved = (await f.request("student", "/journeys")).runs[0];
  assert.equal(saved.stage, 2);
  assert.deepEqual(saved.records.filter((record) => record.kind === "writing").map((record) => record.referenceId).sort(), ["公", "树"]);
});

test("journey starts are retry safe snapshots and allocate one bound dialogue round", async (t) => {
  const f = await practiceFixture(t); await f.publish(); const run = await f.start();
  assert.deepEqual(await f.start(run.id), run);
  assert.equal(await f.count("journey_runs"), 1); assert.equal(await f.count("dialogue_sessions"), 1);
  await f.publish({ revision: 1, title: "修改后的主题", content: { ...f.scenario.content, journey: { lessonId: "birthday-card", characters: ["日"] } } });
  const original = (await f.request("student", `/journeys?runId=${run.id}`)).runs[0];
  assert.equal(original.title, run.title); assert.equal(original.lesson.id, "park-morning"); assert.deepEqual(original.characters, ["人", "天"]);
  assert.equal((await f.start()).lesson.id, "birthday-card");
});

test("three gates advance from saved reading and every required character to bound dialogue", async (t) => {
  const f = await practiceFixture(t); await f.publish(); const run = await f.start();
  await f.request("student", "/practice", f.writing(run), 409);
  const dialogue = (await f.request("student", "/dialogue")).sessions[0];
  assert.equal(dialogue.canContinue, false); assert.equal(dialogue.journeyLocked, true);
  await f.request("student", "/dialogue", { action: "send", sessionId: run.dialogueSessionId, requestId: crypto.randomUUID(), revision: 1, text: "我要两份包子" }, 409);
  const reading = await f.request("student", "/practice", f.reading(run));
  assert.equal(reading.record.result.correct, 3);
  assert.equal((await f.request("student", "/journeys")).runs[0].stage, 1);
  await f.request("student", "/practice", f.writing(run));
  assert.equal((await f.request("student", "/journeys")).runs[0].stage, 1);
  await f.request("student", "/practice", f.writing(run, "月"), 400);
  await f.request("student", "/practice", f.writing(run, "天"));
  assert.equal((await f.request("student", "/journeys")).runs[0].stage, 2);
  for (const [index, text] of ["我要两份包子", "一共多少钱", "谢谢"].entries()) await f.request("student", "/dialogue", { action: "send", sessionId: run.dialogueSessionId, requestId: crypto.randomUUID(), revision: index + 1, text });
  const completed = (await f.request("student", "/journeys")).runs[0];
  assert.equal(completed.stage, 3); assert.equal(completed.dialogue.steps, 3); assert.equal(completed.records.length, 3);
  assert.equal(await f.count("submissions"), 0); assert.equal(await f.count("mastery_snapshots"), 0);
});

test("practice records persist truthful grading and retries without cross-owner histories", async (t) => {
  const f = await practiceFixture(t);
  const body = f.reading(); body.answers[0].meaning = body.answers[1].meaning; body.correct = 3;
  const first = await f.request("student", "/practice", body); assert.equal(first.record.result.correct, 2);
  assert.deepEqual(await f.request("student", "/practice", body), first);
  await f.request("student", "/practice", { ...body, answers: f.reading().answers }, 409);
  const written = f.writing(); await f.request("student", "/practice", written); await f.request("student", "/practice", written);
  const history = await f.request("student", "/practice"); assert.equal(history.records.length, 2); assert.deepEqual(history.writtenCharacters, ["人"]);
  assert.equal(history.records.some((item) => "payloadJson" in item), false);
  assert.equal((await f.request("peer", "/practice")).records.length, 0);
  assert.equal((await f.request("foreign", "/practice")).records.length, 0);
  await f.request("student", "/practice", { ...f.writing(), mistakes: -1 }, 400);
  await f.request("student", "/practice", { ...f.reading(), answers: [body.answers[0], body.answers[0], body.answers[0]] }, 400);
});

test("concurrent identical saves acknowledge one record and preserve progress", async (t) => {
  const f = await practiceFixture(t); await f.publish(); const run = await f.start(); const body = f.reading(run);
  const [first, second] = await Promise.all([f.request("student", "/practice", body), f.request("student", "/practice", body)]);
  assert.deepEqual(second, first); assert.equal(await f.count("practice_records"), 1);
  assert.equal((await f.request("student", "/journeys")).runs[0].stage, 1);
});

test("frequent retries of one character do not evict other gates from the learning summary", async (t) => {
  const f = await practiceFixture(t); await f.publish(); const run = await f.start();
  await f.request("student", "/practice", f.reading(run));
  await f.request("student", "/practice", f.writing(run, "天"));
  for (let index = 0; index < 51; index++) await f.request("student", "/practice", f.writing(run));
  const summary = (await f.request("student", "/journeys")).runs[0];
  assert.equal(summary.stage, 2);
  assert.ok(summary.records.some((item) => item.kind === "reading"));
  assert.deepEqual(summary.records.filter((item) => item.kind === "writing").map((item) => item.referenceId).sort(), ["人", "天"]);
});

test("archiving or revoking enrollment freezes runs while preserving owner history", async (t) => {
  const f = await practiceFixture(t); await f.publish(); const run = await f.start(); const body = f.reading(run);
  await f.request("student", "/practice", body);
  await f.request("teacher", "/dialogue", { action: "archive", id: f.scenario.id, revision: 1 });
  const catalog = await f.request("student", "/journeys"); assert.equal(catalog.journeys.length, 0); assert.equal(catalog.runs[0].available, false);
  await f.request("student", "/practice", f.writing(run), 409);
  await f.request("student", "/practice", body);
  await f.request("student", "/journeys", { action: "start", id: crypto.randomUUID(), scenarioId: f.scenario.id }, 409);
  await f.publish({ revision: 2 });
  await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE student_user_id='student'").run();
  await f.request("student", "/practice", f.writing(run), 409);
  assert.equal((await f.request("student", "/journeys")).runs[0].records.length, 1);
});

test("failed audit rolls back round allocation practice and gate advancement", async (t) => {
  const f = await practiceFixture(t); await f.publish();
  await f.db.prepare("CREATE TRIGGER reject_journey BEFORE INSERT ON audit_logs WHEN NEW.action='journey.started' BEGIN SELECT RAISE(ABORT,'fixture_practice_audit_failure'); END").run();
  await f.request("student", "/journeys", { action: "start", id: crypto.randomUUID(), scenarioId: f.scenario.id }, 500);
  assert.equal(await f.count("journey_runs"), 0); assert.equal(await f.count("dialogue_sessions"), 0);
  await f.db.prepare("DROP TRIGGER reject_journey").run(); const run = await f.start();
  await f.db.prepare("CREATE TRIGGER reject_practice BEFORE INSERT ON audit_logs WHEN NEW.action='practice.saved' BEGIN SELECT RAISE(ABORT,'fixture_practice_audit_failure'); END").run();
  await f.request("student", "/practice", f.reading(run), 500);
  assert.equal(await f.count("practice_records"), 0); assert.equal((await f.request("student", "/journeys")).runs[0].stage, 0);
});
