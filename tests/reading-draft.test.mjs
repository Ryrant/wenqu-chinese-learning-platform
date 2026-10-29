import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { api as platformApi, practiceFixture } from "./helpers/practice-fixture.mjs";

const bundle = await build({ stdin: { contents: "export * from './lib/reading-draft';", resolveDir: fileURLToPath(new URL("../", import.meta.url)) }, bundle: true, platform: "node", format: "esm", write: false });
const api = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const scope = { tenantId: "学校:甲", userId: "teacher" };
function storage() {
  const values = new Map();
  return { values, get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; }, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
}
const draft = (patch = {}) => ({ id: crypto.randomUUID(), revision: 1, classId: "class", title: "班级课文", level: "A2", text: "公园里有高高的树。\n我们一起读书。", terms: [{ id: crypto.randomUUID(), word: "公园", pinyin: "gōng yuán", meaning: "供大家游玩的地方。" }], focus: "公园", ...patch });

test("device drafts are isolated by tenant account and lesson and retain partially edited terms", () => {
  const store = storage(); const first = draft(); const second = draft({ revision: 0, title: "", terms: [{ id: crypto.randomUUID(), word: "", pinyin: "gōng", meaning: "" }] });
  api.saveLocalReadingDraft(store, scope, first, "2026-10-29T01:00:00.000Z"); api.saveLocalReadingDraft(store, scope, second, "2026-10-29T02:00:00.000Z");
  const peer = { ...scope, userId: "other" }; const foreign = { ...scope, tenantId: "other-school" };
  api.saveLocalReadingDraft(store, peer, { ...first, title: "另一个账号" }); api.saveLocalReadingDraft(store, foreign, { ...first, title: "其他机构" });
  const read = api.readLocalReadingDrafts(store, scope); assert.equal(read.drafts.length, 2); assert.deepEqual(read.drafts[0].draft, second); assert.deepEqual(read.drafts[1].draft, first);
  assert.equal(api.readLocalReadingDrafts(store, peer).drafts[0].draft.title, "另一个账号");
  assert.equal(api.readLocalReadingDrafts(store, foreign).drafts[0].draft.title, "其他机构");
  assert.notEqual(api.readingDraftPrefix({ tenantId: "a:b", userId: "c" }), api.readingDraftPrefix({ tenantId: "a", userId: "b:c" }));
});

test("restoring retains the editing baseline and exact text instead of adopting a later server revision", () => {
  const store = storage(); const editing = draft({ revision: 3, title: "  未提交修改  ", text: "我说：“你好！”\n卡片上写着祝福。" });
  api.saveLocalReadingDraft(store, scope, editing);
  const restored = api.readLocalReadingDrafts(store, scope).drafts[0];
  assert.equal(restored.baseRevision, 3); assert.equal(restored.draft.revision, 3); assert.deepEqual(restored.draft, editing);
  const newerServerVersion = { ...editing, revision: 4, title: "服务器新版" };
  assert.notEqual(restored.baseRevision, newerServerVersion.revision); assert.equal(restored.draft.title, editing.title);
});

test("unrecognized damaged or forged device records are reported and kept intact", () => {
  const store = storage(); const first = draft(); api.saveLocalReadingDraft(store, scope, first);
  const key = [...store.values.keys()][0]; const good = JSON.parse(store.getItem(key));
  const damaged = [
    "{", JSON.stringify({ ...good, version: 2 }), JSON.stringify({ ...good, userId: "other" }),
    JSON.stringify({ ...good, baseRevision: 99 }), JSON.stringify({ ...good, draft: { ...first, terms: [{ ...first.terms[0], pinyin: null }] } }),
  ];
  for (const raw of damaged) {
    store.setItem(key, raw); const result = api.readLocalReadingDrafts(store, scope);
    assert.deepEqual(result.drafts, []); assert.deepEqual(result.unreadable, [key]); assert.equal(store.getItem(key), raw);
  }
  store.setItem("unrelated", "keep"); assert.equal(api.readLocalReadingDrafts(store, scope).unreadable.length, 1);
});

test("quota and read failures propagate without changing the draft or existing saved copy", () => {
  const store = storage(); const editing = draft(); api.saveLocalReadingDraft(store, scope, editing);
  const before = [...store.values.entries()]; const changed = { ...editing, title: "仍在页面里的修改" };
  const failure = Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" });
  assert.throws(() => api.saveLocalReadingDraft({ setItem() { throw failure; } }, scope, changed), (reason) => reason === failure);
  assert.deepEqual([...store.values.entries()], before); assert.equal(changed.title, "仍在页面里的修改");
  assert.throws(() => api.readLocalReadingDrafts({ get length() { throw new Error("SecurityError"); } }, scope), /SecurityError/);
});

test("confirmed saves clear only their exact device version and preserve newer edits and other identities", () => {
  const store = storage(); const original = draft(); api.saveLocalReadingDraft(store, scope, original);
  const newer = { ...original, title: "另一页面的新编辑" }; api.saveLocalReadingDraft(store, scope, newer);
  assert.equal(api.removeConfirmedReadingDraft(store, scope, original), false);
  assert.deepEqual(api.readLocalReadingDrafts(store, scope).drafts[0].draft, newer);
  assert.equal(api.removeConfirmedReadingDraft(store, { ...scope, userId: "other" }, newer), false);
  assert.equal(api.removeConfirmedReadingDraft(store, scope, newer), true); assert.equal(store.length, 0);
});

test("every legal server sentence fits the device format including inserted line breaks", async (t) => {
  const f = await practiceFixture(t);
  const sentences = Array.from({ length: 20 }, () => "我你他她".repeat(75)); const id = crypto.randomUUID();
  const terms = [..."我你他她"].map((word, index) => ({ word, pinyin: ["wǒ", "nǐ", "tā", "tā"][index], meaning: "第" + index + "个不同释义。" }));
  const response = await f.request("teacher", "/reading/lessons", { action: "publish", id, revision: 0, classId: "class", title: "合法长度边界", level: "A2", sentences, terms, focusWords: [..."我你他她"] });
  const lesson = response.lessons.find((item) => item.id === id);
  const editing = draft({ id, title: "只修改标题", text: lesson.sentences.join("\n"), terms: lesson.terms.map((term) => ({ ...term, id: crypto.randomUUID() })), focus: lesson.focusWords.join("，") });
  assert.equal(editing.text.length, 6019); assert.equal(api.readingDraftTextLimit, 6019);
  const store = storage(); api.saveLocalReadingDraft(store, scope, editing);
  assert.deepEqual(api.readLocalReadingDrafts(store, scope).drafts[0].draft, editing);
  assert.throws(() => api.saveLocalReadingDraft(store, scope, { ...editing, text: editing.text + "多" }), /invalid_local_reading_draft/);
  assert.deepEqual(api.readLocalReadingDrafts(store, scope).drafts[0].draft, editing);
});

test("a revision zero draft with a lost save response can confirm equal content or preserve changed content as a new copy", async (t) => {
  const f = await practiceFixture(t); const id = crypto.randomUUID(); const lesson = platformApi.readingLessons[0];
  const body = { action: "draft", id, revision: 0, classId: "class", title: "首次保存待确认", level: lesson.level, sentences: lesson.sentences, terms: lesson.terms, focusWords: lesson.focusWords };
  await f.request("teacher", "/reading/lessons", body);
  const catalog = await f.request("teacher", "/reading/lessons?view=teacher"); const server = catalog.lessons.find((item) => item.id === id);
  const local = draft({ id, revision: 0, title: body.title, level: body.level, text: body.sentences.join("\n"), terms: body.terms.map((term) => ({ ...term, id: crypto.randomUUID() })), focus: body.focusWords.join("，") });
  assert.equal(server.source.revision, 1); assert.equal(api.readingDraftMatchesLesson(local, server), true);
  assert.equal((await f.request("teacher", "/reading/lessons", body)).lessons.find((item) => item.id === id).source.revision, 1);
  assert.equal(api.readingDraftMatchesLesson({ ...local, title: "继续编辑的新内容" }, server), false);
  await f.request("teacher", "/reading/lessons", { ...body, title: "继续编辑的新内容" }, 409);
  const copyId = crypto.randomUUID(); const copied = await f.request("teacher", "/reading/lessons", { ...body, id: copyId, title: "继续编辑的新内容" });
  assert.equal(copied.lessons.find((item) => item.id === id).title, body.title);
  assert.equal(copied.lessons.find((item) => item.id === copyId).title, "继续编辑的新内容");
});
