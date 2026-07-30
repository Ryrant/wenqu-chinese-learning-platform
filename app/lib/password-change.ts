import { hashPassword, verifyPassword } from "./auth-password";

export type ChangeAccountPasswordInput = {
  db: D1Database;
  tenantId: string;
  userId: string;
  currentPassword: string;
  newPassword: string;
};

export async function changeAccountPassword({ db, tenantId, userId, currentPassword, newPassword }: ChangeAccountPasswordInput) {
  const account = await db.prepare("SELECT password_hash AS passwordHash FROM users WHERE id=? AND status='active'")
    .bind(userId)
    .first<{ passwordHash: string | null }>();
  if (!account?.passwordHash || !(await verifyPassword(currentPassword, account.passwordHash))) return false;

  const passwordHash = await hashPassword(newPassword);
  await db.prepare("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?")
    .bind(passwordHash, userId)
    .run();
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), tenantId, userId, "password.changed", "user", userId, "{}")
    .run();
  return true;
}
