import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ships the Wenqu multi-role product instead of the starter", async () => {
  const [page, layout, dashboard, student, staff, packageJson] = await Promise.all([
    read("app/page.tsx"), read("app/layout.tsx"), read("app/dashboard.tsx"), read("app/student-view.tsx"), read("app/staff-views.tsx"), read("package.json"),
  ]);
  assert.match(layout, /文趣 · 华文趣味教学助手/);
  assert.match(page, /<Dashboard/);
  assert.match(dashboard, /student.*teacher.*guardian.*admin/s);
  assert.match(student, /早上好，小语/);
  assert.match(student, /发音得分/);
  assert.match(staff, /AI 备课助手/);
  assert.match(staff, /知识库发布管线/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("defines tenant-scoped durable data and production bindings", async () => {
  const [schema, migration, hosting] = await Promise.all([read("db/schema.ts"), read("drizzle/0000_dusty_mesmero.sql"), read(".openai/hosting.json")]);
  assert.match(schema, /tenantId: text\("tenant_id"\)/);
  assert.match(schema, /consentRecords/);
  assert.match(schema, /auditLogs/);
  assert.equal((migration.match(/CREATE TABLE/g) ?? []).length, 18);
  assert.deepEqual(JSON.parse(hosting), { d1: "DB", r2: "CONTENT" });
});

test("exposes versioned AI, knowledge, upload, submission and health APIs", async () => {
  const [generate, search, upload, submission, health] = await Promise.all([
    read("app/api/v1/ai/generate/route.ts"), read("app/api/v1/knowledge/search/route.ts"), read("app/api/v1/content/upload/route.ts"), read("app/api/v1/submissions/route.ts"), read("app/api/v1/health/route.ts"),
  ]);
  assert.match(generate, /text\/event-stream/);
  assert.match(generate, /moderate/);
  assert.match(search, /keyword\+vector\+rerank/);
  assert.match(upload, /rightsStatus/);
  assert.match(submission, /human_review/);
  assert.match(health, /region: "sg"/);
  await access(new URL("dist/server/index.js", root));
});