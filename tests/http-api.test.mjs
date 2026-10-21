import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { createApiApp } from './server/app';
    export { NodeSqliteDatabase, LocalFileStorage } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema } from './lib/platform-store';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const password = "FixturePassword123";
const newPassword = "ChangedPassword456";

async function fixture(t, setup = true) {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-http-api-"));
  const db = new api.NodeSqliteDatabase("file::memory:");
  const storage = new api.LocalFileStorage(directory);
  api.setPlatformRuntime({ kind: "node", database: db, storage });
  const app = api.createApiApp();
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (path, { method = "GET", cookie, json, headers = {} } = {}) => app.fetch(new Request(`http://127.0.0.1${path}`, {
    method, headers: { ...headers, ...(cookie ? { cookie } : {}), ...(json === undefined ? {} : { "content-type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  }));
  const json = async (path, options, expectedStatus = 200) => {
    const response = await request(path, options);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/, path);
    const data = await response.json();
    assert.equal(response.status, expectedStatus, JSON.stringify({ path, data }));
    return { response, data };
  };
  const createSetup = async () => {
    const result = await json("/api/v1/auth/setup", { method: "POST", json: { email: "admin@http.example", password, displayName: "管理员", workspaceName: "青禾语言学校" } });
    return { ...result, cookie: result.response.headers.get("set-cookie").split(";")[0] };
  };
  const admin = setup ? await createSetup() : undefined;
  const act = async (cookie, action, payload = {}, expectedStatus = 200) => json("/api/v1/workspace/actions", { method: "POST", cookie, json: { action, ...payload } }, expectedStatus);
  const login = async (email) => {
    const result = await json("/api/v1/auth/login", { method: "POST", json: { email, password } });
    return { ...result, cookie: result.response.headers.get("set-cookie").split(";")[0] };
  };
  const member = async (role, email = `${role}@http.example`) => {
    const { data } = await act(admin.cookie, "create_member", { email, displayName: role, role, temporaryPassword: password }, 201);
    const session = await login(email);
    return { ...session, id: data.id };
  };
  const changePassword = async (member) => {
    const result = await json("/api/v1/auth/change-password", { method: "POST", cookie: member.cookie, json: { currentPassword: password, newPassword } });
    member.cookie = result.response.headers.get("set-cookie").split(";")[0];
    return result;
  };
  return { db, storage, request, json, createSetup, admin, act, login, member, changePassword };
}

test("Hono setup, login and logout preserve cookies, a real institution name and admin-only first account", async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.json("/api/v1/auth/session")).data.setupRequired, true);
  const admin = await f.createSetup();
  assert.deepEqual(admin.data.user.roles, ["admin"]);
  assert.match(admin.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(admin.response.headers.get("set-cookie"), /SameSite=Lax/);
  const { data: workspace } = await f.json("/api/v1/workspace?include=bootstrap", { cookie: admin.cookie });
  assert.deepEqual(workspace.user.roles, ["admin"]);
  assert.equal(workspace.workspace.name, "青禾语言学校");
  assert.equal(workspace.workspace.region, "");
  assert.equal("sampleData" in workspace.workspace, false);
  assert.equal("assignments" in workspace, false);
  assert.deepEqual((await f.db.prepare("SELECT role FROM role_memberships").all()).results.map((item) => item.role), ["admin"]);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 1);
  await f.json("/api/v1/auth/setup", { method: "POST", json: { email: "other@http.example", password } }, 409);
  const loggedIn = await f.login("admin@http.example");
  assert.equal((await f.json("/api/v1/auth/session", { cookie: loggedIn.cookie })).data.authenticated, true);
  const logout = await f.json("/api/v1/auth/logout", { method: "POST", cookie: loggedIn.cookie });
  assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await f.json("/api/v1/auth/session")).data.authenticated, false);
});

test("Hono API paths return JSON for unsupported methods and unknown routes", async (t) => {
  const f = await fixture(t, false);
  const unknown = await f.json("/api/v1/does-not-exist", undefined, 404);
  assert.deepEqual(unknown.data, { error: "not_found" });
  const method = await f.json("/api/v1/auth/login", undefined, 405);
  assert.deepEqual(method.data, { error: "method_not_allowed" });
  await f.json("/api/v1/workspace", { method: "DELETE" }, 405);
});

test("all protected public API paths remain registered behind authentication", async (t) => {
  const f = await fixture(t);
  const endpoints = [
    ["GET", "/ability-profile"], ["POST", "/ai/generate"], ["POST", "/auth/change-password"],
    ["POST", "/content/upload"], ["GET", "/diagnostic-media/fixture-id"], ["POST", "/diagnostic-media"],
    ["GET", "/family-feedback"], ["POST", "/family-feedback"], ["GET", "/family-portfolio"],
    ["POST", "/feedback"], ["POST", "/knowledge/search"], ["GET", "/learning-sequences/fixture-id/report"],
    ["GET", "/settings"], ["POST", "/settings"], ["POST", "/speech/submissions"],
    ["GET", "/student-cases"], ["GET", "/submissions/fixture-id/audio"], ["POST", "/submissions"],
    ["GET", "/teaching-followups"], ["GET", "/trial-batches/fixture-id/report"], ["GET", "/trial-batches/fixture-id"],
    ["GET", "/trial-batches"], ["POST", "/trial-batches"], ["GET", "/trial-records/report"],
    ["POST", "/workspace/actions"], ["GET", "/workspace/audits"], ["GET", "/workspace"],
  ];
  for (const [method, path] of endpoints) {
    const response = await f.request(`/api/v1${path}`, { method, ...(method === "POST" ? { json: { action: "create_class" } } : {}) });
    assert.equal(response.status, 401, `${method} ${path}`);
    if (path.endsWith("/report")) assert.match(response.headers.get("content-type"), /text\/html/, path);
    else assert.deepEqual(await response.json(), { error: "authentication_required" }, `${method} ${path}`);
  }
});

test("Hono setup validates institution names before writing and defaults to neutral metadata", async (t) => {
  const f = await fixture(t, false);
  for (const workspaceName of [42, null, {}, "长".repeat(121)]) {
    await f.json("/api/v1/auth/setup", { method: "POST", json: { email: "admin@http.example", password, workspaceName } }, 400);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
  }
  const { response } = await f.json("/api/v1/auth/setup", { method: "POST", json: { email: "admin@http.example", password } });
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const { data } = await f.json("/api/v1/workspace?include=bootstrap", { cookie });
  assert.equal(data.workspace.name, "我的工作区");
  assert.equal(data.workspace.region, "");
});

test("Hono workspace partitions preserve password, account-role and object authorization gates", async (t) => {
  const f = await fixture(t);
  await f.json("/api/v1/workspace?include=bootstrap", undefined, 401);
  const student = await f.member("student");
  assert.equal(student.data.user.mustChangePassword, true);
  const blocked = await f.json("/api/v1/workspace?include=bootstrap", { cookie: student.cookie }, 403);
  assert.deepEqual(blocked.data, { error: "password_change_required" });
  await f.changePassword(student);
  const { data } = await f.json("/api/v1/workspace?include=teaching,notifications", { cookie: student.cookie });
  assert.deepEqual(data.user.roles, ["student"]);
  assert.deepEqual(data.classes, []);
  assert.deepEqual(data.notifications, []);
  assert.equal("members" in data, false);
  assert.equal("services" in data, false);
  await f.json("/api/v1/settings", { cookie: student.cookie }, 403);
  await f.act(student.cookie, "create_class", { name: "越权班级", level: "A2" }, 403);
  await f.json("/api/v1/workspace?include=unknown", { cookie: f.admin.cookie }, 400);
  await f.db.prepare("UPDATE role_memberships SET status='disabled' WHERE user_id=?").bind(student.id).run();
  assert.deepEqual((await f.json("/api/v1/workspace?include=bootstrap", { cookie: student.cookie }, 403)).data, { error: "account_access_denied" });
});

test("Hono dynamic id routes pass parameters and retain owner, tenant and media-range restrictions", async (t) => {
  const f = await fixture(t);
  const student = await f.member("student");
  const other = await f.member("student", "other-student@http.example");
  await f.changePassword(student);
  await f.changePassword(other);
  const tenantId = (await f.db.prepare("SELECT tenant_id AS id FROM role_memberships WHERE user_id=?").bind(student.id).first()).id;
  const adminId = (await f.db.prepare("SELECT id FROM users WHERE email='admin@http.example'").first()).id;
  const assetKey = `${tenantId}/submissions/recording/audio.webm`;
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  await f.storage.put(assetKey, new Blob([bytes]).stream(), { httpMetadata: { contentType: "audio/webm" }, customMetadata: { tenantId, studentUserId: student.id } });
  await f.db.batch([
    f.db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('http-class',?,'本班','A2',?,'2026')").bind(tenantId, adminId),
    f.db.prepare("INSERT INTO assignments(id,tenant_id,class_id,title,activity_type,status,created_by) VALUES ('http-assignment',?,'http-class','口述','口述','published','admin')").bind(tenantId),
    f.db.prepare("INSERT INTO submissions(id,tenant_id,assignment_id,student_user_id,asset_key) VALUES ('http-recording',?,'http-assignment',?,?)").bind(tenantId, student.id, assetKey),
  ]);
  const audio = await f.request("/api/v1/submissions/http-recording/audio", { cookie: student.cookie });
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/webm");
  assert.deepEqual(new Uint8Array(await audio.arrayBuffer()), bytes);
  const range = await f.request("/api/v1/submissions/http-recording/audio", { cookie: student.cookie, headers: { range: "bytes=1-3" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 1-3/5");
  assert.deepEqual(new Uint8Array(await range.arrayBuffer()), new Uint8Array([2, 3, 4]));
  await f.json("/api/v1/submissions/http-recording/audio", undefined, 401);
  await f.json("/api/v1/submissions/http-recording/audio", { cookie: other.cookie }, 404);
  await f.json("/api/v1/submissions/does-not-exist/audio", { cookie: student.cookie }, 404);
  await f.db.prepare("INSERT INTO tenants(id,name) VALUES ('http-foreign','其他学校')").run();
  await f.db.prepare("UPDATE role_memberships SET tenant_id='http-foreign' WHERE user_id=?").bind(student.id).run();
  await f.json("/api/v1/submissions/http-recording/audio", { cookie: student.cookie }, 404);
  await f.json("/api/v1/trial-batches/does-not-exist", { cookie: f.admin.cookie }, 404);
});
