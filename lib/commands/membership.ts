import { createMember, resetMemberPassword, setGuardianLinks, setMemberStatus } from "../membership-service";
import type { PlatformRole } from "../platform-store";
import { text, requireText, requireStringArray, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

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
    const studentUserIds = requireStringArray(body.studentUserIds, "student_ids");
    await setGuardianLinks(db, { tenantId, actorUserId: userId, guardianUserId: requireText(body.guardianUserId, "guardian_user_id", 120), studentUserIds });
    return Response.json({ ok: true });
  },

} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
