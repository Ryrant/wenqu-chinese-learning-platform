import { hashPassword } from "./auth-password";
import type { PlatformDatabase } from "./platform-runtime";
import type { PlatformRole } from "./platform-store";

export type MemberInput = {
  tenantId: string;
  actorUserId: string;
  email: string;
  displayName: string;
  role: PlatformRole;
  temporaryPassword: string;
};

export async function createMember(db: PlatformDatabase, input: MemberInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_member_email");
  if (input.temporaryPassword.length < 10) throw new Error("weak_password");
  let hash = 2166136261;
  for (let index = 0; index < email.length; index += 1) hash = Math.imul(hash ^ email.charCodeAt(index), 16777619);
  let userId = `usr_${(hash >>> 0).toString(36)}`;
  const existing = await db.prepare("SELECT id,email,must_change_password AS mustChangePassword FROM users WHERE lower(email)=? OR id=? LIMIT 1")
    .bind(email, userId).first<{ id: string; email: string; mustChangePassword: number }>();
  if (existing) {
    if (existing.email.toLowerCase() !== email) throw new Error("member_email_conflict");
    const owned = await db.prepare("SELECT 1 FROM role_memberships WHERE tenant_id=? AND user_id=? LIMIT 1")
      .bind(input.tenantId, existing.id).first();
    // 创建成员只管理本机构账号，不以知道邮箱为依据关联其他机构的全局身份。
    if (!owned) throw new Error("member_account_external");
    userId = existing.id;
  }
  const statements = [
    db.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role,status) VALUES (?,?,?,'active')")
      .bind(input.tenantId, userId, input.role),
    db.prepare("UPDATE role_memberships SET status='active' WHERE tenant_id=? AND user_id=? AND role=?")
      .bind(input.tenantId, userId, input.role),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.created", "user", userId, JSON.stringify({ email, role: input.role })),
  ];
  if (!existing) {
    const passwordHash = await hashPassword(input.temporaryPassword);
    statements.unshift(db.prepare("INSERT INTO users (id,email,display_name,locale,password_hash,must_change_password,status) VALUES (?,?,?,?,?,1,'active')")
      .bind(userId, email, input.displayName.trim().slice(0, 120) || email.split("@")[0], "zh-CN", passwordHash));
  }
  await db.batch(statements);
  return { id: userId, email, role: input.role, mustChangePassword: existing ? existing.mustChangePassword === 1 : true };
}

export async function resetMemberPassword(db: PlatformDatabase, input: { tenantId: string; actorUserId: string; userId: string; temporaryPassword: string }) {
  if (input.temporaryPassword.length < 10) throw new Error("weak_password");
  const account = await db.prepare("SELECT u.status FROM users u JOIN role_memberships rm ON rm.user_id=u.id WHERE u.id=? AND rm.tenant_id=? AND rm.status='active' LIMIT 1")
    .bind(input.userId, input.tenantId)
    .first<{ status: string }>();
  if (!account) throw new Error("member_not_found");
  if (account.status !== "active") throw new Error("member_inactive");
  const shared = await db.prepare("SELECT 1 FROM role_memberships WHERE user_id=? AND tenant_id<>? LIMIT 1")
    .bind(input.userId, input.tenantId).first();
  if (shared) throw new Error("shared_account_password_reset");
  const passwordHash = await hashPassword(input.temporaryPassword);
  const [result] = await db.batch([
    db.prepare("UPDATE users SET password_hash=?,must_change_password=1,session_version=session_version+1 WHERE id=? AND NOT EXISTS (SELECT 1 FROM role_memberships WHERE user_id=? AND tenant_id<>?)")
      .bind(passwordHash, input.userId, input.userId, input.tenantId),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)")
      .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.password_reset", "user", input.userId, "{}", input.userId, passwordHash),
  ]);
  if (!result.meta.changes) throw new Error("member_not_found");
}

export async function setMemberStatus(db: PlatformDatabase, input: { tenantId: string; actorUserId: string; userId: string; status: "active" | "disabled" }) {
  if (input.status === "disabled" && input.userId === input.actorUserId) {
    throw new Error("cannot_disable_self");
  }
  const [result] = await db.batch([
    db.prepare("UPDATE role_memberships SET status=? WHERE tenant_id=? AND user_id=?")
      .bind(input.status, input.tenantId, input.userId),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM role_memberships WHERE tenant_id=? AND user_id=?)")
      .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.status_changed", "user", input.userId, JSON.stringify({ status: input.status }), input.tenantId, input.userId),
  ]);
  if (!result.meta.changes) throw new Error("member_not_found");
}

export async function setGuardianLinks(db: PlatformDatabase, input: { tenantId: string; actorUserId: string; guardianUserId: string; studentUserIds: string[] }) {
  const uniqueStudents = [...new Set(input.studentUserIds)].filter(Boolean);
  // 空名单用于清理停用账号的历史关联，但目标仍须确属本机构的家长。
  const guardian = await db.prepare(`SELECT 1 FROM users u JOIN role_memberships rm ON rm.user_id=u.id
    WHERE u.id=? AND rm.tenant_id=? AND rm.role='guardian'
      AND (?=0 OR (u.status='active' AND rm.status='active')) LIMIT 1`)
    .bind(input.guardianUserId, input.tenantId, uniqueStudents.length).first();
  if (!guardian) throw new Error("invalid_guardian_id");
  if (uniqueStudents.length) {
    const students = await db.prepare(`SELECT COUNT(DISTINCT u.id) AS count FROM users u JOIN role_memberships rm ON rm.user_id=u.id
      WHERE rm.tenant_id=? AND rm.role='student' AND rm.status='active' AND u.status='active'
        AND u.id IN (SELECT value FROM json_each(?))`)
      .bind(input.tenantId, JSON.stringify(uniqueStudents)).first<{ count: number }>();
    if (Number(students?.count ?? 0) !== uniqueStudents.length) throw new Error("invalid_student_ids");
  }
  await db.batch([
    db.prepare("DELETE FROM guardian_student_links WHERE tenant_id=? AND guardian_user_id=?")
      .bind(input.tenantId, input.guardianUserId),
    ...uniqueStudents.map((studentUserId) => db.prepare("INSERT INTO guardian_student_links (tenant_id,guardian_user_id,student_user_id,verified_at,status) VALUES (?,?,?,CURRENT_TIMESTAMP,'active')")
      .bind(input.tenantId, input.guardianUserId, studentUserId)),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "guardian_links.updated", "user", input.guardianUserId, JSON.stringify({ studentUserIds: uniqueStudents })),
  ]);
}
