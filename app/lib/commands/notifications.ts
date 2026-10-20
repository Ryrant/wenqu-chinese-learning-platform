import { text, requireText, audit, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const notificationsCommands = {
  create_reminder: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = crypto.randomUUID();
    const title = requireText(body.title, "title");
    const scheduledFor = requireText(body.scheduledFor, "scheduled_for", 40);
    await db.prepare("INSERT INTO notifications (id,tenant_id,user_id,title,detail,kind,scheduled_for) VALUES (?,?,?,?,?,'reminder',?)").bind(id, tenantId, userId, title, text(body.detail, 500) || "家庭练习提醒", scheduledFor).run();
    await audit(db, tenantId, userId, "reminder.created", "notification", id, { scheduledFor });
    return Response.json({ id, scheduledFor }, { status: 201 });
  },

  mark_notification: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = requireText(body.id, "notification_id");
    await db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND user_id=?").bind(id, tenantId, userId).run();
    return Response.json({ id, read: true });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
