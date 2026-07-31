import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function importTypeScript(path) {
  const source = await readFile(new URL(path, root), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: path,
    reportDiagnostics: true,
  });
  assert.deepEqual(
    (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
    [],
  );
  return import(`data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`);
}

test("diagnostic scores are grouped by learning objective", async () => {
  const { calculateDiagnosticScores } = await importTypeScript("app/lib/learning-loop.ts");
  assert.deepEqual(calculateDiagnosticScores([
    { objectiveId: "listen", isCorrect: true },
    { objectiveId: "listen", isCorrect: false },
    { objectiveId: "write", isCorrect: true },
  ]), {
    listen: { score: 0.5, evidenceCount: 2 },
    write: { score: 1, evidenceCount: 1 },
  });
});

test("mastery blends new evidence and preserves cumulative evidence count", async () => {
  const { blendMastery } = await importTypeScript("app/lib/learning-loop.ts");
  assert.deepEqual(blendMastery(null, 0, 0.8, 2), { mastery: 0.8, evidenceCount: 2 });
  assert.deepEqual(blendMastery(0.5, 3, 1, 2), { mastery: 0.65, evidenceCount: 5 });
});

test("learning plan prioritizes teacher intervention review family and assignments", async () => {
  const { rankLearningPlan } = await importTypeScript("app/lib/learning-loop.ts");
  const ranked = rankLearningPlan([
    { id: "normal", kind: "assignment", dueAt: "2026-08-20T00:00:00.000Z" },
    { id: "family", kind: "family", dueAt: "2026-08-01T09:00:00.000Z" },
    { id: "review", kind: "review", dueAt: "2026-08-01T09:00:00.000Z" },
    { id: "teacher", kind: "teacher", dueAt: "2026-08-10T00:00:00.000Z" },
    { id: "urgent", kind: "assignment", dueAt: "2026-08-02T00:00:00.000Z" },
  ], new Date("2026-08-01T00:00:00.000Z"));
  assert.deepEqual(ranked.map((item) => item.id), ["teacher", "review", "family"]);
});

test("assignment rubric requires exactly three dimensions totaling 100", async () => {
  const { validateRubric } = await importTypeScript("app/lib/learning-loop.ts");
  assert.deepEqual(validateRubric([
    { name: "内容准确", weight: 40 },
    { name: "表达完整", weight: 40 },
    { name: "文化理解", weight: 20 },
  ]), [
    { name: "内容准确", weight: 40 },
    { name: "表达完整", weight: 40 },
    { name: "文化理解", weight: 20 },
  ]);
  assert.throws(() => validateRubric([{ name: "内容", weight: 100 }]), /invalid_rubric/);
  assert.throws(() => validateRubric([
    { name: "内容", weight: 40 },
    { name: "表达", weight: 40 },
    { name: "文化", weight: 30 },
  ]), /invalid_rubric/);
});

test("learning loop schema and additive migration include durable tenant-scoped state", async () => {
  const [schema, runtime, migration] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("app/lib/platform-store.ts", root), "utf8"),
    readFile(new URL("drizzle/0004_learning_loop.sql", root), "utf8"),
  ]);
  for (const table of ["diagnostic_items", "diagnostic_attempts", "diagnostic_answers", "learning_recommendations"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(runtime, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  assert.match(migration, /ALTER TABLE `assignments` ADD `rubric_json`/);
  assert.match(migration, /ALTER TABLE `learning_objectives` ADD `status`/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/i);
});
