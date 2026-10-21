import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Log, LogLevel, Miniflare } from "miniflare";
import { existingDatabaseUpgradeStatements } from "../scripts/existing-database-upgrade.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const password = "FixturePassword123";

async function fixture(t) {
  const parent = path.join(root, "work");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "cloudflare-boundaries-"));
  const output = path.join(directory, "worker.mjs");
  await build({ entryPoints: [path.join(root, "worker/index.ts")], outfile: output,
    bundle: true, platform: "browser", format: "esm", target: "es2022", logLevel: "error", external: ["node:*"],
    define: { "process.env.NODE_ENV": '"production"' } });
  const runtime = new Miniflare({ modules: [{ type: "ESModule", path: output }],
    compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"], r2Buckets: ["CONTENT"],
    host: "127.0.0.1", port: 0, log: new Log(LogLevel.NONE) });
  t.after(async () => {
    await runtime.dispose();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(parent), "只清理本次测试的临时目录");
    await rm(directory, { recursive: true, force: true });
  });
  const db = await runtime.getD1Database("DB");
  const bucket = await runtime.getR2Bucket("CONTENT");
  const request = async (endpoint, { method = "GET", cookie, json, body } = {}) => {
    // 先按标准 Request 序列化 multipart，避免 Node 与 Miniflare 的 FormData 类型不同。
    const input = new Request(`http://127.0.0.1${endpoint}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(json === undefined ? {} : { "content-type": "application/json" }) },
      body: json === undefined ? body : JSON.stringify(json),
    });
    return runtime.dispatchFetch(input.url, { method: input.method, headers: Object.fromEntries(input.headers),
      ...(input.body ? { body: await input.arrayBuffer() } : {}) });
  };
  const expectJson = async (endpoint, options, status = 200) => {
    const response = await request(endpoint, options); const data = await response.json();
    assert.equal(response.status, status, JSON.stringify({ endpoint, data }));
    return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const setup = (email = "admin@workerd.example.test") => request("/api/v1/auth/setup", { method: "POST", json: {
    email, password, displayName: "虚构管理员", workspaceName: "Workerd 虚构机构",
  } });
  const bootstrap = async () => {
    const response = await setup(); assert.equal(response.status, 200, await response.clone().text());
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const identity = await db.prepare("SELECT u.id,u.email,rm.tenant_id AS tenantId FROM users u JOIN role_memberships rm ON rm.user_id=u.id WHERE rm.role='admin'").first();
    return { cookie, ...identity };
  };
  const action = (cookie, action, payload = {}, status = 200) => expectJson("/api/v1/workspace/actions", { method: "POST", cookie, json: { action, ...payload } }, status);
  return { db, bucket, request, expectJson, setup, bootstrap, action };
}

const count = async (db, table) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
const objectKeys = async (bucket) => (await bucket.list()).objects.map((object) => object.key).sort();
const activeStudents = async (db, classId) => (await db.prepare("SELECT student_user_id AS id FROM enrollments WHERE class_id=? AND status='active' ORDER BY student_user_id").bind(classId).all()).results.map((row) => row.id);

test("真实 Workerd/D1 并发首管只有一个胜者，一次性升级审计失败时 DDL、授权与标记全部回滚", async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([f.setup("first@workerd.example.test"), f.setup("second@workerd.example.test")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await count(f.db, "users"), 1); assert.equal(await count(f.db, "tenants"), 1);
  assert.equal(await count(f.db, "role_memberships"), 1);
  const account = await f.db.prepare("SELECT u.id,u.email,rm.tenant_id AS tenantId FROM users u JOIN role_memberships rm ON rm.user_id=u.id").first();
  assert.equal(account.tenantId, `tenant_${account.id.slice(4)}`);
  await f.db.batch([
    ...["student", "teacher", "guardian"].map((role) => f.db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,?)").bind(account.tenantId, account.id, role)),
    f.db.prepare("INSERT INTO notifications(id,tenant_id,user_id,title,detail) VALUES (?,?,?,'旧演示欢迎','虚构数据')").bind(`${account.tenantId}-notice-welcome`, account.tenantId, account.id),
    f.db.prepare("INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES ('explicit-teacher',?,?,'member.created','user',?,?)").bind(account.tenantId, account.id, account.id, JSON.stringify({ role: "teacher" })),
    f.db.prepare("ALTER TABLE users DROP COLUMN session_version"),
    f.db.prepare("CREATE TRIGGER reject_upgrade_audit BEFORE INSERT ON audit_logs WHEN NEW.action='auth.legacy_demo_role_removed' BEGIN SELECT RAISE(ABORT,'fixture_upgrade_audit_failure'); END"),
  ]);
  const statements = await existingDatabaseUpgradeStatements({ missingSessionVersion: true });
  await assert.rejects(f.db.batch(statements.map((statement) => f.db.prepare(statement))), /fixture_upgrade_audit_failure/);
  assert.equal((await f.db.prepare("PRAGMA table_info(users)").all()).results.some((column) => column.name === "session_version"), false);
  assert.equal(await count(f.db, "role_memberships"), 4);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key IN ('role_isolation_v1','existing_database_upgrade_v1')").first()).count, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action IN ('auth.session_version_added','auth.legacy_demo_role_removed')").first()).count, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='_existing_database_upgrade_guard_v1'").first()).count, 0);

  await f.db.prepare("DROP TRIGGER reject_upgrade_audit").run();
  await f.db.batch(statements.map((statement) => f.db.prepare(statement)));
  assert.equal((await f.db.prepare("SELECT session_version FROM users").first()).session_version, 0);
  assert.deepEqual((await f.db.prepare("SELECT role FROM role_memberships ORDER BY role").all()).results.map((row) => row.role), ["admin", "teacher"]);
  const login = await f.expectJson("/api/v1/auth/login", { method: "POST", json: { email: account.email, password } });
  const workspace = await f.expectJson("/api/v1/workspace?include=bootstrap", { cookie: login.cookie });
  assert.deepEqual(new Set(workspace.data.user.roles), new Set(["admin", "teacher"]));
  const auditCount = await count(f.db, "audit_logs");
  await f.db.batch((await existingDatabaseUpgradeStatements({ missingSessionVersion: false })).map((statement) => f.db.prepare(statement)));
  assert.equal(await count(f.db, "audit_logs"), auditCount);
});

test("真实 Workerd/D1/R2 上传审计失败删除孤立对象，不留下伪失败资料；重试后素材可读取", async (t) => {
  const f = await fixture(t); const admin = await f.bootstrap();
  const content = "这是用于真实 Workerd 存储事务验证的虚构教材，孩子介绍自己的家庭故事，教师核对目标和作品。";
  const uploadSource = () => {
    const form = new FormData(); form.set("file", new File([content], "fixture.txt", { type: "text/plain" })); form.set("rightsStatus", "owned");
    return f.expectJson("/api/v1/content/upload", { method: "POST", cookie: admin.cookie, body: form }, 500);
  };
  await f.db.prepare("CREATE TRIGGER reject_source_audit BEFORE INSERT ON audit_logs WHEN NEW.action='source.processed' BEGIN SELECT RAISE(ABORT,'fixture_source_audit_failure'); END").run();
  await uploadSource();
  assert.deepEqual(await objectKeys(f.bucket), []);
  assert.equal(await count(f.db, "source_documents"), 0); assert.equal(await count(f.db, "knowledge_chunks"), 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action IN ('source.processed','source.uploaded')").first()).count, 0);
  await f.db.prepare("DROP TRIGGER reject_source_audit").run();
  const sourceForm = new FormData(); sourceForm.set("file", new File([content], "fixture.txt", { type: "text/plain" })); sourceForm.set("rightsStatus", "owned");
  const uploaded = await f.expectJson("/api/v1/content/upload", { method: "POST", cookie: admin.cookie, body: sourceForm }, 201);
  assert.equal(uploaded.data.status, "processed");
  const source = await f.db.prepare("SELECT processing_status,object_key FROM source_documents WHERE id=?").bind(uploaded.data.id).first();
  assert.equal(source.processing_status, "processed"); assert.equal(await (await f.bucket.get(source.object_key)).text(), content);
  assert.ok(await count(f.db, "knowledge_chunks") > 0);
  const sourceKeys = await objectKeys(f.bucket);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=", "base64");
  const mediaForm = () => { const form = new FormData(); form.set("kind", "image"); form.set("file", new File([png], "fixture.png", { type: "image/png" })); return form; };
  await f.db.prepare("CREATE TRIGGER reject_media_audit BEFORE INSERT ON audit_logs WHEN NEW.action='diagnostic_media.created' BEGIN SELECT RAISE(ABORT,'fixture_media_audit_failure'); END").run();
  await f.expectJson("/api/v1/diagnostic-media", { method: "POST", cookie: admin.cookie, body: mediaForm() }, 500);
  assert.deepEqual(await objectKeys(f.bucket), sourceKeys);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='diagnostic_media.created'").first()).count, 0);
  await f.db.prepare("DROP TRIGGER reject_media_audit").run();
  const media = await f.expectJson("/api/v1/diagnostic-media", { method: "POST", cookie: admin.cookie, body: mediaForm() }, 201);
  const result = await f.request(`/api/v1/diagnostic-media/${media.data.id}`, { cookie: admin.cookie });
  assert.equal(result.status, 200); assert.equal(result.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array(png));
  assert.equal((await objectKeys(f.bucket)).length, sourceKeys.length + 1);
});

test("真实 Workerd/D1 编班 CAS 并发只有一个胜者，审计失败保持原名单且可重试", async (t) => {
  const f = await fixture(t); const admin = await f.bootstrap();
  const students = [];
  for (const name of ["student-a", "student-b"]) {
    const result = await f.action(admin.cookie, "create_member", { email: `${name}@workerd.example.test`, displayName: name, role: "student", temporaryPassword: password }, 201);
    students.push(result.data.id);
  }
  const classroom = (await f.action(admin.cookie, "create_class", { name: "虚构班级", level: "A2" }, 201)).data.id;
  await f.action(admin.cookie, "set_class_enrollments", { classId: classroom, studentUserIds: [students[0]], expectedStudentUserIds: [] });
  const choices = [[students[1]], []];
  const results = await Promise.all(choices.map((studentUserIds) => f.request("/api/v1/workspace/actions", { method: "POST", cookie: admin.cookie,
    json: { action: "set_class_enrollments", classId: classroom, studentUserIds, expectedStudentUserIds: [students[0]] } })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.deepEqual(await activeStudents(f.db, classroom), choices[results.findIndex((result) => result.status === 200)]);
  const before = (await f.db.prepare("SELECT * FROM enrollments ORDER BY id").all()).results;
  const baseline = await activeStudents(f.db, classroom);
  const audits = await count(f.db, "audit_logs");
  await f.db.prepare("CREATE TRIGGER reject_enrollment_audit BEFORE INSERT ON audit_logs WHEN NEW.action='class.enrollments_updated' BEGIN SELECT RAISE(ABORT,'fixture_enrollment_audit_failure'); END").run();
  await f.action(admin.cookie, "set_class_enrollments", { classId: classroom, studentUserIds: [students[0]], expectedStudentUserIds: baseline }, 500);
  assert.deepEqual((await f.db.prepare("SELECT * FROM enrollments ORDER BY id").all()).results, before);
  assert.equal(await count(f.db, "audit_logs"), audits);
  await f.db.prepare("DROP TRIGGER reject_enrollment_audit").run();
  await f.action(admin.cookie, "set_class_enrollments", { classId: classroom, studentUserIds: [students[0]], expectedStudentUserIds: baseline });
  assert.deepEqual(await activeStudents(f.db, classroom), [students[0]]);
});
