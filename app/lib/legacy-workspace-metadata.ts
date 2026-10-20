import type { PlatformDatabase } from "./platform-runtime";
import { DEFAULT_WORKSPACE_NAME } from "./standard-login";

const migrationKey = "legacy_workspace_metadata_v1";
const pendingMigration = `NOT EXISTS (SELECT 1 FROM app_settings WHERE key='${migrationKey}')`;

export async function cleanupLegacyWorkspaceMetadata(db: PlatformDatabase) {
  if (await db.prepare("SELECT value FROM app_settings WHERE key=?").bind(migrationKey).first()) return;

  // 仅识别旧初始化生成的完整名称与区域组合，自定义机构信息保持原样。
  // 更新和迁移标记原子保存，每条更新仍检查标记，避免并发或重试覆盖后续修改。
  await db.batch([
    db.prepare(`UPDATE tenants SET name=?,region=''
      WHERE name='华文知行示范学校' AND region='sg' AND ${pendingMigration}`)
      .bind(DEFAULT_WORKSPACE_NAME),
    db.prepare("INSERT OR IGNORE INTO app_settings (key,value) VALUES (?,CURRENT_TIMESTAMP)").bind(migrationKey),
  ]);
}
