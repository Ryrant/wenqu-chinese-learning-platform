import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const migrationNames = (await readdir(new URL("drizzle/", root))).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const journal = JSON.parse(await read("drizzle/meta/_journal.json"));

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

async function replay(db, names = migrationNames) {
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of names) {
    const sql = await read(`drizzle/${name}`);
    // Wrangler 会在事务中应用迁移，测试保持相同的外键检查与原子性条件。
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
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

test("migration journal follows every published SQL file and the latest snapshot generates no changes", async () => {
  assert.deepEqual(journal.entries.map((entry) => `${entry.tag}.sql`), migrationNames);
  assert.deepEqual(journal.entries.map((entry) => entry.idx), migrationNames.map((_, index) => index));
  const snapshotNames = (await readdir(new URL("drizzle/meta/", root))).filter((name) => /^\d{4}_snapshot\.json$/.test(name)).sort();
  let previousId = "00000000-0000-0000-0000-000000000000";
  for (const name of snapshotNames) {
    const snapshot = JSON.parse(await read(`drizzle/meta/${name}`));
    assert.equal(snapshot.prevId, previousId, `${name} must extend the previous stored snapshot`);
    previousId = snapshot.id;
  }
  const latest = JSON.parse(await read(`drizzle/meta/${snapshotNames.at(-1)}`));
  assert.deepEqual(await generateSQLiteMigration(latest, await schemaSnapshot()), []);
});

test("published migrations create the complete current schema and future generation remains additive", async (t) => {
  const actual = new DatabaseSync(":memory:");
  const expected = new DatabaseSync(":memory:");
  t.after(() => { actual.close(); expected.close(); });
  await replay(actual);
  const current = await schemaSnapshot();
  const empty = { ...current, tables: {}, id: crypto.randomUUID() };
  for (const statement of await generateSQLiteMigration(empty, current)) expected.exec(statement);
  assert.deepEqual(await structure(actual), await structure(expected));

  const future = structuredClone(current);
  future.tables.users.columns.migration_probe = {
    name: "migration_probe", type: "text", primaryKey: false, notNull: false, autoincrement: false,
  };
  const statements = await generateSQLiteMigration(current, future);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^ALTER TABLE [`"]?users[`"]? ADD [`"]?migration_probe/);
  actual.exec(statements[0]);
  assert.ok(actual.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "migration_probe"));
});

test("fresh runtime initialization and published migrations create equivalent tables and indexes", async (t) => {
  const { NodeSqliteDatabase, ensurePlatformSchema } = await importRuntimeSchema();
  const runtime = new NodeSqliteDatabase("file::memory:");
  const migrated = new DatabaseSync(":memory:");
  t.after(() => { runtime.close(); migrated.close(); });
  await ensurePlatformSchema(runtime);
  await replay(migrated);
  assert.deepEqual(await structure(runtime), await structure(migrated));
  // 运行时已具备全部结构的旧部署，应可安全建立完整的 Wrangler 迁移台账。
  const baseline = await read("scripts/baseline-d1-migrations.sql");
  for (const statement of baseline.split(";").map((sql) => sql.trim()).filter(Boolean)) {
    await runtime.prepare(statement).run();
  }
  assert.deepEqual((await rows(runtime, "SELECT name FROM d1_migrations ORDER BY name")).map((row) => row.name), migrationNames);
});

test("D1 baselining marks only completed migrations and preserves legacy rows through upgrade", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const baseline = await read("scripts/baseline-d1-migrations.sql");
  db.exec(baseline);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations").get().count, 0);
  const legacyNames = migrationNames.filter((name) => Number(name.slice(0, 4)) <= 15);
  const upgradeNames = migrationNames.filter((name) => Number(name.slice(0, 4)) > 15);
  await replay(db, legacyNames);
  db.exec("INSERT INTO tenants(id,name,region) VALUES('old-school','原有机构','旧区域'); INSERT INTO users(id,email,display_name) VALUES('old-user','old@example.test','原有账号');");
  const oldTenant = { ...db.prepare("SELECT * FROM tenants WHERE id='old-school'").get() };
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE tbl_name='tenants' AND type IN ('index','trigger') AND sql IS NOT NULL").all(), []);
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    assert.equal(db.prepare(`PRAGMA foreign_key_list('${name}')`).all().filter((key) => key.table === "tenants").length, 0);
  }
  db.exec(baseline);
  assert.deepEqual(db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map((row) => row.name), legacyNames);
  await replay(db, upgradeNames);
  db.exec(baseline);
  db.exec(baseline);
  assert.deepEqual(db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map((row) => row.name), migrationNames);
  assert.deepEqual({ ...db.prepare("SELECT * FROM tenants WHERE id='old-school'").get() }, oldTenant);
  assert.equal(db.prepare("SELECT session_version FROM users WHERE id='old-user'").get().session_version, 0);
});

test("D1 baselining independently recognizes runtime session upgrades before the region migration", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  await replay(db, migrationNames.filter((name) => Number(name.slice(0, 4)) <= 15));
  db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  db.exec(await read("scripts/baseline-d1-migrations.sql"));
  const applied = db.prepare("SELECT name FROM d1_migrations").all().map((row) => row.name);
  assert.ok(applied.includes("0016_account_sessions.sql"));
  assert.ok(!applied.includes("0017_tenant_region_default.sql"));
  await replay(db, migrationNames.filter((name) => !applied.includes(name)));
  assert.equal(db.prepare("SELECT dflt_value FROM pragma_table_info('tenants') WHERE name='region'").get().dflt_value, "''");
});
