import type { PlatformDatabase } from "./platform-runtime";

const migrationKey = "role_isolation_v1";
const pendingMigration = `NOT EXISTS (SELECT 1 FROM app_settings WHERE key='${migrationKey}')`;

// 旧表没有授权来源，以账号自建租户及旧欢迎记录识别，保留审计中明确授予的角色。
// 班级教师和监护绑定可被正常编辑，不能要求它们仍保持初始化时的关系。
const legacyRole = `rm.role IN ('student','teacher','guardian')
  AND rm.tenant_id='tenant_' || substr(rm.user_id,5)
  AND EXISTS (SELECT 1 FROM role_memberships admin
    WHERE admin.tenant_id=rm.tenant_id AND admin.user_id=rm.user_id AND admin.role='admin')
  AND EXISTS (SELECT 1 FROM notifications n
    WHERE n.tenant_id=rm.tenant_id AND n.id=rm.tenant_id || '-notice-welcome' AND n.user_id=rm.user_id)
  AND NOT EXISTS (SELECT 1 FROM audit_logs a
    WHERE a.tenant_id=rm.tenant_id
      AND json_extract(CASE WHEN json_valid(a.detail_json) THEN a.detail_json ELSE '{}' END,'$.role')=rm.role
      AND ((a.action='member.created' AND a.target_type='user' AND a.target_id=rm.user_id)
        OR (a.action='invitation.accepted' AND a.actor_user_id=rm.user_id)))`;

export async function cleanupLegacyDemoRoles(db: PlatformDatabase) {
  if (await db.prepare("SELECT value FROM app_settings WHERE key=?").bind(migrationKey).first()) return;

  // 批次原子执行；每条语句检查迁移标记，避免并发实例或后续重新授权被重复清理。
  await db.batch([
    db.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
      SELECT lower(hex(randomblob(16))),rm.tenant_id,rm.user_id,'auth.legacy_demo_role_removed','user',rm.user_id,
        json_object('role',rm.role,'source','${migrationKey}')
      FROM role_memberships rm WHERE ${legacyRole} AND ${pendingMigration}`),
    db.prepare(`DELETE FROM role_memberships
      WHERE id IN (SELECT rm.id FROM role_memberships rm WHERE ${legacyRole}) AND ${pendingMigration}`),
    db.prepare("INSERT OR IGNORE INTO app_settings (key,value) VALUES (?,CURRENT_TIMESTAMP)").bind(migrationKey),
  ]);
}
