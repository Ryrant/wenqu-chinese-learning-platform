import type { PlatformDatabase } from "./platform-runtime";

export function auditStatement(db: PlatformDatabase, tenantId: string, userId: string, action: string, targetType: string, targetId: string, detail: unknown = {}, onlyIfChanged = false, id: string = crypto.randomUUID()) {
  // 条件审计必须紧随同一 batch 中的业务 UPDATE，changes() 才对应这次实际变更。
  const values = onlyIfChanged ? "SELECT ?,?,?,?,?,?,? WHERE changes()>0" : "VALUES (?,?,?,?,?,?,?)";
  return db.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) ${values}`).bind(id, tenantId, userId, action, targetType, targetId, JSON.stringify(detail));
}
