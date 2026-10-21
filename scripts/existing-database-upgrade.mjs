import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { generateSQLiteDrizzleJson } from "drizzle-kit/api";

const roleMarker = "role_isolation_v1";
const upgradeMarker = "existing_database_upgrade_v1";
const guardTable = "_existing_database_upgrade_guard_v1";
const root = new URL("../", import.meta.url);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

// D1 的表达式树深度上限较低；平衡组合保留全部断言，避免数百列形成线性 AND 链。
function conjunction(conditions) {
  if (!conditions.length) return "1";
  if (conditions.length === 1) return `(${conditions[0]})`;
  const middle = Math.floor(conditions.length / 2);
  return `(${conjunction(conditions.slice(0, middle))} AND ${conjunction(conditions.slice(middle))})`;
}

// 仅复用旧版的高置信度指纹；任教关系和监护关联可正常编辑，不能作为删除授权的依据。
const legacyRole = `rm.role IN ('student','teacher','guardian')
  AND substr(rm.user_id,1,4)='usr_'
  AND rm.tenant_id='tenant_' || substr(rm.user_id,5)
  AND EXISTS (SELECT 1 FROM role_memberships administrator
    WHERE administrator.tenant_id=rm.tenant_id AND administrator.user_id=rm.user_id AND administrator.role='admin')
  AND EXISTS (SELECT 1 FROM notifications n
    WHERE n.tenant_id=rm.tenant_id AND n.id=rm.tenant_id || '-notice-welcome' AND n.user_id=rm.user_id)
  AND NOT EXISTS (SELECT 1 FROM audit_logs a
    WHERE a.tenant_id=rm.tenant_id
      AND json_extract(CASE WHEN json_valid(a.detail_json) THEN a.detail_json ELSE '{}' END,'$.role')=rm.role
      AND ((a.action='member.created' AND a.target_type='user' AND a.target_id=rm.user_id)
        OR (a.action='invitation.accepted' AND a.actor_user_id=rm.user_id)))`;
const pendingRoles = `NOT EXISTS (SELECT 1 FROM app_settings WHERE key='${roleMarker}')`;

let contractPromise;
export function schemaContract() {
  // 运维工具读取当前声明，不导入应用初始化，也不保存或恢复历史迁移。
  return contractPromise ??= (async () => {
    const compiled = await build({ entryPoints: [fileURLToPath(new URL("db/schema.ts", root))],
      bundle: true, format: "cjs", platform: "node", packages: "external", write: false });
    const loaded = { exports: {} };
    Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
    const snapshot = await generateSQLiteDrizzleJson(loaded.exports);
    return Object.fromEntries(Object.values(snapshot.tables).map((table) => [table.name,
      Object.values(table.columns).map((column) => ({ name: column.name, type: column.type.toLowerCase(),
        required: column.notNull || column.primaryKey, primary: !!column.primaryKey }))]));
  })();
}

function columnCondition(alias, column) {
  return `${alias}.name=${quote(column.name)} AND lower(${alias}.type)=${quote(column.type)}
    AND (${alias}."notnull"=1 OR ${alias}.pk>0)=${column.required ? 1 : 0} AND (${alias}.pk>0)=${column.primary ? 1 : 0}`;
}

function structureConditions(contract, missingSessionVersion) {
  return Object.entries(contract).flatMap(([table, columns]) => {
    const expected = columns.filter((column) => !(missingSessionVersion && table === "users" && column.name === "session_version"));
    return [`(SELECT COUNT(*) FROM pragma_table_info(${quote(table)}))>=${expected.length}`,
      ...expected.map((column) => `EXISTS (SELECT 1 FROM pragma_table_info(${quote(table)}) info WHERE ${columnCondition("info", column)})`)];
  }).concat(missingSessionVersion
    ? ["NOT EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='session_version')"]
    : ["EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='session_version' AND replace(replace(dflt_value,'(',''),')','')='0')"]);
}

export async function inspectExistingDatabase(db) {
  const contract = await schemaContract();
  // 自定义表、额外列与 D1 元数据不属于本工具的修改范围，全部保留。
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const missingSessionVersion = !columns.some((column) => column.name === "session_version");
  const valid = db.prepare(`SELECT ${conjunction(structureConditions(contract, missingSessionVersion))} AS valid`).get();
  if (!valid?.valid) throw new Error("unsupported_database_schema: requires the complete recent schema, with only users.session_version optionally missing");
  if (!missingSessionVersion) {
    const column = columns.find((item) => item.name === "session_version");
    if (String(column.dflt_value).replaceAll(/[()]/g, "") !== "0") throw new Error("unsupported_database_schema: unexpected session_version default");
  }
  const cleanupCompleted = !!db.prepare("SELECT 1 FROM app_settings WHERE key=?").get(roleMarker);
  const upgradeCompleted = !!db.prepare("SELECT 1 FROM app_settings WHERE key=?").get(upgradeMarker);
  const legacyRoles = cleanupCompleted ? [] : db.prepare(`SELECT rm.id AS membershipId,rm.tenant_id AS tenantId,rm.user_id AS userId,rm.role
    FROM role_memberships rm WHERE ${legacyRole} ORDER BY rm.tenant_id,rm.user_id,rm.role`).all().map((row) => ({ ...row }));
  return { missingSessionVersion, cleanupCompleted, upgradeCompleted, legacyRoles,
    needsUpgrade: missingSessionVersion || !cleanupCompleted || !upgradeCompleted };
}

export async function existingDatabaseUpgradeStatements({ missingSessionVersion }) {
  if (typeof missingSessionVersion !== "boolean") throw new Error("session_version_state_required");
  const contract = await schemaContract();
  // D1 用 database.batch() 提交整个数组；前置断言失败时整批回滚，不能部分执行。
  const statements = [
    `CREATE TABLE ${guardTable} (ok INTEGER NOT NULL CHECK(ok=1))`,
    `INSERT INTO ${guardTable}(ok) SELECT CASE WHEN ${conjunction(structureConditions(contract, missingSessionVersion))}
      THEN 1 ELSE 0 END`,
  ];
  if (missingSessionVersion) statements.push(
    "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0",
    `INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
      SELECT lower(hex(randomblob(16))),id,'system:existing-database-upgrade','auth.session_version_added','table','users',
        json_object('source','${upgradeMarker}') FROM tenants`,
  );
  statements.push(
    `INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
      SELECT lower(hex(randomblob(16))),rm.tenant_id,rm.user_id,'auth.legacy_demo_role_removed','user',rm.user_id,
        json_object('role',rm.role,'source','${roleMarker}')
      FROM role_memberships rm WHERE ${legacyRole} AND ${pendingRoles}`,
    `DELETE FROM role_memberships WHERE id IN (SELECT rm.id FROM role_memberships rm WHERE ${legacyRole}) AND ${pendingRoles}`,
    `INSERT OR IGNORE INTO app_settings (key,value) VALUES ('${roleMarker}',CURRENT_TIMESTAMP)`,
    `INSERT OR IGNORE INTO app_settings (key,value) VALUES ('${upgradeMarker}',CURRENT_TIMESTAMP)`,
    `DROP TABLE ${guardTable}`,
  );
  return statements;
}

export async function upgradeExistingSqlite(databasePath, { apply = false, backupPath } = {}) {
  const path = resolve(databasePath);
  if (!existsSync(path)) throw new Error("database_file_not_found");
  const db = new DatabaseSync(path, { readOnly: !apply });
  try {
    const preview = await inspectExistingDatabase(db);
    if (!apply || !preview.needsUpgrade) return { applied: false, ...preview };
    const backup = resolve(backupPath ?? `${path}.before-upgrade-${Date.now()}-${crypto.randomUUID()}.sqlite`);
    if (backup === path || existsSync(backup)) throw new Error("backup_path_exists");
    // VACUUM INTO 生成包含 WAL 已提交内容的一致性快照，不能只复制主文件。
    db.prepare("VACUUM INTO ?").run(backup);
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = await inspectExistingDatabase(db);
      for (const statement of await existingDatabaseUpgradeStatements(current)) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); }
      catch (rollbackError) {
        if (!(rollbackError instanceof Error && rollbackError.message === "cannot rollback - no transaction is active")) {
          throw new AggregateError([error, rollbackError], "upgrade_rollback_failed");
        }
      }
      throw error;
    }
    return { applied: true, backupPath: backup, before: preview, after: await inspectExistingDatabase(db) };
  } finally { db.close(); }
}

export async function main(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--database", "--backup", "--session-version", "--output", "--apply", "--d1-sql"].includes(flag) || values.has(flag)) throw new Error("invalid_arguments");
    if (["--apply", "--d1-sql"].includes(flag)) values.set(flag, true);
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("invalid_arguments");
      values.set(flag, value);
    }
  }
  if (values.has("--d1-sql")) {
    if (values.has("--database") || values.has("--apply") || values.has("--backup")
      || !["missing", "present"].includes(values.get("--session-version"))) throw new Error("invalid_arguments");
    const statements = await existingDatabaseUpgradeStatements({ missingSessionVersion: values.get("--session-version") === "missing" });
    const sql = `-- 仅审查输出：暂停写入并备份 D1 后，使用 wrangler d1 execute DB --remote --file 导入整个文件。\n-- session_version: ${values.get("--session-version")}；先核对 PRAGMA table_info(users)。\n${statements.map((statement) => `${statement};`).join("\n\n")}\n`;
    if (values.has("--output")) {
      const output = resolve(values.get("--output"));
      await writeFile(output, sql, { encoding: "utf8", flag: "wx" });
      return JSON.stringify({ output, statements: statements.length });
    }
    return sql;
  }
  if (!values.has("--database") || values.has("--session-version") || values.has("--output") || (values.has("--backup") && !values.has("--apply"))) throw new Error("invalid_arguments");
  return JSON.stringify(await upgradeExistingSqlite(values.get("--database"), { apply: values.has("--apply"), backupPath: values.get("--backup") }), null, 2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${await main(process.argv.slice(2))}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "upgrade_failed"}\n`); process.exitCode = 1; }
}
