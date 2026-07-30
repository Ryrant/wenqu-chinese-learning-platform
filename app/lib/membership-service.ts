import { hashPassword } from "./auth-password";
import type { PlatformRole } from "./platform-store";

export type MemberInput = {
  tenantId: string;
  actorUserId: string;
  email: string;
  displayName: string;
  role: PlatformRole;
  temporaryPassword: string;
};

export async function createMember(db: D1Database, input: MemberInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_member_email");
  if (input.temporaryPassword.length < 10) throw new Error("weak_password");
  let hash = 2166136261;
  for (let index = 0; index < email.length; index += 1) hash = Math.imul(hash ^ email.charCodeAt(index), 16777619);
  const userId = `usr_${(hash >>> 0).toString(36)}`;
  const passwordHash = await hashPassword(input.temporaryPassword);
  await db.batch([
    db.prepare("INSERT INTO users (id,email,display_name,locale,password_hash,must_change_password,status) VALUES (?,?,?,?,?,1,'active') ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,password_hash=excluded.password_hash,must_change_password=1,status='active'")
      .bind(userId, email, input.displayName.trim().slice(0, 120) || email.split("@")[0], "zh-CN", passwordHash),
    db.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role,status) VALUES (?,?,?,'active')")
      .bind(input.tenantId, userId, input.role),
    db.prepare("UPDATE role_memberships SET status='active' WHERE tenant_id=? AND user_id=? AND role=?")
      .bind(input.tenantId, userId, input.role),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.created", "user", userId, JSON.stringify({ email, role: input.role })),
  ]);
  return { id: userId, email, role: input.role, mustChangePassword: true };
}

export async function resetMemberPassword(db: D1Database, input: { tenantId: string; actorUserId: string; userId: string; temporaryPassword: string }) {
  if (input.temporaryPassword.length < 10) throw new Error("weak_password");
  const passwordHash = await hashPassword(input.temporaryPassword);
  const result = await db.prepare("UPDATE users SET password_hash=?,must_change_password=1,status='active' WHERE id=? AND EXISTS (SELECT 1 FROM role_memberships rm WHERE rm.tenant_id=? AND rm.user_id=users.id)")
    .bind(passwordHash, input.userId, input.tenantId)
    .run();
  if (!result.meta.changes) throw new Error("member_not_found");
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.password_reset", "user", input.userId, "{}")
    .run();
}

export async function setMemberStatus(db: D1Database, input: { tenantId: string; actorUserId: string; userId: string; status: "active" | "disabled" }) {
  const result = await db.prepare("UPDATE users SET status=? WHERE id=? AND EXISTS (SELECT 1 FROM role_memberships rm WHERE rm.tenant_id=? AND rm.user_id=users.id)")
    .bind(input.status, input.userId, input.tenantId)
    .run();
  if (!result.meta.changes) throw new Error("member_not_found");
  await db.prepare("UPDATE role_memberships SET status=? WHERE tenant_id=? AND user_id=?")
    .bind(input.status, input.tenantId, input.userId)
    .run();
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.status_changed", "user", input.userId, JSON.stringify({ status: input.status }))
    .run();
}

export async function setGuardianLinks(db: D1Database, input: { tenantId: string; actorUserId: string; guardianUserId: string; studentUserIds: string[] }) {
  await db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE tenant_id=? AND guardian_user_id=?")
    .bind(input.tenantId, input.guardianUserId)
    .run();
  const uniqueStudents = [...new Set(input.studentUserIds)].filter(Boolean);
  if (uniqueStudents.length) {
    await db.batch(uniqueStudents.map((studentUserId) => db.prepare("INSERT INTO guardian_student_links (tenant_id,guardian_user_id,student_user_id,verified_at,status) VALUES (?,?,?,CURRENT_TIMESTAMP,'active')")
      .bind(input.tenantId, input.guardianUserId, studentUserId)));
  }
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "guardian_links.updated", "user", input.guardianUserId, JSON.stringify({ studentUserIds: uniqueStudents }))
    .run();
}
