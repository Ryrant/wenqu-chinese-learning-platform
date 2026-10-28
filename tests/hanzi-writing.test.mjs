import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { practiceCharacters } from './lib/hanzi-practice';
    export { matchWorkspaceRoute, workspacePath } from './lib/workspace/navigation';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("each practice character ships complete local stroke data", async () => {
  const characters = api.practiceCharacters;
  assert.ok(characters.length > 0);
  assert.equal(new Set(characters.map((item) => item.character)).size, characters.length);
  for (const item of characters) {
    assert.equal([...item.character].length, 1);
    assert.ok(item.pinyin && item.word && item.example);
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
  for (const file of ["ARPHICPL.TXT", "HANZI-WRITER-LICENSE.txt", "NOTICE.txt"]) {
    assert.ok((await readFile(new URL(`../public/hanzi/${file}`, import.meta.url), "utf8")).length > 0);
  }
});

test("writing navigation resolves to the student workspace", () => {
  const path = api.workspacePath("student", "汉字书写");
  assert.equal(path, "/student/writing");
  assert.deepEqual(api.matchWorkspaceRoute(path), { role: "student", page: "writing", label: "汉字书写" });
  assert.equal(api.matchWorkspaceRoute("/guardian/writing"), null);
});
