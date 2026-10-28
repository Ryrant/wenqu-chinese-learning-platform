import assert from "node:assert/strict";
import test from "node:test";
import { api, practiceFixture } from "./helpers/practice-fixture.mjs";

async function grant(f) { await f.db.prepare("INSERT INTO consent_records(id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,'school','student','guardian','learning_analytics','granted')").bind(crypto.randomUUID()).run(); }
const metric = (data, kind) => data.metrics.find((item) => item.kind === kind);
const detail = (f, kind, id, expected = 200, person = "student") => f.request(person, "/practice/overview?recordKind=" + kind + "&recordId=" + id, undefined, expected);

test("practice history totals cover the whole range and cursor pages exclude newly inserted same-time rows", async (t) => {
  const f = await practiceFixture(t); await grant(f); const ids = new Set();
  for (let index = 0; index < 65; index++) { const input = f.writing(null); ids.add(input.id); await f.request("student", "/practice", input); }
  const first = await f.request("student", "/practice/overview?period=30");
  assert.equal(metric(first, "writing").rounds, 65); assert.equal(metric(first, "writing").hints, 65);
  assert.ok(first.records.length > 0 && first.records.length < 65);
  const inserted = f.writing(null); await f.request("student", "/practice", inserted);
  await f.db.prepare("UPDATE practice_records SET created_at=? WHERE id=?").bind(first.records[0].createdAt, inserted.id).run();
  const received = [...first.records.map((item) => item.id)]; let cursor = first.nextCursor;
  while (cursor) {
    const page = await f.request("student", "/practice/overview?period=30&cursor=" + encodeURIComponent(cursor));
    assert.equal(metric(page, "writing").rounds, 65);
    received.push(...page.records.map((item) => item.id)); cursor = page.nextCursor;
  }
  assert.equal(received.length, 65); assert.deepEqual(new Set(received), ids);
  assert.equal(metric(await f.request("student", "/practice/overview"), "writing").rounds, 66);
  const peer = await f.request("peer", "/practice/overview?period=30&cursor=" + encodeURIComponent(first.currentCursor) + "&studentId=student");
  assert.deepEqual(peer.records, []);
  await f.request("student", "/practice/overview?period=7&cursor=" + encodeURIComponent(first.currentCursor), undefined, 400);
  await f.request("student", "/practice/overview?cursor=invalid", undefined, 400);
  await f.request("student", "/practice/overview?period=8", undefined, 400);
});

test("calendar windows start at Beijing midnight and keep the exact lower boundary", async (t) => {
  const f = await practiceFixture(t); await grant(f);
  const left = f.writing(null); const inside = f.writing(null);
  await f.request("student", "/practice", left); await f.request("student", "/practice", inside);
  const baseline = await f.request("student", "/practice/overview?period=7");
  assert.match(baseline.rangeStart, /T16:00:00.000Z$/);
  await f.db.prepare("UPDATE practice_records SET created_at=? WHERE id=?").bind(baseline.rangeStart, inside.id).run();
  await f.db.prepare("UPDATE practice_records SET created_at=? WHERE id=?").bind(new Date(Date.parse(baseline.rangeStart) - 1).toISOString(), left.id).run();
  const data = await f.request("student", "/practice/overview?period=7&cursor=" + encodeURIComponent(baseline.currentCursor));
  assert.deepEqual(data.records.map((item) => item.id), [inside.id]); assert.equal(metric(data, "writing").rounds, 1);
});

test("saved writing and reading details preserve answers and remain owner-only after source archival", async (t) => {
  const f = await practiceFixture(t); await grant(f);
  const lesson = structuredClone(api.readingLessons[0]); const id = crypto.randomUUID();
  await f.request("teacher", "/reading/lessons", { action: "publish", revision: 0, classId: "class", ...lesson, id, title: "班级原课文" });
  const input = { ...f.reading(null), referenceId: id, sourceRevision: 1 };
  input.answers[0].meaning = input.answers[1].meaning;
  const saved = (await f.request("student", "/practice", input)).record;
  const writing = (await f.request("student", "/practice", f.writing(null))).record;
  await f.request("teacher", "/reading/lessons", { action: "archive", id, revision: 1 });
  await f.db.prepare("UPDATE enrollments SET status='disabled' WHERE class_id='class'").run();
  const archive = await detail(f, "reading", saved.id);
  assert.equal(archive.answers.length, 3); assert.equal(archive.answers[0].actual, input.answers[0].meaning);
  assert.equal(archive.answers[0].expected, saved.result.answers[0].meaning); assert.equal(archive.answers[0].correct, false);
  assert.deepEqual(archive.texts, lesson.sentences);
  assert.deepEqual((await detail(f, "writing", writing.id)).writing, writing.result);
  for (const person of ["peer", "foreign"]) await detail(f, "reading", saved.id, 404, person);
  for (const person of ["teacher", "guardian", "admin"]) await detail(f, "reading", saved.id, 403, person);
  await f.request("student", "/practice/overview?recordKind=reading", undefined, 400);
});

test("vocabulary metrics use first attempts and dictation records retain reference assistance and partial ending", async (t) => {
  const f = await practiceFixture(t); await grant(f);
  await f.request("student", "/reading/vocabulary", { action: "save", lessonId: "park-morning", sourceRevision: 0, word: "公园" });
  let review = (await f.request("student", "/vocabulary-review", { action: "start", id: crypto.randomUUID(), mode: "due" })).active;
  const original = (await f.db.prepare("SELECT snapshot_json FROM vocabulary_review_sessions WHERE id=?").bind(review.id).first()).snapshot_json;
  const item = JSON.parse(original)[0];
  review = (await f.request("student", "/vocabulary-review", { action: "answer", sessionId: review.id, requestId: crypto.randomUUID(), revision: review.revision, selectedOption: (item.answerIndex + 1) % item.options.length })).active;
  const reviewId = review.id;
  await f.request("student", "/vocabulary-review", { action: "answer", sessionId: review.id, requestId: crypto.randomUUID(), revision: review.revision, selectedOption: item.answerIndex });
  let audio = (await f.request("student", "/dictation", { action: "start", id: crypto.randomUUID(), kind: "words", lessonId: "park-morning", sourceRevision: 0 })).active;
  audio = (await f.request("student", "/dictation", { action: "hint", sessionId: audio.id, requestId: crypto.randomUUID(), revision: 0 })).active;
  audio = (await f.request("student", "/dictation", { action: "answer", sessionId: audio.id, requestId: crypto.randomUUID(), revision: audio.revision, answer: audio.question.speechText, playCount: 0 })).active;
  await f.request("student", "/dictation", { action: "finish", sessionId: audio.id, requestId: crypto.randomUUID(), revision: audio.revision });
  const data = await f.request("student", "/practice/overview");
  assert.equal(metric(data, "vocabulary").correct, 0); assert.equal(metric(data, "vocabulary").total, 1);
  const attempts = (await detail(f, "vocabulary", reviewId)).answers;
  assert.equal(attempts.length, 2); assert.deepEqual(attempts.map((item) => item.correct), [false, true]);
  assert.equal(metric(data, "dictation").total, 1); assert.equal(metric(data, "dictation").referenceViewed, 1);
  assert.equal(metric(data, "dictation").completed, 0);
  const audioDetail = await detail(f, "dictation", audio.id);
  assert.equal(audioDetail.entry.status, "ended"); assert.equal(audioDetail.answers[0].usedReference, true); assert.equal(audioDetail.answers[0].playCount, 0);
});

test("a completed theme keeps its dialogue and module counts distinct from child practice", async (t) => {
  const f = await practiceFixture(t); await grant(f); await f.publish(); const run = await f.start();
  await f.request("student", "/practice", f.reading(run));
  for (const character of run.characters) await f.request("student", "/practice", f.writing(run, character));
  for (const [index, text] of ["我要两份包子", "一共多少钱", "谢谢"].entries()) await f.request("student", "/dialogue", { action: "send", sessionId: run.dialogueSessionId, requestId: crypto.randomUUID(), revision: index + 1, text });
  const data = await f.request("student", "/practice/overview");
  assert.equal(metric(data, "journey").rounds, 1); assert.equal(metric(data, "journey").completed, 1);
  assert.equal(metric(data, "reading").rounds, 1); assert.equal(metric(data, "writing").rounds, run.characters.length);
  const history = await detail(f, "journey", run.id);
  assert.equal(history.entry.status, "finished"); assert.equal(history.turns.filter((item) => item.kind === "student").length, 3);
  assert.deepEqual(history.texts.slice(1), run.lesson.sentences);
  assert.equal(await f.count("submissions"), 0); assert.equal(await f.count("mastery_snapshots"), 0);
});

test("withdrawal before aggregation suppresses analysis while preserving the owner's original records", async (t) => {
  const f = await practiceFixture(t); await grant(f); const saved = (await f.request("student", "/practice", f.writing(null))).record;
  const batch = f.db.readBatch.bind(f.db); let once = true;
  f.db.readBatch = async (statements) => {
    if (once) { once = false; await f.db.prepare("UPDATE consent_records SET status='withdrawn' WHERE tenant_id='school' AND student_user_id='student'").run(); }
    return batch(statements);
  };
  const data = await f.request("student", "/practice/overview");
  assert.equal(data.available, false); assert.equal(data.metrics, null); assert.deepEqual(data.nextActions, []);
  assert.equal(data.records[0].id, saved.id); assert.equal((await detail(f, "writing", saved.id)).writing.mistakes, 2);
});

test("an unanswered viewed dictation reference remains visible with its saved pinyin after ending", async (t) => {
  const f = await practiceFixture(t);
  let round = (await f.request("student", "/dictation", { action: "start", id: crypto.randomUUID(), kind: "words", lessonId: "park-morning", sourceRevision: 0 })).active;
  round = (await f.request("student", "/dictation", { action: "hint", sessionId: round.id, requestId: crypto.randomUUID(), revision: 0 })).active;
  const reference = round.question;
  await f.request("student", "/dictation", { action: "finish", sessionId: round.id, requestId: crypto.randomUUID(), revision: round.revision });
  const record = await detail(f, "dictation", round.id);
  assert.deepEqual(record.answers, []); assert.equal(record.hints, 1); assert.equal(record.texts.length, 1);
  assert.ok(record.texts[0].includes(reference.speechText)); assert.ok(record.texts[0].includes(reference.pinyin));
});
