import { archiveFamilyTask, assertGuardianStudentAccess, createFamilyTask, confirmFamilySubmission, updateFamilyTask } from "../learning-loop-service";
import { text, requireText, audit, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

const confirmFamilySubmissionCommand: WorkspaceActionHandler = async (body, context, action) => {
  const { db, tenantId, userId } = context;
  const result = await confirmFamilySubmission(db, context, {
    submissionId: requireText(body.submissionId, "submission_id", 120),
    helpLevel: requireText(body.helpLevel, "family_help_level", 30),
  }, action === "confirm_alternative_exchange");
  await audit(db, tenantId, userId, action === "confirm_alternative_exchange" ? "family_submission.witnessed" : "family_submission.confirmed", "submission", result.submissionId, { helpLevel: result.helpLevel });
  return Response.json(result);
};

export const familyCommands = {
  create_family_task: async (body, context) => {
    const { db, tenantId, userId } = context;
    const result = await createFamilyTask(db, context, {
      studentUserId: requireText(body.studentUserId, "student_user_id", 120),
      assignmentId: requireText(body.assignmentId, "assignment_id", 120),
      objectiveId: requireText(body.objectiveId, "objective_id", 120),
      title: requireText(body.title, "family_task_title", 120),
      detail: text(body.detail, 1000),
      dueAt: text(body.dueAt, 40) || null,
      templateId: body.templateId === undefined ? undefined : text(body.templateId, 80),
      partner: body.partner === undefined ? undefined : requireText(body.partner, "exchange_partner", 30),
    });
    await audit(db, tenantId, userId, "family_task.created", "learning_recommendation", result.id);
    return Response.json(result, { status: 201 });
  },

  update_family_task: async (body, context) => {
    const { db, tenantId, userId } = context;
    const result = await updateFamilyTask(db, context, {
      id: requireText(body.id, "family_task_id", 120),
      assignmentId: requireText(body.assignmentId, "assignment_id", 120),
      objectiveId: requireText(body.objectiveId, "objective_id", 120),
      title: requireText(body.title, "family_task_title", 120),
      detail: text(body.detail, 1000),
      dueAt: text(body.dueAt, 40) || null,
      templateId: body.templateId === undefined ? undefined : text(body.templateId, 80),
      partner: body.partner === undefined ? undefined : requireText(body.partner, "exchange_partner", 30),
      revision: body.revision === undefined ? undefined : Number(body.revision),
    });
    await audit(db, tenantId, userId, "family_task.updated", "learning_recommendation", result.id);
    return Response.json(result);
  },

  archive_family_task: async (body, context) => {
    const { db, tenantId, userId } = context;
    const result = await archiveFamilyTask(db, context, requireText(body.id, "family_task_id", 120));
    await audit(db, tenantId, userId, "family_task.archived", "learning_recommendation", result.id);
    return Response.json(result);
  },

  confirm_family_submission: confirmFamilySubmissionCommand,

  confirm_alternative_exchange: confirmFamilySubmissionCommand,

  update_consent: async (body, context) => {
    const { db, tenantId, userId } = context;
    const scope = requireText(body.scope, "scope", 80);
    const status = body.status === "withdrawn" ? "withdrawn" : "granted";
    const studentUserId = requireText(body.studentUserId, "student_user_id", 120);
    await assertGuardianStudentAccess(db, context, studentUserId);
    const id = `${tenantId}-consent-${studentUserId}-${scope.replace(/[^a-z0-9_-]/gi, "-")}`;
    await db.prepare(`INSERT INTO consent_records (id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,created_at=CURRENT_TIMESTAMP`).bind(id, tenantId, studentUserId, userId, scope, status).run();
    await audit(db, tenantId, userId, "consent.updated", "consent", id, { studentUserId, scope, status });
    return Response.json({ id, studentUserId, scope, status });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
