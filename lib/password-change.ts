import { hashPassword, verifyPassword } from "./auth-password";
import type { PlatformDatabase } from "./platform-runtime";

export type ChangeAccountPasswordInput = {
  db: PlatformDatabase;
  tenantId: string;
  userId: string;
  currentPassword: string;
  newPassword: string;
};

export async function changeAccountPassword({ db, tenantId, userId, currentPassword, newPassword }: ChangeAccountPasswordInput) {
  const account = await db.prepare("SELECT password_hash AS passwordHash,session_version AS sessionVersion FROM users WHERE id=? AND status='active'")
    .bind(userId)
    .first<{ passwordHash: string | null; sessionVersion: number }>();
  if (!account?.passwordHash || !(await verifyPassword(currentPassword, account.passwordHash))) return false;

  const passwordHash = await hashPassword(newPassword);
  const [updated] = await db.batch([
    db.prepare("UPDATE users SET password_hash=?,must_change_password=0,session_version=session_version+1 WHERE id=? AND password_hash=? AND session_version=? AND status='active'")
      .bind(passwordHash, userId, account.passwordHash, account.sessionVersion),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)")
      .bind(crypto.randomUUID(), tenantId, userId, "password.changed", "user", userId, "{}", userId, passwordHash),
  ]);
  return updated.meta.changes ? { sessionVersion: account.sessionVersion + 1 } : false;
}
