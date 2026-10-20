import { createMember, resetMemberPassword, setGuardianLinks, setMemberStatus } from "../membership-service";
import type { PlatformRole } from "../platform-store";
import { text, requireText, audit, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

const allowedInviteRoles = new Set<PlatformRole>(["student", "teacher", "guardian", "admin"]);

export const membershipCommands = {
  create_member: async (body, context) => {
    const { db, tenantId, userId } = context;
    const member = await createMember(db, {
      tenantId, actorUserId: userId, email: requireText(body.email, "member_email", 200),
      displayName: text(body.displayName, 120), role: requireText(body.role, "member_role", 20) as PlatformRole,
      temporaryPassword: requireText(body.temporaryPassword, "temporary_password", 200),
    });
    return Response.json(member, { status: 201 });
  },

  reset_member_password: async (body, context) => {
    const { db, tenantId, userId } = context;
    await resetMemberPassword(db, { tenantId, actorUserId: userId, userId: requireText(body.userId, "member_id", 120), temporaryPassword: requireText(body.temporaryPassword, "temporary_password", 200) });
    return Response.json({ ok: true });
  },

  set_member_status: async (body, context) => {
    const { db, tenantId, userId } = context;
    const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : null;
    if (!status) throw new Error("invalid_member_status");
    await setMemberStatus(db, { tenantId, actorUserId: userId, userId: requireText(body.userId, "member_id", 120), status });
    return Response.json({ ok: true, status });
  },

  set_guardian_links: async (body, context) => {
    const { db, tenantId, userId } = context;
    const studentUserIds = Array.isArray(body.studentUserIds) ? body.studentUserIds.map((value) => text(value, 120)).filter(Boolean) : [];
    await setGuardianLinks(db, { tenantId, actorUserId: userId, guardianUserId: requireText(body.guardianUserId, "guardian_user_id", 120), studentUserIds });
    return Response.json({ ok: true });
  },

  create_invitation: async (body, context) => {
    const { db, tenantId, userId } = context;
    const email = requireText(body.email, "email", 200).toLowerCase();
    const role = text(body.role, 20) as PlatformRole;
    if (!/^\S+@\S+\.\S+$/.test(email) || !allowedInviteRoles.has(role)) return Response.json({ error: "invalid_invitation" }, { status: 400 });
    const id = crypto.randomUUID(), token = crypto.randomUUID().replaceAll("-", "");
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
    await db.prepare("INSERT INTO invitations (id,tenant_id,email,role,token,status,invited_by,expires_at) VALUES (?,?,?,?,?,'pending',?,?)").bind(id, tenantId, email, role, token, userId, expiresAt).run();
    await audit(db, tenantId, userId, "invitation.created", "invitation", id, { email, role });
    return Response.json({ id, email, role, token, expiresAt }, { status: 201 });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
