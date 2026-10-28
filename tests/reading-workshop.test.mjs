import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { readingLessons, readingTokens, createReadingQuiz } from './lib/reading-lessons';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createSessionToken } from './lib/auth-token';
    export { createApiApp } from './server/app';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("original reading lessons retain every character and annotate every Chinese word", () => {
  for (const lesson of api.readingLessons) {
    for (const sentence of lesson.sentences) {
      const tokens = api.readingTokens(sentence, lesson);
      assert.equal(tokens.map((token) => typeof token === "string" ? token : token.word).join(""), sentence);
      for (const token of tokens) {
        if (typeof token === "string") assert.doesNotMatch(token, /\p{Script=Han}/u, `${lesson.title}: ${sentence}`);
        else assert.ok(token.pinyin && token.meaning);
      }
    }
  }
});

test("generated reading exercises use distinct focus words and truthful answer keys", () => {
  for (const lesson of api.readingLessons) {
    for (const random of [() => 0, () => .999, Math.random]) {
      const quiz = api.createReadingQuiz(lesson, random);
      assert.equal(quiz.length, 3);
      assert.equal(new Set(quiz.map((question) => question.word)).size, 3);
      for (const question of quiz) {
        assert.ok(lesson.focusWords.includes(question.word));
        assert.equal(question.options.length, 4);
        assert.equal(new Set(question.options).size, 4);
        assert.equal(question.options[question.correctOption], lesson.terms.find((term) => term.word === question.word).meaning);
      }
    }
  }
});

async function fixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: {} });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('reading-school','阅读学校'),('other-school','其他学校')"),
    ...["reader", "other", "foreign", "teacher", "guardian", "temporary"].map((id) => db.prepare("INSERT INTO users(id,email,display_name,must_change_password) VALUES (?,?,?,?)").bind(id, `${id}@reading.test`, id, id === "temporary" ? 1 : 0)),
    ...["reader", "other", "foreign", "teacher", "guardian", "temporary"].map((id) => db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,?)")
      .bind(id === "foreign" ? "other-school" : "reading-school", id, ["teacher", "guardian"].includes(id) ? id : "student")),
  ]);
  const secret = await api.ensureSiteJwtSecret(db);
  const tokens = Object.fromEntries(await Promise.all(["reader", "other", "foreign", "teacher", "guardian", "temporary"].map(async (id) => [id, await api.createSessionToken({ email: `${id}@reading.test`, displayName: id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, sessionVersion: 0 }, secret)])));
  const app = api.createApiApp();
  const request = async (id, body, expected = 200, method = body ? "POST" : "GET") => {
    const response = await app.fetch(new Request("http://127.0.0.1/api/v1/reading/vocabulary", {
      method, headers: { ...(id ? { authorization: `Bearer ${tokens[id]}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }));
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data));
    return data;
  };
  return { db, request };
}

test("vocabulary HTTP API enforces login, student role, and first-password-change gates", async (t) => {
  const f = await fixture(t);
  await f.request(null, undefined, 401);
  await f.request("teacher", undefined, 403);
  await f.request("guardian", { action: "save", lessonId: "park-morning", word: "公园" }, 403);
  await f.request("temporary", undefined, 403);
  await f.request("reader", undefined, 405, "DELETE");
  await f.request("reader", { action: "save", lessonId: "unknown", word: "公园" }, 400);
  await f.request("reader", { action: "save", lessonId: "park-morning", word: "不存在的词" }, 400);
  await f.db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id='reader'").run();
  await f.request("reader", undefined, 403);
});

test("saved words survive re-reading, ignore forged definitions, and stay isolated by owner and tenant", async (t) => {
  const f = await fixture(t);
  const body = { action: "save", lessonId: "park-morning", word: "公园", meaning: "伪造释义", userId: "other", tenantId: "other-school" };
  const first = (await f.request("reader", body)).vocabulary;
  assert.equal(first.length, 1);
  assert.equal(first[0].meaning, "供大家休息、游玩的公共园地。");
  assert.ok(first[0].example.includes("公园"));
  assert.deepEqual((await f.request("reader", body)).vocabulary, first);
  assert.deepEqual((await f.request("reader")).vocabulary, first);
  assert.deepEqual((await f.request("other")).vocabulary, []);
  assert.deepEqual((await f.request("foreign")).vocabulary, []);
  await f.request("other", { action: "remove", id: first[0].id });
  await f.request("foreign", { action: "remove", id: first[0].id });
  assert.deepEqual((await f.request("reader")).vocabulary, first);
  await f.request("reader", { action: "remove", id: first[0].id });
  assert.deepEqual((await f.request("reader", { action: "remove", id: first[0].id })).vocabulary, []);
});
