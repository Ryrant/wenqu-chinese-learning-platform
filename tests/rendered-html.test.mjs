import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("all four role workspaces expose real operations instead of timer shells", async () => {
  const [dashboard, student, staff] = await Promise.all([read("app/dashboard.tsx"), read("app/student-view.tsx"), read("app/staff-views.tsx")]);
  assert.match(dashboard, /student.*teacher.*guardian.*admin/s);
  assert.match(dashboard, /\/api\/v1\/workspace/);
  assert.match(student, /MediaRecorder/);
  assert.match(student, /\/api\/v1\/speech\/submissions/);
  assert.match(student, /submit_text/);
  assert.match(staff, /generate_lesson/);
  assert.match(staff, /create_class/);
  assert.match(staff, /create_invitation/);
  assert.match(staff, /review_content/);
  assert.doesNotMatch(`${student}\n${staff}`, /setTimeout\([^)]*92|setScore\(92|主服务商 A|全部正常/);
});

test("defines tenant-scoped durable data, migrations and production bindings", async () => {
  const [schema, firstMigration, secondMigration, hosting, store] = await Promise.all([
    read("db/schema.ts"), read("drizzle/0000_dusty_mesmero.sql"), read("drizzle/0001_condemned_lester.sql"), read(".openai/hosting.json"), read("app/lib/platform-store.ts"),
  ]);
  assert.match(schema, /tenantId: text\("tenant_id"\)/);
  assert.match(schema, /lessonPlans/);
  assert.match(schema, /notifications/);
  assert.match(schema, /invitations/);
  assert.equal((`${firstMigration}\n${secondMigration}`.match(/CREATE TABLE/g) ?? []).length, 21);
  const bindings = JSON.parse(hosting);
  assert.equal(bindings.d1, "DB"); assert.equal(bindings.r2, "CONTENT"); assert.ok(bindings.project_id);
  assert.match(store, /oai-authenticated-user-email/);
  assert.match(store, /requiredRole/);
  assert.doesNotMatch(store, /demo-admin|tenantId = "demo/);
});

test("versioned APIs enforce tenant scope, honest provider state and review fallbacks", async () => {
  const [generate, search, upload, speech, actions, health] = await Promise.all([
    read("app/api/v1/ai/generate/route.ts"), read("app/api/v1/knowledge/search/route.ts"), read("app/api/v1/content/upload/route.ts"), read("app/api/v1/speech/submissions/route.ts"), read("app/api/v1/workspace/actions/route.ts"), read("app/api/v1/health/route.ts"),
  ]);
  assert.match(generate, /text\/event-stream/); assert.match(generate, /source-grounded-template/); assert.match(generate, /citations/);
  assert.match(search, /tenant_id=\?/); assert.match(search, /processing_status='published'/);
  assert.match(upload, /bucket\.put/); assert.match(upload, /rightsStatus/);
  assert.match(speech, /human_review/); assert.match(speech, /R2Bucket|CONTENT/);
  assert.match(actions, /WHERE id=\? AND tenant_id=\?/); assert.match(actions, /audit_logs/);
  assert.match(health, /not_configured_manual_review/); assert.doesNotMatch(health, /99\.9|healthy/);
  await access(new URL("dist/server/index.js", root));
});

test("standard auth token helpers use Web Crypto without new dependencies", async () => {
  const token = await read("app/lib/auth-token.ts");
  const pkg = JSON.parse(await read("package.json"));
  assert.match(token, /export type StandardSession/);
  assert.match(token, /export const sessionCookieName = "wenqu_session"/);
  assert.match(token, /export async function createSessionToken/);
  assert.match(token, /export async function verifySessionToken/);
  assert.match(token, /crypto\.subtle\.sign/);
  assert.match(token, /crypto\.subtle\.verify/);
  assert.doesNotMatch(JSON.stringify(pkg.dependencies), /jose|jsonwebtoken/);
});
