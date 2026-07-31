import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
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

async function importBundledTypeScript(path) {
  const result = await build({
    entryPoints: [new URL(path, root).pathname],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
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

test("diagnostic submission must match the complete active item set", async () => {
  const { matchesDiagnosticItemSet } = await importTypeScript("app/lib/learning-loop.ts");
  assert.equal(matchesDiagnosticItemSet(["a", "b"], ["b", "a"]), true);
  assert.equal(matchesDiagnosticItemSet(["a", "b"], ["a"]), false);
  assert.equal(matchesDiagnosticItemSet(["a", "b"], ["a", "b", "c"]), false);
  assert.equal(matchesDiagnosticItemSet(["a", "b"], ["a", "a"]), false);
});

test("diagnostic service rejects a partial level questionnaire before writing evidence", async () => {
  const { submitDiagnostic } = await importBundledTypeScript("app/lib/learning-loop-service.ts");
  let writes = 0;
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          assert.match(sql, /FROM diagnostic_items/);
          return {
            results: [
              { id: "a", objectiveId: "listen", prompt: "A", correctOption: 0 },
              { id: "b", objectiveId: "speak", prompt: "B", correctOption: 1 },
            ],
          };
        },
        async run() { writes += 1; return { meta: { changes: 1 } }; },
      };
    },
    async batch() { writes += 1; },
  };
  await assert.rejects(
    submitDiagnostic(db, { tenantId: "tenant", userId: "student", roles: ["student"] }, {
      level: "A2",
      answers: [{ itemId: "a", selectedOption: 0 }],
    }),
    /invalid_diagnostic_answers/,
  );
  assert.equal(writes, 0);
});

test("review service enforces next-day due time and blocks generic diagnostic completion", async () => {
  const { answerReviewItem, updateRecommendationStatus } = await importBundledTypeScript("app/lib/learning-loop-service.ts");
  const context = { tenantId: "tenant", userId: "student", roles: ["student"] };
  const futureDb = {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          return { id: "review", objectiveId: "listen", dueAt: "2999-01-01T00:00:00.000Z", correctOption: 0 };
        },
      };
    },
  };
  await assert.rejects(answerReviewItem(futureDb, context, { recommendationId: "review", selectedOption: 0 }), /review_not_due/);

  const diagnosticDb = {
    prepare() {
      return {
        bind() { return this; },
        async first() {
          return { id: "review", studentUserId: "student", sourceType: "diagnostic", createdBy: "student" };
        },
      };
    },
  };
  await assert.rejects(updateRecommendationStatus(diagnosticDb, context, { id: "review", status: "completed" }), /forbidden/);
});

test("teacher confirmation retry does not write a second mastery update", async () => {
  const { confirmSubmissionReview } = await importBundledTypeScript("app/lib/assessment-service.ts");
  let queryCount = 0;
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async run() {
          assert.match(sql, /review_status!='reviewed'/);
          return { meta: { changes: 0 } };
        },
        async all() { queryCount += 1; return { results: [] }; },
      };
    },
  };
  await assert.rejects(
    confirmSubmissionReview(db, { tenantId: "tenant", userId: "teacher", roles: ["admin"] }, {
      submissionId: "submission",
      score: 90,
      comment: "很好",
    }),
    /submission_already_reviewed/,
  );
  assert.equal(queryCount, 0);
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

test("review items become answerable only when their due time arrives", async () => {
  const { isRecommendationDue } = await importTypeScript("app/lib/learning-loop.ts");
  const now = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(isRecommendationDue(null, now), true);
  assert.equal(isRecommendationDue("2026-07-31T23:59:59.000Z", now), true);
  assert.equal(isRecommendationDue("2026-08-02T00:00:00.000Z", now), false);
  assert.equal(isRecommendationDue("not-a-date", now), false);
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
  const [schema, runtime, migration, wrangler] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("app/lib/platform-store.ts", root), "utf8"),
    readFile(new URL("drizzle/0004_learning_loop.sql", root), "utf8"),
    readFile(new URL("wrangler.toml", root), "utf8"),
  ]);
  for (const table of ["diagnostic_items", "diagnostic_attempts", "diagnostic_answers", "learning_recommendations"]) {
    assert.match(schema, new RegExp(`sqliteTable\\("${table}"`));
    assert.match(runtime, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`CREATE TABLE \`${table}\``));
  }
  assert.match(migration, /ALTER TABLE `assignments` ADD `rubric_json`/);
  assert.match(migration, /UPDATE `assignments` SET `rubric_json`/);
  assert.match(migration, /ALTER TABLE `learning_objectives` ADD `status`/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/i);
  assert.match(wrangler, /migrations_dir = "drizzle"/);
});
