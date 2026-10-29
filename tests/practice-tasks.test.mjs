import assert from "node:assert/strict";
import test from "node:test";
import { api, practiceFixture } from "./helpers/practice-fixture.mjs";

const input = (patch = {}) => ({ action: "publish", id: crypto.randomUUID(), classId: "class", studentId: "student", kind: "reading", lessonId: api.readingLessons[0].id, sourceRevision: 0, title: "课后练习", detail: "按要求完成并保存。", ...patch });
const publish = (f, body) => f.request("teacher", "/practice/tasks", body);
const task = async (f, id) => (await f.request("student", "/practice/tasks?taskId=" + id)).tasks[0];
async function grant(f, status = "granted") { await f.db.prepare("INSERT INTO consent_records(id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,'school','student','guardian','learning_analytics',?)").bind(crypto.randomUUID(), status).run(); }
const assignedReading = (f, value) => ({ ...f.reading({ lesson: value.snapshot.lesson }), journeyRunId: undefined, practiceTaskId: value.id, sourceRevision: value.snapshot.lesson.source?.revision ?? 0 });
const startDictation = async (f, value) => {
  const id = crypto.randomUUID();
  const data = await f.request("student", "/dictation", { action: "start", id, kind: value.snapshot.dictationKind, lessonId: value.snapshot.lesson.id, sourceRevision: value.snapshot.lesson.source?.revision ?? 0, practiceTaskId: value.id });
  return data.recent.find((item) => item.id === id);
};
async function answer(f, session) {
  let next = (await f.request("student", "/dictation", { action: "hint", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision })).recent.find((item) => item.id === session.id);
  return (await f.request("student", "/dictation", { action: "answer", sessionId: next.id, requestId: crypto.randomUUID(), revision: next.revision, answer: next.question.speechText, playCount: 0 })).recent.find((item) => item.id === session.id);
}

test("practice task publishing and dashboards enforce role tenant class and student boundaries", async (t) => {
  const f = await practiceFixture(t); const body = input();
  for (const path of ["/practice/tasks", "/practice/classroom"]) await f.request(null, path, undefined, 401);
  for (const person of ["student", "peer", "foreign", "guardian"]) await f.request(person, "/practice/classroom", undefined, 403);
  await f.request("student", "/practice/tasks", body, 403);
  await f.request("colleague", "/practice/tasks", body, 403);
  await publish(f, body); await publish(f, body);
  assert.equal(await f.count("practice_tasks"), 1);
  await f.request("teacher", "/practice/tasks", { ...body, title: "修改重试内容" }, 409);
  await f.request("teacher", "/practice/tasks", input({ studentId: "peer" }), 403);
  await f.request("teacher", "/practice/tasks", input({ studentId: "foreign" }), 403);
  await f.request("teacher", "/practice/tasks", input({ classId: "other-class", studentId: "peer" }), 403);
  await f.request("teacher", "/practice/tasks", input({ dueAt: "not-a-time" }), 400);
  for (const person of ["peer", "foreign"]) await f.request(person, "/practice/tasks?taskId=" + body.id, undefined, 404);
  assert.deepEqual((await f.request("colleague", "/practice/tasks?view=teaching")).tasks, []);
  await f.request("teacher", "/practice/classroom?classId=other-class", undefined, 403);
  await f.request("teacher", "/practice/classroom?studentId=peer", undefined, 403);
  for (const person of ["student", "teacher", "admin"]) await f.request(person, "/workspace/actions", { action: "update_recommendation_status", id: body.id, status: "completed" }, 409);
  assert.equal((await task(f, body.id)).status, "pending");
  const plan = await f.request("student", "/workspace?sections=teaching,progress");
  assert.ok(plan.learningPlan.some((item) => item.id === body.id && item.kind === "teacher" && item.practiceHref.includes(body.id)));
});

test("assigned reading uses its fixed revision and completes from one saved group with retry-safe audit", async (t) => {
  const f = await practiceFixture(t); const lesson = { ...api.readingLessons[0], id: crypto.randomUUID(), action: "publish", revision: 0, classId: "class" };
  await f.request("teacher", "/reading/lessons", lesson);
  const body = input({ lessonId: lesson.id, sourceRevision: 1 }); await publish(f, body); const value = await task(f, body.id);
  await f.request("teacher", "/reading/lessons", { ...lesson, revision: 1, title: "新的标题" });
  const saved = assignedReading(f, value); const [first, second] = await Promise.all([f.request("student", "/practice", saved), f.request("student", "/practice", saved)]);
  assert.deepEqual(first, second); assert.equal((await task(f, body.id)).status, "completed");
  const detail = await f.request("teacher", "/practice/classroom?recordKind=reading&recordId=" + saved.id);
  assert.equal(detail.entry.title, lesson.title); assert.equal(detail.answers.length, 3);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='practice_task.completed' AND target_id=?").bind(body.id).first()).n, 1);
  await f.request("student", "/practice", { ...saved, id: crypto.randomUUID(), practiceTaskId: undefined }, 409);
  await f.request("student", "/practice", { ...f.writing(), practiceTaskId: body.id }, 400);
  await f.request("peer", "/practice", { ...saved, id: crypto.randomUUID() }, 404);
  await f.request("teacher", "/reading/lessons", { action: "archive", id: lesson.id, revision: 2 });
  assert.equal((await task(f, body.id)).available, false);
  await f.request("student", "/practice", { ...saved, id: crypto.randomUUID() }, 409);
  await f.request("student", "/practice", saved);
  assert.equal((await f.request("teacher", "/practice/classroom")).records.length, 1);
});

test("assigned writing counts only linked required characters and commits concurrent completion once", async (t) => {
  const f = await practiceFixture(t); const body = input({ kind: "writing", lessonId: undefined, characters: ["人", "天"] }); await publish(f, body);
  await f.request("student", "/practice", f.writing()); await f.request("student", "/practice", f.writing(null, "天"));
  assert.equal((await task(f, body.id)).status, "pending");
  await f.request("student", "/practice", { ...f.writing(null, "月"), practiceTaskId: body.id }, 400);
  const first = { ...f.writing(), practiceTaskId: body.id };
  await Promise.all([f.request("student", "/practice", first), f.request("student", "/practice", first)]);
  assert.deepEqual((await task(f, body.id)).writtenCharacters, ["人"]); assert.equal((await task(f, body.id)).status, "pending");
  await f.request("student", "/practice", { ...f.writing(null, "天"), practiceTaskId: body.id });
  const value = await task(f, body.id); assert.equal(value.status, "completed"); assert.equal(value.activities.length, 2);
  assert.equal((await f.request("student", "/practice?kind=writing&practiceTaskId=" + body.id)).records.length, 2);
  assert.equal((await f.request("teacher", "/practice/classroom")).records.length, 2);
  assert.equal(await f.count("submissions"), 0); assert.equal(await f.count("mastery_snapshots"), 0);
});

test("assigned dictation keeps early results pending and requires every fixed item in a round", async (t) => {
  const f = await practiceFixture(t); const body = input({ kind: "dictation", dictationKind: "words" }); await publish(f, body); const value = await task(f, body.id);
  let session = await startDictation(f, value); assert.equal(session.total, value.snapshot.items.length);
  session = await answer(f, session);
  await f.request("student", "/dictation", { action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision });
  assert.equal((await task(f, body.id)).status, "pending");
  assert.equal((await f.request("teacher", "/practice/classroom")).records[0].status, "ended");
  session = await startDictation(f, value);
  while (!session.complete) session = await answer(f, session);
  assert.equal((await task(f, body.id)).status, "completed");
  assert.equal((await f.request("teacher", "/practice/classroom")).records.length, 2);
  const archived = input({ kind: "dictation", dictationKind: "sentences" }); await publish(f, archived);
  session = await startDictation(f, await task(f, archived.id));
  await f.request("teacher", "/practice/tasks", { action: "archive", id: archived.id });
  assert.equal((await f.request("student", "/dictation")).active.available, false);
  await f.request("student", "/dictation", { action: "hint", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision }, 409);
  await f.request("student", "/dictation", { action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision });
  assert.equal((await task(f, archived.id)).status, "pending");
});

test("assigned journey retains publication snapshot and completes only after three gates", async (t) => {
  const f = await practiceFixture(t); await f.publish();
  const body = input({ kind: "journey", scenarioId: f.scenario.id, scenarioRevision: 1 }); await publish(f, body);
  const value = await task(f, body.id); assert.equal(JSON.stringify(value).includes("expressions"), false);
  await f.publish({ revision: 1, title: "新主题", content: { ...f.scenario.content, journey: { lessonId: "birthday-card", characters: ["日"] } } });
  const runId = crypto.randomUUID();
  const run = (await f.request("student", "/journeys", { action: "start", id: runId, scenarioId: f.scenario.id, practiceTaskId: body.id })).runs.find((item) => item.id === runId);
  assert.equal(run.lesson.id, value.snapshot.lesson.id); assert.deepEqual(run.characters, ["人", "天"]); assert.equal(run.title, f.scenario.title);
  await f.request("student", "/practice", f.reading(run)); await f.request("student", "/practice", f.writing(run)); await f.request("student", "/practice", f.writing(run, "天"));
  assert.equal((await task(f, body.id)).status, "pending");
  for (const [index, text] of ["我要两份包子", "一共多少钱", "谢谢"].entries()) await f.request("student", "/dialogue", { action: "send", sessionId: run.dialogueSessionId, requestId: crypto.randomUUID(), revision: index + 1, text });
  assert.equal((await task(f, body.id)).status, "completed");
  const dashboard = await f.request("teacher", "/practice/classroom");
  assert.equal(dashboard.records.length, 4); assert.equal(dashboard.tasks.completed, 1);
});

test("archived assignments and lost enrollment block indirect journey progress and preserve existing evidence", async (t) => {
  const f = await practiceFixture(t); await grant(f); await f.publish();
  const body = input({ kind: "journey", scenarioId: f.scenario.id, scenarioRevision: 1 }); await publish(f, body);
  const id = crypto.randomUUID(); const run = (await f.request("student", "/journeys", { action: "start", id, scenarioId: f.scenario.id, practiceTaskId: body.id })).runs[0];
  await f.request("student", "/practice", f.reading(run)); await f.request("student", "/practice", f.writing(run)); await f.request("student", "/practice", f.writing(run, "天"));
  await f.request("teacher", "/practice/tasks", { action: "archive", id: body.id });
  await f.request("student", "/practice", f.writing(run), 409);
  assert.equal((await f.request("student", "/journeys")).runs[0].available, false);
  assert.equal((await f.request("student", "/dialogue")).sessions.find((item) => item.id === run.dialogueSessionId).canContinue, false);
  assert.equal((await f.request("student", "/practice/overview")).nextActions.some((item) => item.practiceHref.includes(run.id)), false);
  assert.equal((await f.request("student", "/workspace?sections=teaching,progress")).learningPlan.some((item) => item.id === body.id || item.practiceHref?.includes(run.id)), false);
  await f.request("student", "/dialogue", { action: "send", sessionId: run.dialogueSessionId, requestId: crypto.randomUUID(), revision: 1, text: "我要两份包子" }, 409);
  const written = input({ kind: "writing", characters: ["人"] }); await publish(f, written);
  await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE student_user_id='student'").run();
  await f.request("student", "/practice", { ...f.writing(), practiceTaskId: written.id }, 409);
  assert.equal((await task(f, written.id)).available, false);
  assert.equal((await f.request("teacher", "/practice/classroom")).records.length, 0);
  assert.equal((await f.request("student", "/practice/overview")).records.length, 4);
});

test("new tasks cannot enter a classroom cursor even when they share its creation second", async (t) => {
  const f = await practiceFixture(t); const first = await f.request("teacher", "/practice/classroom");
  const body = input(); await publish(f, body);
  await f.db.prepare("UPDATE learning_recommendations SET created_at=? WHERE id=?").bind(first.asOf.slice(0, 19).replace("T", " "), body.id).run();
  assert.equal((await f.request("teacher", "/practice/classroom?cursor=" + encodeURIComponent(first.currentCursor))).tasks.total, 0);
  assert.equal((await f.request("teacher", "/practice/classroom")).tasks.total, 1);
});

test("availability is rechecked inside writes and concurrent required characters complete once", async (t) => {
  const f = await practiceFixture(t); const body = input({ kind: "writing", characters: ["人", "天"] }); await publish(f, body);
  await Promise.all(["人", "天"].map((char) => f.request("student", "/practice", { ...f.writing(null, char), practiceTaskId: body.id })));
  assert.equal((await task(f, body.id)).status, "completed");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='practice_task.completed' AND target_id=?").bind(body.id).first()).n, 1);
  const next = input({ kind: "writing", characters: ["人"] }); await publish(f, next);
  const original = f.db.batch.bind(f.db); let changed = false;
  f.db.batch = async (statements) => {
    if (!changed && statements[0].query.includes("INSERT OR IGNORE INTO practice_records")) {
      changed = true; await f.db.prepare("UPDATE learning_recommendations SET archived_at=CURRENT_TIMESTAMP WHERE id=?").bind(next.id).run();
    }
    return original(statements);
  };
  const attempt = { ...f.writing(), practiceTaskId: next.id };
  await f.request("student", "/practice", attempt, 409);
  assert.equal(await f.db.prepare("SELECT id FROM practice_records WHERE id=?").bind(attempt.id).first(), null);
  assert.equal((await task(f, next.id)).activities.length, 0); assert.equal((await task(f, next.id)).status, "pending");
});

test("classroom analysis rechecks withdrawal after the read batch and retains operational evidence", async (t) => {
  const f = await practiceFixture(t); await grant(f);
  const body = input(); await publish(f, body); const value = await task(f, body.id); const saved = assignedReading(f, value); saved.answers[0].meaning = saved.answers[1].meaning;
  await f.request("student", "/practice", saved);
  const original = f.db.readBatch.bind(f.db); let revoked = false;
  f.db.readBatch = async (statements) => {
    const result = await original(statements);
    if (!revoked && statements[1]?.query.includes("GROUP BY a.kind")) { revoked = true; await grant(f, "withdrawn"); }
    return result;
  };
  const data = await f.request("teacher", "/practice/classroom");
  assert.equal(data.consentedStudents, 0); assert.deepEqual(data.metrics, []); assert.deepEqual(data.wrongWords, []);
  assert.equal(data.records.length, 1); assert.equal(data.tasks.completed, 1);
});

test("completion audit failure rolls back the practice link task status and raw save", async (t) => {
  const f = await practiceFixture(t); const body = input({ kind: "writing", characters: ["人"] }); await publish(f, body);
  await f.db.prepare("CREATE TRIGGER reject_completion BEFORE INSERT ON audit_logs WHEN NEW.action='practice_task.completed' BEGIN SELECT RAISE(ABORT,'test_completion_rollback'); END").run();
  const saved = { ...f.writing(), practiceTaskId: body.id }; await f.request("student", "/practice", saved, 500);
  assert.equal(await f.count("practice_records"), 0); assert.equal(await f.count("practice_task_activities"), 0); assert.equal((await task(f, body.id)).status, "pending");
  await f.db.prepare("DROP TRIGGER reject_completion").run(); await f.request("student", "/practice", saved);
  assert.equal((await task(f, body.id)).status, "completed");
  await f.db.prepare("CREATE TRIGGER reject_publish BEFORE INSERT ON practice_tasks BEGIN SELECT RAISE(ABORT,'test_publish_rollback'); END").run();
  const next = input(); await f.request("teacher", "/practice/tasks", next, 500);
  assert.equal(await f.db.prepare("SELECT id FROM learning_recommendations WHERE id=?").bind(next.id).first(), null);
});

test("classroom totals and stable pages cover all class records while free practice and other classes stay private", async (t) => {
  const f = await practiceFixture(t); await grant(f);
  const body = input({ kind: "writing", characters: ["人"] }); await publish(f, body);
  const ids = new Set();
  for (let index = 0; index < 65; index++) { const saved = { ...f.writing(), practiceTaskId: body.id }; ids.add(saved.id); await f.request("student", "/practice", saved); }
  const free = f.writing(); await f.request("student", "/practice", free);
  await f.request("student", "/practice", f.reading());
  await f.request("peer", "/practice", f.writing());
  const page = await f.request("teacher", "/practice/classroom?period=30");
  assert.equal(page.metrics.find((item) => item.kind === "writing").rounds, 65);
  assert.equal(page.consentedStudents, 1); assert.equal(page.tasks.completed, 1);
  assert.equal(page.records.some((item) => item.id === free.id), false);
  await f.request("teacher", "/practice/classroom?recordKind=writing&recordId=" + free.id, undefined, 404);
  const newcomer = { ...f.writing(), practiceTaskId: body.id }; await f.request("student", "/practice", newcomer);
  await f.db.prepare("UPDATE practice_records SET created_at=? WHERE id=?").bind(page.records[0].createdAt, newcomer.id).run();
  const received = [...page.records.map((item) => item.id)]; let cursor = page.nextCursor;
  while (cursor) { const next = await f.request("teacher", "/practice/classroom?period=30&cursor=" + encodeURIComponent(cursor)); received.push(...next.records.map((item) => item.id)); assert.equal(next.metrics[0].rounds, 65); cursor = next.nextCursor; }
  assert.deepEqual(new Set(received), ids); assert.equal(received.length, 65);
  await f.request("teacher", "/practice/classroom?period=7&cursor=" + encodeURIComponent(page.currentCursor), undefined, 400);
  await grant(f, "withdrawn"); const withdrawn = await f.request("teacher", "/practice/classroom");
  assert.deepEqual(withdrawn.metrics, []); assert.deepEqual(withdrawn.wrongWords, []); assert.equal(withdrawn.records.length, 20); assert.equal(withdrawn.tasks.completed, 1);
  assert.equal((await f.request("colleague", "/practice/classroom")).records.length, 0);
});
