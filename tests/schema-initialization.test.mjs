import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

const root = new URL("../", import.meta.url);

async function schemaSnapshot() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("db/schema.ts", root))],
    bundle: true, format: "cjs", platform: "node", packages: "external", write: false,
  });
  const module = { exports: {} };
  Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return generateSQLiteDrizzleJson(module.exports);
}

async function importRuntimeSchema() {
  const compiled = await build({
    stdin: {
      contents: 'export { ensurePlatformSchema } from "./lib/platform-store"; export { NodeSqliteDatabase } from "./lib/platform-runtime-node";',
      resolveDir: fileURLToPath(root), loader: "ts",
    },
    bundle: true, format: "cjs", platform: "node", packages: "external", write: false,
  });
  const module = { exports: {} };
  Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

function defaultValue(value) {
  if (value === null) return null;
  return value.toLowerCase().replace(/^\((.*)\)$/, "$1").replace(/^false$/, "0").replace(/^true$/, "1");
}

async function rows(db, query, ...values) {
  const statement = db.prepare(query);
  const result = typeof statement.bind === "function" ? await statement.bind(...values).all() : statement.all(...values);
  return result.results ?? result;
}

async function structure(db) {
  const tables = await rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return Promise.all(tables.map(async ({ name }) => ({
    name,
    columns: (await rows(db, `PRAGMA table_info('${name}')`)).map((column) => ({
      name: column.name, type: column.type.toLowerCase(), required: !!column.notnull || !!column.pk,
      primary: column.pk, default: defaultValue(column.dflt_value),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    indexes: (await rows(db, "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name", name)).map((index) => ({
      name: index.name,
      sql: index.sql.toLowerCase().replace(/if\s+not\s+exists/g, "").replace(/[`"\s]/g, "").replaceAll(`${name}.`, ""),
    })),
  })));
}

test("fresh runtime initialization matches every current schema table column default and index", async (t) => {
  const { NodeSqliteDatabase, ensurePlatformSchema } = await importRuntimeSchema();
  const actual = new NodeSqliteDatabase("file::memory:");
  const expected = new DatabaseSync(":memory:");
  t.after(() => { actual.close(); expected.close(); });
  const current = await schemaSnapshot();
  const empty = { ...current, tables: {}, id: crypto.randomUUID() };
  for (const statement of await generateSQLiteMigration(empty, current)) expected.exec(statement);
  await ensurePlatformSchema(actual);
  assert.deepEqual(await structure(actual), await structure(expected));
});

test("initialization through fresh adapters preserves existing metadata roles and optional timestamps", async (t) => {
  const { NodeSqliteDatabase, ensurePlatformSchema } = await importRuntimeSchema();
  const db = new NodeSqliteDatabase("file::memory:");
  t.after(() => db.close());
  await ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants (id,name,region) VALUES ('tenant_current','华文知行示范学校','sg')"),
    db.prepare("INSERT INTO users (id,email,display_name) VALUES ('usr_current','current@example.test','当前账号')"),
    ...["student", "teacher", "guardian", "admin"].map((role) => db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role) VALUES ('tenant_current','usr_current',?)").bind(role)),
    db.prepare("INSERT INTO notifications (id,tenant_id,user_id,title,detail) VALUES ('tenant_current-notice-welcome','tenant_current','usr_current','保留的通知','保留的详情')"),
    db.prepare("INSERT INTO lesson_plans (id,tenant_id,title,topic,level,duration_minutes,created_by) VALUES ('lesson','tenant_current','教案','主题','A2',30,'usr_current')"),
    db.prepare("INSERT INTO learning_recommendations (id,tenant_id,student_user_id,source_type,title,created_by) VALUES ('recommendation','tenant_current','usr_current','teacher','待完成任务','usr_current')"),
    db.prepare("INSERT INTO source_documents (id,tenant_id,title,media_type,created_by) VALUES ('source','tenant_current','课程材料','text/plain','usr_current')"),
  ]);
  const tables = ["tenants", "users", "role_memberships", "notifications", "lesson_plans", "learning_recommendations", "source_documents", "app_settings", "audit_logs"];
  const contents = () => Promise.all(tables.map((name) => rows(db, `SELECT * FROM ${name} ORDER BY rowid`)));
  const before = await contents();
  const beforeStructure = await structure(db);
  await ensurePlatformSchema(db);
  // 每次创建新的适配器对象以绕过实例缓存，覆盖真实重启时重新执行建表的路径。
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensurePlatformSchema({ prepare: db.prepare.bind(db), batch: db.batch.bind(db) });
  }
  assert.deepEqual(await contents(), before);
  assert.deepEqual(await structure(db), beforeStructure);
  for (const name of ["lesson_plans", "learning_recommendations", "source_documents"]) {
    assert.deepEqual(await rows(db, `SELECT updated_at,archived_at FROM ${name}`), [{ updated_at: null, archived_at: null }]);
  }
  assert.deepEqual(await rows(db, "SELECT key FROM app_settings"), []);
});

test("fresh schema provides session and region defaults and enforces pending submission uniqueness", async (t) => {
  const { NodeSqliteDatabase, ensurePlatformSchema } = await importRuntimeSchema();
  const db = new NodeSqliteDatabase("file::memory:");
  t.after(() => db.close());
  await ensurePlatformSchema(db);
  await db.prepare("INSERT INTO tenants (id,name) VALUES ('school','当前机构')").run();
  await db.prepare("INSERT INTO users (id,email,display_name) VALUES ('student','student@example.test','学生')").run();
  assert.deepEqual(await rows(db, "SELECT region FROM tenants"), [{ region: "" }]);
  assert.deepEqual(await rows(db, "SELECT session_version FROM users"), [{ session_version: 0 }]);

  const family = (id, tenant = "school", status = "auto") => db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,family_task_id,review_status) VALUES (?,?,'assignment','student','family-task',?)").bind(id, tenant, status).run();
  await family("family-first");
  await assert.rejects(family("family-duplicate"), /UNIQUE constraint failed/);
  await family("family-reviewed", "school", "reviewed");
  await family("family-other-school", "other-school");
  await db.prepare("UPDATE submissions SET review_status='reviewed' WHERE id='family-first'").run();
  await family("family-next");

  const sequence = (id, stage = "practice", tenant = "school", status = "auto") => db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,sequence_id,sequence_stage,review_status) VALUES (?,?,'assignment','student','sequence',?,?)").bind(id, tenant, stage, status).run();
  await sequence("practice-first");
  await assert.rejects(sequence("practice-duplicate"), /UNIQUE constraint failed/);
  await sequence("transfer-first", "transfer");
  await sequence("practice-reviewed", "practice", "school", "reviewed");
  await sequence("practice-other-school", "practice", "other-school");
  await db.prepare("UPDATE submissions SET review_status='reviewed' WHERE id='practice-first'").run();
  await sequence("practice-next");
});
