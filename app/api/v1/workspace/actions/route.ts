import { generateGroundedText } from "../../../../lib/ai/grounding";
import { confirmSubmissionReview, suggestTextReview } from "../../../../lib/assessment-service";
import { assertSubmissionReviewAccess } from "../../../../lib/access-control";
import { createMember, resetMemberPassword, setGuardianLinks, setMemberStatus } from "../../../../lib/membership-service";
import { publishContent } from "../../../../lib/content-processing";
import { validateRubric } from "../../../../lib/learning-loop";
import {
  answerReviewItem,
  assertGuardianStudentAccess,
  createFamilyTask,
  createIntervention,
  setClassEnrollments,
  submitDiagnostic,
  updateRecommendationStatus,
  upsertDiagnosticItem,
  upsertLearningObjective,
} from "../../../../lib/learning-loop-service";
import { aiProviderSettings, loadPlatformSettings } from "../../../../lib/platform-settings";
import { platformApiError, platformContext, type PlatformRole } from "../../../../lib/platform-store";
import { searchPublishedKnowledge } from "../../../../lib/retrieval";

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
      create_class: "teacher", create_assignment: "teacher", publish_assignment: "teacher", generate_lesson: "teacher", review_submission: "teacher", suggest_text_review: "teacher", confirm_submission_review: "teacher",
      create_reminder: "guardian", update_consent: "guardian",
      create_family_task: "guardian",
      create_intervention: "teacher",
      create_invitation: "admin", review_content: "admin", create_member: "admin", reset_member_password: "admin", set_member_status: "admin", set_guardian_links: "admin", upsert_learning_objective: "admin", upsert_diagnostic_item: "admin", set_class_enrollments: "admin", mark_notification: "student",
      submit_text: "student", submit_diagnostic: "student", answer_review_item: "student",
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

    if (action === "upsert_learning_objective") {
      const result = await upsertLearningObjective(db, context, {
        id: text(body.id, 120) || undefined,
        code: requireText(body.code, "objective_code", 40),
        title: requireText(body.title, "objective_title", 120),
        skill: requireText(body.skill, "objective_skill", 80),
        level: requireText(body.level, "objective_level", 20),
        status: body.status === "inactive" ? "inactive" : "active",
      });
      await audit(db, tenantId, userId, "learning_objective.saved", "learning_objective", result.id, { status: result.status });
      return Response.json(result, { status: body.id ? 200 : 201 });
    }

    if (action === "upsert_diagnostic_item") {
      const options = Array.isArray(body.options) ? body.options.map((value) => text(value, 200)) : [];
      const result = await upsertDiagnosticItem(db, context, {
        id: text(body.id, 120) || undefined,
        objectiveId: requireText(body.objectiveId, "objective_id", 120),
        level: requireText(body.level, "diagnostic_level", 20),
        prompt: requireText(body.prompt, "diagnostic_prompt", 500),
        options,
        correctOption: number(body.correctOption, -1),
        explanation: text(body.explanation, 1000),
        status: body.status === "inactive" ? "inactive" : "active",
      });
      await audit(db, tenantId, userId, "diagnostic_item.saved", "diagnostic_item", result.id, { status: result.status });
      return Response.json(result, { status: body.id ? 200 : 201 });
    }

    if (action === "set_class_enrollments") {
      const studentUserIds = Array.isArray(body.studentUserIds) ? body.studentUserIds.map((value) => text(value, 120)).filter(Boolean) : [];
      const result = await setClassEnrollments(db, context, { classId: requireText(body.classId, "class_id", 120), studentUserIds });
      await audit(db, tenantId, userId, "class.enrollments_updated", "class", result.classId, { studentUserIds: result.studentUserIds });
      return Response.json(result);
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
      const objectiveIds = [...new Set(Array.isArray(body.objectiveIds) ? body.objectiveIds.map((value) => text(value, 120)).filter(Boolean) : [])];
      if (!objectiveIds.length || objectiveIds.length > 3) throw new Error("invalid_objective_ids");
      const placeholders = objectiveIds.map(() => "?").join(",");
      const objectives = await db.prepare(`SELECT id FROM learning_objectives WHERE tenant_id=? AND status='active' AND id IN (${placeholders})`).bind(tenantId, ...objectiveIds).all<{ id: string }>();
      if (objectives.results.length !== objectiveIds.length) throw new Error("invalid_objective_ids");
      const rubric = validateRubric(body.rubric);
      const dueAt = text(body.dueAt, 40) || null;
      await db.batch([
        db.prepare("INSERT INTO assignments (id,tenant_id,class_id,title,activity_type,status,due_at,rubric_json,created_by) VALUES (?,?,?,?,?,'draft',?,?,?)").bind(id, tenantId, classId, title, activityType, dueAt, JSON.stringify(rubric), userId),
        ...objectiveIds.map((objectiveId) => db.prepare("INSERT INTO assignment_objectives (tenant_id,assignment_id,objective_id,weight) VALUES (?,?,?,?)").bind(tenantId, id, objectiveId, 1 / objectiveIds.length)),
      ]);
      await audit(db, tenantId, userId, "assignment.created", "assignment", id, { title, objectiveIds, rubric });
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
      const contextChunks = await searchPublishedKnowledge(db, { tenantId, query: topic, limit: 5 });
      if (!contextChunks.length) return Response.json({ error: "no_reviewed_sources" }, { status: 422 });
      const settings = await loadPlatformSettings(db);
      const result = await generateGroundedText(
        { purpose: "lesson", prompt: topic, contextChunks, role: "teacher", level },
        aiProviderSettings(settings),
      );
      const id = crypto.randomUUID();
      const sessionId = crypto.randomUUID();
      const title = `《${topic}》互动课`;
      const objectives = [`能用完整句描述${topic}`, "能从人物、事物和动作组织表达", "能说明主题中的文化含义"];
      const activities = [{ minutes: duration, title: "AI 来源化教学草稿", detail: result.text }];
      const citations = result.citations;
      await db.prepare("INSERT INTO lesson_plans (id,tenant_id,title,topic,level,duration_minutes,objectives_json,activities_json,citations_json,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,'draft',?)").bind(id, tenantId, title, topic, level, duration, JSON.stringify(objectives), JSON.stringify(activities), JSON.stringify(citations), userId).run();
      await db.prepare("INSERT INTO ai_sessions (id,tenant_id,user_id,purpose,provider,model,status,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?,?,?)").bind(sessionId, tenantId, userId, "lesson", result.provider, result.model, result.status, result.inputTokens, result.outputTokens).run();
      if (citations.length) await db.batch(citations.map((item) => db.prepare("INSERT INTO citations (id,tenant_id,ai_session_id,knowledge_chunk_id,quote) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), tenantId, sessionId, item.id, item.excerpt.slice(0, 500))));
      await audit(db, tenantId, userId, "lesson_plan.generated", "lesson_plan", id, { sourceCount: citations.length, provider: result.provider, model: result.model });
      return Response.json({ id, title, topic, level, durationMinutes: duration, objectives, activities, citations, status: "draft", provider: result.provider, model: result.model }, { status: 201 });
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

    if (action === "submit_diagnostic") {
      const answers = Array.isArray(body.answers) ? body.answers.map((value) => {
        const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return { itemId: text(item.itemId, 120), selectedOption: number(item.selectedOption, -1) };
      }) : [];
      const result = await submitDiagnostic(db, context, { level: text(body.level, 20) || "A2", answers });
      await audit(db, tenantId, userId, "diagnostic.completed", "diagnostic_attempt", result.attemptId, { score: result.score, incorrectCount: result.incorrectCount });
      return Response.json(result, { status: 201 });
    }

    if (action === "answer_review_item") {
      const result = await answerReviewItem(db, context, {
        recommendationId: requireText(body.id, "recommendation_id", 120),
        selectedOption: number(body.selectedOption, -1),
      });
      await audit(db, tenantId, userId, "review_item.answered", "learning_recommendation", result.id, { correct: result.correct });
      return Response.json(result);
    }

    if (action === "create_intervention") {
      const result = await createIntervention(db, context, {
        studentUserId: requireText(body.studentUserId, "student_user_id", 120),
        objectiveId: requireText(body.objectiveId, "objective_id", 120),
        title: requireText(body.title, "intervention_title", 120),
        detail: text(body.detail, 1000),
        dueAt: text(body.dueAt, 40) || null,
      });
      await audit(db, tenantId, userId, "intervention.created", "learning_recommendation", result.id);
      return Response.json(result, { status: 201 });
    }

    if (action === "create_family_task") {
      const result = await createFamilyTask(db, context, {
        studentUserId: requireText(body.studentUserId, "student_user_id", 120),
        title: requireText(body.title, "family_task_title", 120),
        detail: text(body.detail, 1000),
        dueAt: text(body.dueAt, 40) || null,
      });
      await audit(db, tenantId, userId, "family_task.created", "learning_recommendation", result.id);
      return Response.json(result, { status: 201 });
    }

    if (action === "update_recommendation_status") {
      const status = body.status === "completed" ? "completed" : body.status === "pending" ? "pending" : null;
      if (!status) throw new Error("invalid_recommendation_status");
      const result = await updateRecommendationStatus(db, context, { id: requireText(body.id, "recommendation_id", 120), status });
      await audit(db, tenantId, userId, "recommendation.status_updated", "learning_recommendation", result.id, { status });
      return Response.json(result);
    }

    if (action === "suggest_text_review") {
      const id = requireText(body.id, "submission_id");
      let result;
      try {
        result = await suggestTextReview(db, context, id, aiProviderSettings(await loadPlatformSettings(db)));
      } catch (error) {
        if (error instanceof Error && error.message === "no_reviewed_sources") return Response.json({ error: "no_reviewed_sources" }, { status: 422 });
        throw error;
      }
      await audit(db, tenantId, userId, "submission.ai_review_suggested", "submission", id);
      return Response.json(result);
    }

    if (action === "review_submission" || action === "confirm_submission_review") {
      const id = requireText(body.id, "submission_id");
      const score = Math.max(0, Math.min(number(body.score, 0), 100));
      if (action === "review_submission") await assertSubmissionReviewAccess(db, context, id);
      const result = await confirmSubmissionReview(db, context, { submissionId: id, score, comment: text(body.comment, 2000) });
      await audit(db, tenantId, userId, "submission.reviewed", "submission", id, { score });
      return Response.json({ ...result, id, reviewStatus: "reviewed" });
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
      const studentUserId = requireText(body.studentUserId, "student_user_id", 120);
      await assertGuardianStudentAccess(db, context, studentUserId);
      const id = `${tenantId}-consent-${studentUserId}-${scope.replace(/[^a-z0-9_-]/gi, "-")}`;
      await db.prepare(`INSERT INTO consent_records (id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,created_at=CURRENT_TIMESTAMP`).bind(id, tenantId, studentUserId, userId, scope, status).run();
      await audit(db, tenantId, userId, "consent.updated", "consent", id, { studentUserId, scope, status });
      return Response.json({ id, studentUserId, scope, status });
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
      if (body.status !== "published" && body.status !== "rejected") return Response.json({ error: "invalid_content_review_status" }, { status: 400 });
      const next = body.status;
      const document = await db.prepare("SELECT processing_status AS processingStatus FROM source_documents WHERE id=? AND tenant_id=?").bind(id, tenantId).first<{ processingStatus: string }>();
      if (!document) return Response.json({ error: "document_not_found" }, { status: 404 });
      if (next === "published") {
        if (document.processingStatus !== "processed") return Response.json({ error: "document_not_publishable" }, { status: 409 });
        await publishContent(db, { tenantId, sourceDocumentId: id });
      } else {
        await db.batch([
          db.prepare("UPDATE source_documents SET processing_status='rejected',rights_status='pending' WHERE id=? AND tenant_id=?").bind(id, tenantId),
          db.prepare("UPDATE knowledge_chunks SET published=0 WHERE tenant_id=? AND source_document_id=?").bind(tenantId, id),
        ]);
      }
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
