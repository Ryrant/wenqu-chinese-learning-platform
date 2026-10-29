import assert from "node:assert/strict";
import test from "node:test";
import { api, practiceFixture } from "./helpers/practice-fixture.mjs";

function lessonBody() { const { title, level, sentences, terms, focusWords } = structuredClone(api.readingLessons[0]); return { action: "publish", id: crypto.randomUUID(), classId: "class", revision: 0, title: `${title}班级课文`, level, sentences, terms, focusWords }; }
const answers = (lesson) => lesson.focusWords.slice(0, 3).map((word) => ({ word, meaning: lesson.terms.find((item) => item.word === word).meaning }));

test("teacher reading endpoints enforce roles ownership active enrollment and method gates", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody();
  await f.request(null, "/reading/lessons", undefined, 401);
  await f.request("temporary", "/reading/lessons", undefined, 403);
  await f.request("guardian", "/reading/lessons", undefined, 403);
  await f.request("student", "/reading/lessons?view=teacher", undefined, 403);
  await f.request("teacher", "/reading/lessons", undefined, 403);
  await f.request("student", "/reading/lessons", body, 403);
  await f.request("student", "/reading/lessons", undefined, 405, "DELETE");
  await f.request("colleague", "/reading/lessons", body, 403);
  await f.request("teacher", "/reading/lessons", body);
  assert.ok((await f.request("student", "/reading/lessons")).lessons.some((item) => item.id === body.id));
  for (const person of ["peer", "foreign"]) assert.equal((await f.request(person, "/reading/lessons")).lessons.some((item) => item.id === body.id), false);
  assert.equal((await f.request("colleague", "/reading/lessons?view=teacher")).lessons.length, 0);
  assert.equal((await f.request("admin", "/reading/lessons?view=teacher")).lessons.length, 1);
  await f.db.prepare("UPDATE enrollments SET status='inactive' WHERE student_user_id='student'").run();
  assert.equal((await f.request("student", "/reading/lessons")).lessons.some((item) => item.id === body.id), false);
});

test("drafts allow unfinished annotations and publishing requires full coverage and usable quiz words", async (t) => {
  const f = await practiceFixture(t); const body = { ...lessonBody(), action: "draft", sentences: ["我看龘。"], terms: [], focusWords: [] };
  const draft = (await f.request("teacher", "/reading/lessons", body)).lessons[0];
  assert.equal(draft.source.status, "draft");
  assert.equal((await f.request("student", "/reading/lessons")).lessons.some((item) => item.id === body.id), false);
  assert.deepEqual(api.missingReadingCharacters({ ...draft, sentences: ["我看龘。"] }), ["龘"]);
  await f.request("teacher", "/reading/lessons", { ...body, action: "publish", revision: 1 }, 400);
  const full = { ...lessonBody(), id: body.id, revision: 1 };
  const published = (await f.request("teacher", "/reading/lessons", full)).lessons[0];
  assert.equal(published.source.status, "published"); assert.equal(published.source.revision, 2);
  assert.ok(api.createReadingQuiz(published).every((question) => question.options.length === 4));
  await f.request("teacher", "/reading/lessons", { ...full, revision: 2, focusWords: full.focusWords.slice(0, 3) }, 400);
  await f.request("teacher", "/reading/lessons", { ...full, revision: 2, terms: [...full.terms, full.terms[0]] }, 400);
});

test("published updates are revision checked retry safe and never withdrawn by saving an edit draft", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody();
  const first = await f.request("teacher", "/reading/lessons", body);
  assert.deepEqual(await f.request("teacher", "/reading/lessons", body), first);
  assert.equal(await f.count("teacher_reading_lessons"), 1);
  await f.request("teacher", "/reading/lessons", { ...body, title: "过期修改" }, 409);
  await f.request("teacher", "/reading/lessons", { ...body, action: "draft", revision: 1 }, 400);
  assert.equal((await f.request("student", "/reading/lessons")).lessons.find((item) => item.id === body.id).source.status, "published");
  await f.request("teacher", "/reading/lessons", { ...body, id: crypto.randomUUID(), action: "draft", title: "另存草稿" });
  assert.equal(await f.count("teacher_reading_lessons"), 2);
  await f.request("admin", "/reading/lessons", { ...body, revision: 1, classId: "other-class" }, 409);
});

test("student grading uses the selected lesson version while saved words retain collected definitions", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody(); await f.request("teacher", "/reading/lessons", body);
  const word = body.focusWords[0];
  const collect = { action: "save", lessonId: body.id, sourceRevision: 1, word, meaning: "伪造释义" };
  const saved = await f.request("student", "/reading/vocabulary", collect);
  const originalMeaning = body.terms.find((item) => item.word === word).meaning;
  assert.equal(saved.vocabulary[0].meaning, originalMeaning);
  const practice = { id: crypto.randomUUID(), kind: "reading", referenceId: body.id, sourceRevision: 1, answers: answers(body), correct: 100 };
  assert.equal((await f.request("student", "/practice", practice)).record.result.correct, 3);
  const updated = { ...body, revision: 1, terms: body.terms.map((term) => term.word === word ? { ...term, meaning: "教师核对后的公园释义。" } : term) };
  await f.request("teacher", "/reading/lessons", updated);
  await f.request("student", "/practice", { ...practice, id: crypto.randomUUID() }, 409);
  const next = await f.request("student", "/practice", { ...practice, id: crypto.randomUUID(), sourceRevision: 2, answers: answers(updated) });
  assert.equal(next.record.result.correct, 3);
  assert.deepEqual(await f.request("student", "/reading/vocabulary", collect), saved);
  await f.request("teacher", "/reading/lessons", { action: "archive", id: body.id, revision: 2 });
  assert.deepEqual(await f.request("student", "/reading/vocabulary", collect), saved);
  await f.request("student", "/reading/vocabulary", { action: "save", lessonId: body.id, sourceRevision: 2, word: body.focusWords[1] }, 409);
  assert.equal((await f.request("student", "/practice?kind=reading")).records.length, 2);
});

test("journeys use class scoped teacher readings and keep their starting snapshot", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody(); await f.request("teacher", "/reading/lessons", body);
  const content = { ...f.scenario.content, journey: { lessonId: body.id, characters: ["人", "天"] } };
  await f.publish({ content }); const run = await f.start(); assert.equal(run.lesson.source.revision, 1);
  const updated = { ...body, revision: 1, title: "更新后的班级课文", terms: body.terms.map((term) => term.word === body.focusWords[0] ? { ...term, meaning: "新版本词义。" } : term) };
  await f.request("teacher", "/reading/lessons", updated);
  const oldPractice = { ...f.reading(run), sourceRevision: 1 };
  assert.equal((await f.request("student", "/practice", oldPractice)).record.result.correct, 3);
  const second = await f.start(); assert.equal(second.lesson.source.revision, 2);
  await f.request("teacher", "/reading/lessons", { action: "archive", id: body.id, revision: 2 });
  assert.equal((await f.request("student", "/journeys")).journeys.length, 0);
  await f.request("student", "/journeys", { action: "start", id: crypto.randomUUID(), scenarioId: f.scenario.id }, 409);
  await f.request("student", "/practice", f.writing(run), 409);
  await f.request("student", "/practice", oldPractice);
  const first = (await f.request("student", `/journeys?runId=${run.id}`)).runs[0];
  assert.equal(first.lesson.title, body.title); assert.equal(first.available, false);
  assert.equal(first.records.length, 1);
  const foreign = { ...lessonBody(), id: crypto.randomUUID(), classId: "other-class" }; await f.request("colleague", "/reading/lessons", foreign);
  await f.request("admin", "/dialogue", { ...f.scenario, id: crypto.randomUUID(), content: { ...content, journey: { lessonId: foreign.id, characters: ["人"] } } }, 409);
});

test("review distractors do not use another lesson's definition of the same word", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody(); const word = "公园";
  const originalMeaning = body.terms.find((item) => item.word === word).meaning;
  body.terms = body.terms.map((term) => term.word === word ? { ...term, meaning: "教师为本篇核对的另一种公园释义。" } : term);
  await f.request("teacher", "/reading/lessons", body);
  await f.request("student", "/reading/vocabulary", { action: "save", lessonId: "park-morning", word });
  await f.request("student", "/reading/vocabulary", { action: "save", lessonId: body.id, sourceRevision: 1, word });
  const review = (await f.request("student", "/vocabulary-review", { action: "start", id: crypto.randomUUID(), mode: "due" })).active;
  assert.equal(review.question.kind, "meaning");
  assert.ok(review.question.options.includes(originalMeaning));
  assert.equal(review.question.options.includes("教师为本篇核对的另一种公园释义。"), false);
  assert.ok(review.question.prompt.includes("公园的早晨"));
});

test("publication and archive roll back with audit failures", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody();
  await f.db.prepare("CREATE TRIGGER reject_reading BEFORE INSERT ON audit_logs WHEN NEW.action='reading_lesson.published' BEGIN SELECT RAISE(ABORT,'fixture_reading_audit_failure'); END").run();
  await f.request("teacher", "/reading/lessons", body, 500); assert.equal(await f.count("teacher_reading_lessons"), 0);
  await f.db.prepare("DROP TRIGGER reject_reading").run(); await f.request("teacher", "/reading/lessons", body);
  await f.db.prepare("CREATE TRIGGER reject_reading BEFORE INSERT ON audit_logs WHEN NEW.action='reading_lesson.archived' BEGIN SELECT RAISE(ABORT,'fixture_reading_audit_failure'); END").run();
  await f.request("teacher", "/reading/lessons", { action: "archive", id: body.id, revision: 1 }, 500);
  assert.equal((await f.request("student", "/reading/lessons")).lessons.find((item) => item.id === body.id).source.status, "published");
});

test("archiving a reading between validation and journey allocation prevents a new round", async (t) => {
  const f = await practiceFixture(t); const body = lessonBody(); await f.request("teacher", "/reading/lessons", body);
  await f.publish({ content: { ...f.scenario.content, journey: { lessonId: body.id, characters: ["人"] } } });
  const batch = f.db.batch.bind(f.db); let intercept = true;
  f.db.batch = async (statements) => {
    if (intercept) {
      intercept = false;
      await f.db.prepare("UPDATE teacher_reading_lessons SET status='archived',revision=revision+1 WHERE id=?").bind(body.id).run();
    }
    return batch(statements);
  };
  await f.request("student", "/journeys", { action: "start", id: crypto.randomUUID(), scenarioId: f.scenario.id }, 409);
  assert.equal(await f.count("journey_runs"), 0); assert.equal(await f.count("dialogue_sessions"), 0);
});
