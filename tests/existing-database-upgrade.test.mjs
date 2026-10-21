import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateSQLiteMigration } from "drizzle-kit/api";
import { existingDatabaseUpgradeStatements, inspectExistingDatabase, schemaContract, upgradeExistingSqlite } from "../scripts/existing-database-upgrade.mjs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { generateSQLiteDrizzleJson } from "drizzle-kit/api";

const root = new URL("../", import.meta.url);
const cli = fileURLToPath(new URL("scripts/existing-database-upgrade.mjs", root));
const compiled = await build({ entryPoints: [fileURLToPath(new URL("db/schema.ts", root))], bundle: true,
  format: "cjs", platform: "node", packages: "external", write: false });
const loaded = { exports: {} };
Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const snapshot = await generateSQLiteDrizzleJson(loaded.exports);
const create = await generateSQLiteMigration({ ...snapshot, tables: {}, id: crypto.randomUUID() }, snapshot);
await schemaContract();

async function fixture(t, { missing = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-upgrade-test-"));
  const path = join(directory, "fictional.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(path);
  for (const statement of create) db.exec(statement);
  if (missing) db.exec("ALTER TABLE users DROP COLUMN session_version");
  for (const name of ["automatic", "explicit", "ordinary"]) {
    const user = `usr_${name}`; const tenant = `tenant_${name}`;
    db.prepare("INSERT INTO tenants(id,name) VALUES (?,?)").run(tenant, `虚构机构 ${name}`);
    db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").run(user, `${name}@example.test`, name);
    for (const role of ["admin", "teacher", "student", "guardian"]) {
      db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,?)").run(tenant, user, role);
    }
    if (name !== "ordinary") db.prepare("INSERT INTO notifications(id,tenant_id,user_id,title,detail) VALUES (?,?,?,'旧欢迎通知','虚构数据')").run(`${tenant}-notice-welcome`, tenant, user);
  }
  db.prepare("INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES ('grant-teacher','tenant_explicit','administrator','member.created','user','usr_explicit',?)").run(JSON.stringify({ role: "teacher" }));
  db.prepare("INSERT INTO audit_logs(id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES ('grant-guardian','tenant_explicit','usr_explicit','invitation.accepted','invitation','accepted-invite',?)").run(JSON.stringify({ role: "guardian" }));
  // 自定义表与 D1 平台元数据不应影响工具判断，也不能被修改或删除。
  db.exec("CREATE TABLE custom_notes(value TEXT); INSERT INTO custom_notes VALUES ('保留'); CREATE TABLE _cf_KV(key TEXT PRIMARY KEY,value BLOB)");
  db.close();
  const open = () => new DatabaseSync(path);
  const state = () => {
    const conn = open();
    try { return conn.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name").all().map((row) => ({ ...row })); }
    finally { conn.close(); }
  };
  return { directory, path, open, state };
}

function roles(db, user) { return db.prepare("SELECT role FROM role_memberships WHERE user_id=? ORDER BY role").all(user).map((row) => row.role); }
function rows(db, table) { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map((row) => ({ ...row })); }

test("CLI 默认只预览，数据库文件和结构完全不变，缺失路径不创建空库", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.path); const structure = f.state();
  const command = spawnSync(process.execPath, [cli, "--database", f.path], { encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr);
  const result = JSON.parse(command.stdout);
  assert.equal(result.applied, false); assert.equal(result.missingSessionVersion, true);
  assert.equal(result.legacyRoles.length, 4);
  assert.deepEqual(await readFile(f.path), before); assert.deepEqual(f.state(), structure);
  await assert.rejects(upgradeExistingSqlite(join(f.directory, "missing.sqlite")), /database_file_not_found/);
});

test("显式 apply 先生成一致性备份，再原子补列并仅清理高置信度演示授权；重跑不清理重新授权", async (t) => {
  const f = await fixture(t);
  const backup = join(f.directory, "before.sqlite");
  const command = spawnSync(process.execPath, [cli, "--database", f.path, "--apply", "--backup", backup], { encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr); assert.equal(JSON.parse(command.stdout).applied, true);
  const original = new DatabaseSync(backup, { readOnly: true });
  assert.equal(original.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "session_version"), false);
  assert.deepEqual(roles(original, "usr_automatic"), ["admin", "guardian", "student", "teacher"]); original.close();
  const db = f.open();
  assert.deepEqual(roles(db, "usr_automatic"), ["admin"]);
  assert.deepEqual(roles(db, "usr_explicit"), ["admin", "guardian", "teacher"]);
  assert.deepEqual(roles(db, "usr_ordinary"), ["admin", "guardian", "student", "teacher"]);
  assert.deepEqual(rows(db, "custom_notes"), [{ value: "保留" }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='auth.legacy_demo_role_removed'").get().count, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='auth.session_version_added'").get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key IN ('role_isolation_v1','existing_database_upgrade_v1')").get().count, 2);
  db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES ('tenant_automatic','usr_automatic','teacher')").run();
  const before = { roles: rows(db, "role_memberships"), audit: rows(db, "audit_logs"), settings: rows(db, "app_settings") }; db.close();
  const repeated = await upgradeExistingSqlite(f.path, { apply: true }); assert.equal(repeated.applied, false);
  const after = f.open();
  assert.deepEqual({ roles: rows(after, "role_memberships"), audit: rows(after, "audit_logs"), settings: rows(after, "app_settings") }, before); after.close();
});

test("已有旧清理标记会保留后续授权，完整当前库无需 ALTER；错误 schema 提前拒绝", async (t) => {
  const f = await fixture(t, { missing: false }); const db = f.open();
  db.prepare("INSERT INTO app_settings(key,value) VALUES ('role_isolation_v1','done')").run();
  db.close();
  const result = await upgradeExistingSqlite(f.path, { apply: true }); assert.equal(result.after.needsUpgrade, false);
  const current = f.open(); assert.equal(roles(current, "usr_automatic").length, 4);
  current.exec("ALTER TABLE assignments DROP COLUMN diagnostic_prompt"); current.close();
  const before = await readFile(f.path);
  await assert.rejects(upgradeExistingSqlite(f.path, { apply: true }), /unsupported_database_schema/);
  assert.deepEqual(await readFile(f.path), before);
});

test("标记或审计失败时补列、授权删除、审计及标记一起回滚，并保留原始备份", async (t) => {
  const f = await fixture(t); const db = f.open();
  db.exec("CREATE TRIGGER reject_upgrade_marker BEFORE INSERT ON app_settings WHEN NEW.key='existing_database_upgrade_v1' BEGIN SELECT RAISE(ABORT,'fixture_upgrade_failure'); END");
  const before = { schema: f.state(), roles: rows(db, "role_memberships"), audit: rows(db, "audit_logs"), settings: rows(db, "app_settings") }; db.close();
  const backup = join(f.directory, "rollback-backup.sqlite");
  await assert.rejects(upgradeExistingSqlite(f.path, { apply: true, backupPath: backup }), /fixture_upgrade_failure/);
  const after = f.open();
  assert.deepEqual({ schema: f.state(), roles: rows(after, "role_memberships"), audit: rows(after, "audit_logs"), settings: rows(after, "app_settings") }, before);
  assert.equal((await inspectExistingDatabase(after)).missingSessionVersion, true);
  after.exec("DROP TRIGGER reject_upgrade_marker"); after.close();
  const snapshot = new DatabaseSync(backup, { readOnly: true }); assert.equal(roles(snapshot, "usr_automatic").length, 4); snapshot.close();
  await assert.rejects(upgradeExistingSqlite(f.path, { apply: true, backupPath: backup }), /backup_path_exists/);
  assert.equal((await upgradeExistingSqlite(f.path, { apply: true })).applied, true);
});

test("D1 输出不自带事务命令，schema 断言失败时可由同一批次完整回滚，状态必须显式选择", async (t) => {
  const f = await fixture(t); const db = f.open();
  const output = spawnSync(process.execPath, [cli, "--d1-sql", "--session-version", "missing"], { encoding: "utf8" });
  assert.equal(output.status, 0, output.stderr); assert.doesNotMatch(output.stdout, /\bBEGIN\b|\bCOMMIT\b/);
  const statements = await existingDatabaseUpgradeStatements({ missingSessionVersion: false });
  const before = f.state(); db.exec("BEGIN");
  assert.throws(() => { for (const statement of statements) db.exec(statement); }, /CHECK constraint failed/);
  db.exec("ROLLBACK"); assert.deepEqual(f.state(), before); db.close();
  const invalid = spawnSync(process.execPath, [cli, "--d1-sql"], { encoding: "utf8" }); assert.equal(invalid.status, 1);
});

test("WAL 一致性备份包含已提交更新，审计失败仍回滚补列并保留备份", async (t) => {
  const f = await fixture(t); const writer = f.open();
  writer.exec("PRAGMA journal_mode=WAL; INSERT INTO custom_notes VALUES ('已提交的 WAL 内容')");
  writer.exec("CREATE TRIGGER reject_upgrade_audit BEFORE INSERT ON audit_logs WHEN NEW.action='auth.legacy_demo_role_removed' BEGIN SELECT RAISE(ABORT,'fixture_audit_failure'); END");
  const backup = join(f.directory, "wal-backup.sqlite");
  await assert.rejects(upgradeExistingSqlite(f.path, { apply: true, backupPath: backup }), /fixture_audit_failure/);
  const saved = new DatabaseSync(backup, { readOnly: true });
  assert.deepEqual(rows(saved, "custom_notes"), [{ value: "保留" }, { value: "已提交的 WAL 内容" }]); saved.close();
  assert.equal(writer.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "session_version"), false);
  assert.equal(writer.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='auth.session_version_added'").get().count, 0);
  assert.equal(roles(writer, "usr_automatic").length, 4); writer.close();
});

test("D1 文件输出固定 UTF-8 无 BOM，拒绝覆盖已有审查文件", async (t) => {
  const f = await fixture(t); const output = join(f.directory, "upgrade.sql");
  const args = [cli, "--d1-sql", "--session-version", "missing", "--output", output];
  const generated = spawnSync(process.execPath, args, { encoding: "utf8" }); assert.equal(generated.status, 0, generated.stderr);
  const bytes = await readFile(output); assert.equal(bytes[0], "-".charCodeAt(0));
  assert.match(bytes.toString("utf8"), /仅审查输出/);
  const repeated = spawnSync(process.execPath, args, { encoding: "utf8" }); assert.equal(repeated.status, 1);
  assert.deepEqual(await readFile(output), bytes);
});
