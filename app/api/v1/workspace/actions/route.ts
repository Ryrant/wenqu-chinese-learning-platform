import { createMember, resetMemberPassword, setGuardianLinks, setMemberStatus } from "../../../../lib/membership-service";
import { assertSubmissionReviewAccess } from "../../../../lib/access-control";
import { platformApiError, platformContext, type PlatformRole } from "../../../../lib/platform-store";

type ActionBody = { action?: string; [key: string]: unknown };
const allowedInviteRoles = new Set<PlatformRole>(["student", "teacher", "guardian", "admin"]);

function text(value: unknown, max = 200) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function requireText(value: unknown, name: string, max = 200) { const result = text(value, max); if (!result) throw new Error(`invalid_${name}`); return result; }
function number(value: unknown, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

async function audit(db: D1Database, tenantId: string, userId: string, action: string, targetType: string, targetId: string, detail: unknown = {}) {
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), tenantId, userId, action, targetType, targetId, JSON.stringify(detail)).run();
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as ActionBody;
    const action = requireText(body.action, "action", 60);
    const roleByAction: Record<string, PlatformRole> = {
      create_class: "teacher", create_assignment: "teacher", publish_assignment: "teacher", generate_lesson: "teacher", review_submission: "teacher",
      create_reminder: "guardian", update_consent: "guardian",
      create_invitation: "admin", review_content: "admin", create_member: "admin", reset_member_password: "admin", set_member_status: "admin", set_guardian_links: "admin", mark_notification: "student",
      submit_text: "student",
    };
    const context = await platformContext(request, roleByAction[action]);
    const { db, tenantId, userId } = context;
    const isAdmin = context.roles.includes("admin");

    if (action === "create_member") {
      const member = await createMember(db, {
        tenantId, actorUserId: userId, email: requireText(body.email, "member_email", 200),
        displayName: text(body.displayName, 120), role: requireText(body.role, "member_role", 20) as PlatformRole,
        temporaryPassword: requireText(body.temporaryPassword, "temporary_password", 200),
      });
      return Response.json(member, { status: 201 });
    }

    if (action === "reset_member_password") {
      await resetMemberPassword(db, { tenantId, actorUserId: userId, userId: requireText(body.userId, "member_id", 120), temporaryPassword: requireText(body.temporaryPassword, "temporary_password", 200) });
      return Response.json({ ok: true });
    }

    if (action === "set_member_status") {
      const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : null;
      if (!status) throw new Error("invalid_member_status");
      await setMemberStatus(db, { tenantId, actorUserId: userId, userId: requireText(body.userId, "member_id", 120), status });
      return Response.json({ ok: true, status });
    }

    if (action === "set_guardian_links") {
      const studentUserIds = Array.isArray(body.studentUserIds) ? body.studentUserIds.map((value) => text(value, 120)).filter(Boolean) : [];
      await setGuardianLinks(db, { tenantId, actorUserId: userId, guardianUserId: requireText(body.guardianUserId, "guardian_user_id", 120), studentUserIds });
      return Response.json({ ok: true });
    }

    if (action === "create_class") {
      const id = crypto.randomUUID();
      const name = requireText(body.name, "class_name");
      const level = requireText(body.level, "level", 20);
      await db.prepare("INSERT INTO classes (id,tenant_id,name,level,teacher_user_id,academic_year) VALUES (?,?,?,?,?,?)").bind(id, tenantId, name, level, userId, String(new Date().getFullYear())).run();
      await audit(db, tenantId, userId, "class.created", "class", id, { name, level });
      return Response.json({ id, name, level }, { status: 201 });
    }

    if (action === "create_assignment") {
      const id = crypto.randomUUID();
      const title = requireText(body.title, "title");
      const classId = requireText(body.classId, "class_id");
      const activityType = requireText(body.activityType, "activity_type", 80);
      const owned = await db.prepare("SELECT id FROM classes WHERE id=? AND tenant_id=? AND (teacher_user_id=? OR ?=1)").bind(classId, tenantId, userId, isAdmin ? 1 : 0).first();
      if (!owned) return Response.json({ error: "class_not_found" }, { status: 404 });
      const dueAt = text(body.dueAt, 40) || null;
      await db.prepare("INSERT INTO assignments (id,tenant_id,class_id,title,activity_type,status,due_at,created_by) VALUES (?,?,?,?,?,'draft',?,?)").bind(id, tenantId, classId, title, activityType, dueAt, userId).run();
      await audit(db, tenantId, userId, "assignment.created", "assignment", id, { title });
      return Response.json({ id, status: "draft" }, { status: 201 });
    }

    if (action === "publish_assignment") {
      const id = requireText(body.id, "assignment_id");
      const result = await db.prepare("UPDATE assignments SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status IN ('draft','review') AND (?=1 OR class_id IN (SELECT id FROM classes WHERE tenant_id=? AND teacher_user_id=?))").bind(id, tenantId, isAdmin ? 1 : 0, tenantId, userId).run();
      if (!result.meta.changes) return Response.json({ error: "assignment_not_publishable" }, { status: 409 });
      await audit(db, tenantId, userId, "assignment.published", "assignment", id);
      return Response.json({ id, status: "published" });
    }

    if (action === "generate_lesson") {
      const topic = requireText(body.topic, "topic");
      const level = text(body.level, 20) || "A2";
      const duration = Math.max(20, Math.min(number(body.duration, 40), 90));
      const rows = await db.prepare(`SELECT k.id,k.content,d.title FROM knowledge_chunks k JOIN source_documents d ON d.id=k.source_document_id AND d.tenant_id=k.tenant_id WHERE k.tenant_id=? AND k.published=1 ORDER BY CASE WHEN k.content LIKE ? THEN 0 ELSE 1 END,k.created_at DESC LIMIT 5`).bind(tenantId, `%${topic.slice(0, 8)}%`).all<{ id: string; content: string; title: string }>();
      if (!rows.results.length) return Response.json({ error: "no_reviewed_sources" }, { status: 422 });
      const id = crypto.randomUUID();
      const title = `《${topic}》互动课`;
      const objectives = [`能用完整句描述${topic}`, "能从人物、事物和动作组织表达", "能说明主题中的文化含义"];
      const activities = [
        { minutes: 6, title: "看图找线索", detail: "圈出人物、事物与动作，用词卡说短语。" },
        { minutes: 10, title: "来源共读", detail: rows.results[0].content },
        { minutes: Math.max(8, duration - 24), title: "同伴表达", detail: "使用目标句型完成两轮问答并互相追问。" },
        { minutes: 8, title: "出口任务", detail: "录制 30 秒口语，教师依据完整度与准确度审核。" },
      ];
      const citations = rows.results.map((row) => ({ id: row.id, title: row.title, excerpt: row.content }));
      await db.prepare("INSERT INTO lesson_plans (id,tenant_id,title,topic,level,duration_minutes,objectives_json,activities_json,citations_json,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,'draft',?)").bind(id, tenantId, title, topic, level, duration, JSON.stringify(objectives), JSON.stringify(activities), JSON.stringify(citations), userId).run();
      await audit(db, tenantId, userId, "lesson_plan.generated", "lesson_plan", id, { sourceCount: citations.length, engine: "source-grounded-template" });
      return Response.json({ id, title, topic, level, durationMinutes: duration, objectives, activities, citations, status: "draft", engine: "source-grounded-template" }, { status: 201 });
    }

    if (action === "submit_text") {
      const assignmentId = requireText(body.assignmentId, "assignment_id");
      const answer = requireText(body.answer, "answer", 10000);
      const assignment = await db.prepare("SELECT a.id FROM assignments a WHERE a.id=? AND a.tenant_id=? AND a.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=a.tenant_id AND e.class_id=a.class_id AND e.student_user_id=? AND e.status='active')").bind(assignmentId, tenantId, userId).first();
      if (!assignment) return Response.json({ error: "published_assignment_not_found" }, { status: 404 });
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,review_status,confidence) VALUES (?,?,?,?,?,'human_review',0)").bind(id, tenantId, assignmentId, userId, answer).run();
      await audit(db, tenantId, userId, "submission.created", "submission", id, { medium: "text" });
      return Response.json({ id, reviewStatus: "human_review" }, { status: 201 });
    }

    if (action === "review_submission") {
      const id = requireText(body.id, "submission_id");
      const score = Math.max(0, Math.min(number(body.score, 0), 100));
      await assertSubmissionReviewAccess(db, context, id);
      const result = await db.prepare("UPDATE submissions SET score=?,confidence=1,review_status='reviewed' WHERE id=? AND tenant_id=?").bind(score, id, tenantId).run();
      if (!result.meta.changes) return Response.json({ error: "submission_not_found" }, { status: 404 });
      await audit(db, tenantId, userId, "submission.reviewed", "submission", id, { score });
      return Response.json({ id, score, reviewStatus: "reviewed" });
    }

    if (action === "create_reminder") {
      const id = crypto.randomUUID();
      const title = requireText(body.title, "title");
      const scheduledFor = requireText(body.scheduledFor, "scheduled_for", 40);
      await db.prepare("INSERT INTO notifications (id,tenant_id,user_id,title,detail,kind,scheduled_for) VALUES (?,?,?,?,?,'reminder',?)").bind(id, tenantId, userId, title, text(body.detail, 500) || "家庭练习提醒", scheduledFor).run();
      await audit(db, tenantId, userId, "reminder.created", "notification", id, { scheduledFor });
      return Response.json({ id, scheduledFor }, { status: 201 });
    }

    if (action === "update_consent") {
      const scope = requireText(body.scope, "scope", 80);
      const status = body.status === "withdrawn" ? "withdrawn" : "granted";
      const id = `${tenantId}-consent-${scope.replace(/[^a-z0-9_-]/gi, "-")}`;
      await db.prepare(`INSERT INTO consent_records (id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,created_at=CURRENT_TIMESTAMP`).bind(id, tenantId, userId, userId, scope, status).run();
      await audit(db, tenantId, userId, "consent.updated", "consent", id, { scope, status });
      return Response.json({ id, scope, status });
    }

    if (action === "create_invitation") {
      const email = requireText(body.email, "email", 200).toLowerCase();
      const role = text(body.role, 20) as PlatformRole;
      if (!/^\S+@\S+\.\S+$/.test(email) || !allowedInviteRoles.has(role)) return Response.json({ error: "invalid_invitation" }, { status: 400 });
      const id = crypto.randomUUID(), token = crypto.randomUUID().replaceAll("-", "");
      const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      await db.prepare("INSERT INTO invitations (id,tenant_id,email,role,token,status,invited_by,expires_at) VALUES (?,?,?,?,?,'pending',?,?)").bind(id, tenantId, email, role, token, userId, expiresAt).run();
      await audit(db, tenantId, userId, "invitation.created", "invitation", id, { email, role });
      return Response.json({ id, email, role, token, expiresAt }, { status: 201 });
    }

    if (action === "review_content") {
      const id = requireText(body.id, "document_id");
      const next = body.status === "published" ? "published" : body.status === "rejected" ? "rejected" : "review";
      const rights = next === "published" ? "approved" : "pending";
      const result = await db.prepare("UPDATE source_documents SET processing_status=?,rights_status=? WHERE id=? AND tenant_id=?").bind(next, rights, id, tenantId).run();
      if (!result.meta.changes) return Response.json({ error: "document_not_found" }, { status: 404 });
      await audit(db, tenantId, userId, "source.reviewed", "source_document", id, { status: next });
      return Response.json({ id, status: next });
    }

    if (action === "mark_notification") {
      const id = requireText(body.id, "notification_id");
      await db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND user_id=?").bind(id, tenantId, userId).run();
      return Response.json({ id, read: true });
    }

    return Response.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid_")) return Response.json({ error: error.message }, { status: 400 });
    return platformApiError(error);
  }
}
