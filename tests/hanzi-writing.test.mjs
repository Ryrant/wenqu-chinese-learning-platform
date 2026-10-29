import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { practiceCharacters, filterPracticeCharacters } from './lib/hanzi-practice';
    export { readingLessons } from './lib/reading-lessons';
    export { matchWorkspaceRoute, workspacePath } from './lib/workspace/navigation';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("each practice character ships complete local stroke data", async () => {
  const characters = api.practiceCharacters;
  assert.equal(characters.length, 161);
  assert.equal(new Set(characters.map((item) => item.character)).size, characters.length);
  for (const item of characters) {
    assert.equal([...item.character].length, 1);
    assert.ok(item.pinyin && item.word && item.example);
    assert.ok(item.word.includes(item.character), item.character + " needs a matching word");
    assert.ok(item.example.includes(item.word), item.character + " needs its word in the example");
    const data = JSON.parse(await readFile(new URL(`../public/hanzi/${item.character}.json`, import.meta.url), "utf8"));
    assert.ok(data.strokes.length > 0, `${item.character} must have strokes`);
    assert.equal(data.strokes.length, data.medians.length);
    data.strokes.forEach((stroke, index) => {
      assert.equal(typeof stroke, "string");
      assert.ok(stroke.length > 0);
      assert.ok(data.medians[index].length >= 2, `${item.character} must have a drawable median`);
      for (const point of data.medians[index]) {
        assert.equal(point.length, 2);
        assert.ok(point.every(Number.isFinite));
      }
    });
  }
  assert.deepEqual(new Set((await readdir(new URL("../public/hanzi/", import.meta.url))).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5))), new Set(characters.map((item) => item.character)));
  for (const file of ["ARPHICPL.TXT", "HANZI-WRITER-LICENSE.txt", "NOTICE.txt"]) {
    assert.ok((await readFile(new URL(`../public/hanzi/${file}`, import.meta.url), "utf8")).length > 0);
  }
});

test("the local library is exactly the platform reading corpus plus the original characters", () => {
  const corpus = new Set(api.readingLessons.flatMap((lesson) => lesson.sentences.join("").match(/\p{Script=Han}/gu)));
  assert.equal(corpus.size, 154);
  const originals = [..."人日月山水木天地中文学习"];
  const required = new Set([...corpus, ...originals]);
  assert.equal(required.size, 161);
  assert.deepEqual(new Set(api.practiceCharacters.map((item) => item.character)), required);
});

test("character search accepts Hanzi and toned or plain pinyin and intersects the selected reading", () => {
  const filter = (query, lessonId = "") => api.filterPracticeCharacters(api.practiceCharacters, query, lessonId).map((item) => item.character);
  assert.ok(filter("树").includes("树"));
  assert.ok(filter("shù").includes("树")); assert.ok(filter(" SHU4 ").includes("树"));
  assert.ok(filter("公园").includes("公")); assert.ok(filter("公园").includes("园"));
  assert.deepEqual(filter("never-matches"), []); assert.deepEqual(filter("", "unknown-lesson"), []);
  for (const lesson of api.readingLessons) assert.deepEqual(new Set(filter("", lesson.id)), new Set(lesson.sentences.join("").match(/\p{Script=Han}/gu)));
  assert.deepEqual(filter("月", "park-morning"), []);
  const subset = api.practiceCharacters.filter((item) => ["人", "天"].includes(item.character));
  assert.deepEqual(api.filterPracticeCharacters(subset, "树"), []);
});

test("writing navigation resolves to the student workspace", () => {
  const path = api.workspacePath("student", "汉字书写");
  assert.equal(path, "/student/writing");
  assert.deepEqual(api.matchWorkspaceRoute(path), { role: "student", page: "writing", label: "汉字书写" });
  assert.equal(api.matchWorkspaceRoute("/guardian/writing"), null);
});
