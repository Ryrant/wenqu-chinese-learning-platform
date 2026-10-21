import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { createApiApp } from './server/app';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
    export { createSessionToken } from './lib/auth-token';
    export { assertDiagnosticMedia } from './lib/diagnostic-media';
    export { contentProcessingError } from './lib/content-processing';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function fixture(t) {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const db = new api.NodeSqliteDatabase("file::memory:");
  const objects = new Map();
  let rejectDelete = false, rejectPut = false;
  const storage = {
    async put(key, body, options) {
      objects.set(key, { bytes: await new Response(body).arrayBuffer(), ...options });
      if (rejectPut) throw new Error("fixture_partial_storage_failure");
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { body: new Blob([object.bytes]).stream(), customMetadata: object.customMetadata, httpMetadata: object.httpMetadata } : null;
    },
    async delete(key) {
      if (rejectDelete) throw new Error("fixture_delete_failure");
      objects.delete(key);
    },
  };
  api.setPlatformRuntime({ kind: "node", database: db, storage });
  t.after(() => { db.close(); if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv; });
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','上传测试机构')"),
    db.prepare("INSERT INTO users(id,email,display_name) VALUES ('admin','admin@upload.example.test','管理员')"),
    db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES ('school','admin','admin')"),
  ]);
  const secret = await api.ensureSiteJwtSecret(db), now = Math.floor(Date.now() / 1000);
  const token = await api.createSessionToken({ email: "admin@upload.example.test", displayName: "管理员", iat: now, exp: now + 3600 }, secret);
  const app = api.createApiApp(), headers = { cookie: `huawen_zhixing_session=${token}` };
  const request = (path, init = {}) => app.fetch(new Request(`http://127.0.0.1/api/v1/${path}`, { headers, ...init }));
  const upload = (kind = "content", file = new File(["合法教学材料，说明人物、动作和情节。"], "story.txt", { type: "text/plain" })) => {
    const form = new FormData(); form.set("file", file);
    if (kind === "image") form.set("kind", "image");
    return request(kind === "image" ? "diagnostic-media" : "content/upload", { method: "POST", body: form });
  };
  const image = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], "fixture.png", { type: "image/png" });
  const rejectAudit = (action) => db.prepare(`CREATE TRIGGER reject_upload_audit BEFORE INSERT ON audit_logs WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'fixture_audit_failure'); END`).run();
  const count = async (table) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  const context = { db, tenantId: "school", userId: "admin", roles: ["admin"] };
  return { db, objects, upload, image, rejectAudit, count, request, context, rejectDelete: () => { rejectDelete = true; }, rejectPut: () => { rejectPut = true; } };
}

test("合法资料的数据库故障不伪装为格式错误，回滚对象且重试只保存一次", async (t) => {
  const f = await fixture(t);
  await f.rejectAudit("source.processed");
  const failed = await f.upload();
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "fixture_audit_failure" });
  for (const table of ["source_documents", "knowledge_chunks", "audit_logs"]) assert.equal(await f.count(table), 0);
  assert.equal(f.objects.size, 0);
  await f.db.prepare("DROP TRIGGER reject_upload_audit").run();
  const retry = await f.upload();
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).status, "processed");
  for (const table of ["source_documents", "knowledge_chunks", "audit_logs"]) assert.equal(await f.count(table), 1);
  assert.equal(f.objects.size, 1);
});

test("已知提取错误保留原件及真实原因，失败状态落库也必须与审计共同提交", async (t) => {
  const f = await fixture(t);
  const empty = () => new File(["   "], "empty.txt", { type: "text/plain" });
  await f.rejectAudit("source.uploaded");
  const refused = await f.upload("content", empty());
  assert.equal(refused.status, 500);
  assert.equal(await f.count("source_documents"), 0);
  assert.equal(f.objects.size, 0);
  await f.db.prepare("DROP TRIGGER reject_upload_audit").run();
  const response = await f.upload("content", empty());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).error, "empty_text");
  const saved = await f.db.prepare("SELECT processing_status,processing_error FROM source_documents").first();
  assert.deepEqual(saved, { processing_status: "failed", processing_error: "empty_text" });
  assert.equal(f.objects.size, 1);
  assert.equal(await f.count("knowledge_chunks"), 0);
  assert.equal(await f.count("audit_logs"), 1);
  assert.equal(api.contentProcessingError(new Error("fixture_unexpected_runtime_failure")), null);
});

test("损坏DOCX保留为已知文件错误，不把意外异常降级为文件错误", async (t) => {
  const f = await fixture(t);
  const response = await f.upload("content", new File(["not zip"], "broken.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).error, "unsupported_file_type");
  assert.equal(await f.count("source_documents"), 1);
});

test("诊断素材审计失败删除对象，正常重试可读取且有完成审计", async (t) => {
  const f = await fixture(t);
  await f.rejectAudit("diagnostic_media.created");
  assert.equal((await f.upload("image", f.image())).status, 500);
  assert.equal(f.objects.size, 0);
  assert.equal(await f.count("audit_logs"), 0);
  await f.db.prepare("DROP TRIGGER reject_upload_audit").run();
  const response = await f.upload("image", f.image());
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await f.request(`diagnostic-media/${id}`)).status, 200);
  await api.assertDiagnosticMedia(f.context, id, "image");
  assert.equal(await f.count("audit_logs"), 1);
});

test("清理故障有明确失败，遗留的未提交素材不能读取或挂到任务", async (t) => {
  const f = await fixture(t);
  await f.rejectAudit("diagnostic_media.created"); f.rejectDelete();
  const response = await f.upload("image", f.image());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "upload_cleanup_failed" });
  assert.equal(f.objects.size, 1);
  const id = [...f.objects.keys()][0].split("/").at(-1);
  assert.equal((await f.request(`diagnostic-media/${id}`)).status, 404);
  await assert.rejects(api.assertDiagnosticMedia(f.context, id, "image"), /invalid_diagnostic_media/);
  assert.equal(await f.count("audit_logs"), 0);
});

for (const kind of ["content", "image"]) {
  test(`${kind}存储部分写入后失败也清理本次对象`, async (t) => {
    const f = await fixture(t); f.rejectPut();
    const response = await f.upload(kind, kind === "image" ? f.image() : undefined);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "fixture_partial_storage_failure" });
    assert.equal(f.objects.size, 0);
    assert.equal(await f.count("audit_logs"), 0);
    assert.equal(await f.count("source_documents"), 0);
  });
}
