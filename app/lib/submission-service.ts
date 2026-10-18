import { ensurePlatformRuntime, type PlatformDatabase } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";
import type { DiagnosticMode, WorkDiagnosticSnapshot } from "./diagnostic-types";
import { exchangePartner, FAMILY_EXCHANGE_RUBRIC, readFamilyPlan, type FamilyWorkSnapshot } from "./family-task";
import { assertSequenceTarget } from "./learning-sequence-service";

export type SubmissionTargetInput = { assignmentId: string; familyTaskId?: string | null; familyPartner?: string; familyRevision?: number; sequenceId?: string | null; sequenceStage?: string };
export async function assertSubmissionTarget(db: PlatformDatabase, context: PlatformContext, input: SubmissionTargetInput) {
  if (typeof input.assignmentId !== "string" || !input.assignmentId.trim()) throw new Error("invalid_assignment_id");
  if (input.familyTaskId != null && typeof input.familyTaskId !== "string") throw new Error("invalid_family_task_id");
  const assignment = await db.prepare(`SELECT a.id,a.title,a.diagnostic_mode AS diagnosticMode,a.diagnostic_prompt AS diagnosticPrompt,
      a.diagnostic_media_id AS diagnosticMediaId,a.rubric_json AS rubricJson FROM assignments a
    WHERE a.id=? AND a.tenant_id=? AND a.status='published'
      AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=a.tenant_id AND e.class_id=a.class_id AND e.student_user_id=? AND e.status='active')`)
    .bind(input.assignmentId, context.tenantId, context.userId).first<{ id: string; title: string; diagnosticMode: DiagnosticMode; diagnosticPrompt: string; diagnosticMediaId: string | null; rubricJson: string }>();
  if (!assignment) throw new Error("published_assignment_not_found");
  const sequenceSnapshot = await assertSequenceTarget(db, context, input);
  let familySnapshot: FamilyWorkSnapshot | null = null;
  let familyPlanJson: string | null = null;
  if (input.familyTaskId) {
    const task = await db.prepare(`SELECT lr.id,lr.title,lr.detail,lr.objective_id AS objectiveId,lo.title AS objectiveTitle,lr.family_plan_json AS familyPlanJson
      FROM learning_recommendations lr JOIN learning_objectives lo ON lo.id=lr.objective_id AND lo.tenant_id=lr.tenant_id
      WHERE lr.id=? AND lr.tenant_id=? AND lr.student_user_id=? AND lr.assignment_id=?
        AND lr.source_type='family' AND lr.status='pending' AND lr.archived_at IS NULL`)
      .bind(input.familyTaskId, context.tenantId, context.userId, input.assignmentId)
      .first<{ id: string; title: string; detail: string; objectiveId: string; objectiveTitle: string; familyPlanJson: string }>();
    if (!task) throw new Error("family_task_not_found");
    const plan = readFamilyPlan(task.familyPlanJson);
    if (input.familyRevision !== undefined && (!Number.isInteger(input.familyRevision) || input.familyRevision < 0)) throw new Error("invalid_family_revision");
    if (input.familyRevision !== undefined && input.familyRevision !== (plan?.revision ?? 0)) throw new Error("family_task_changed");
    familySnapshot = { version: 1, title: task.title, detail: task.detail, objectiveId: task.objectiveId, objectiveTitle: task.objectiveTitle,
      partner: exchangePartner(input.familyPartner ?? plan?.partner ?? "family"), plan,
      rubric: plan?.template ? FAMILY_EXCHANGE_RUBRIC : JSON.parse(assignment.rubricJson) };
    familyPlanJson = task.familyPlanJson;
  }
  return { ...assignment, familySnapshot, familyPlanJson, sequenceSnapshot,
    diagnosticMode: sequenceSnapshot ? sequenceSnapshot.medium === "audio" ? "speaking" as const : "writing" as const : assignment.diagnosticMode };
}

export async function createStudentSubmission(db: PlatformDatabase, context: PlatformContext, input: SubmissionTargetInput & {
  id?: string; assignmentId: string; familyTaskId?: string | null; textAnswer?: string | null; assetKey?: string | null;
}) {
  const assignment = await assertSubmissionTarget(db, context, input);
  if (input.textAnswer != null && typeof input.textAnswer !== "string") throw new Error("invalid_submission_answer");
  if (input.assetKey != null && typeof input.assetKey !== "string") throw new Error("invalid_asset_key");
  const answer = input.textAnswer?.trim().slice(0, 10000) || null;
  if (!answer && !input.assetKey) throw new Error("invalid_submission_answer");
  if ((assignment.diagnosticMode === "speaking" && !input.assetKey)
    || (assignment.diagnosticMode === "writing" && (!answer || input.assetKey))) throw new Error("invalid_diagnostic_submission");
  if (input.assetKey) {
    if (!input.assetKey.startsWith(`${context.tenantId}/submissions/`)) throw new Error("forbidden");
    const object = await (await ensurePlatformRuntime()).storage?.get(input.assetKey);
    if (object?.customMetadata.studentUserId !== context.userId || object.customMetadata.tenantId !== context.tenantId) throw new Error("forbidden");
  }
  const id = input.id ?? crypto.randomUUID();
  let snapshot: WorkDiagnosticSnapshot | null = null;
  if (assignment.diagnosticMode && !assignment.sequenceSnapshot) {
    const objectives = await db.prepare(`SELECT lo.id,lo.title FROM assignment_objectives ao
      JOIN learning_objectives lo ON lo.id=ao.objective_id AND lo.tenant_id=ao.tenant_id
      WHERE ao.tenant_id=? AND ao.assignment_id=?`).bind(context.tenantId, input.assignmentId).all<{ id: string; title: string }>();
    snapshot = { version: 1, ability: assignment.diagnosticMode, title: assignment.title, prompt: assignment.diagnosticPrompt,
      mediaId: assignment.diagnosticMediaId, objectives: objectives.results, rubric: JSON.parse(assignment.rubricJson) };
  }
  try {
    const results = await db.batch([
      db.prepare(`INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,asset_key,family_task_id,diagnostic_snapshot_json,family_snapshot_json,sequence_id,sequence_stage,sequence_snapshot_json,confidence,review_status)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,0,'human_review'
        WHERE ? IS NULL OR EXISTS (SELECT 1 FROM learning_recommendations lr
          WHERE lr.id=? AND lr.tenant_id=? AND lr.student_user_id=? AND lr.assignment_id=?
            AND lr.source_type='family' AND lr.status='pending' AND lr.archived_at IS NULL AND lr.family_plan_json=?)`)
        .bind(id, context.tenantId, input.assignmentId, context.userId, answer, input.assetKey ?? null, input.familyTaskId || null, snapshot ? JSON.stringify(snapshot) : "{}", assignment.familySnapshot ? JSON.stringify(assignment.familySnapshot) : "{}",
          assignment.sequenceSnapshot?.sequenceId ?? null, assignment.sequenceSnapshot?.stage ?? null, assignment.sequenceSnapshot ? JSON.stringify(assignment.sequenceSnapshot) : "{}",
          input.familyTaskId || null, input.familyTaskId || null, context.tenantId, context.userId, input.assignmentId, assignment.familyPlanJson),
      db.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM submissions WHERE id=? AND tenant_id=?)`)
        .bind(crypto.randomUUID(), context.tenantId, context.userId, "submission.created", "submission", id, JSON.stringify({ medium: input.assetKey ? "audio" : "text", familyTaskId: input.familyTaskId || null }), id, context.tenantId),
    ]);
    if (!results[0].meta.changes) {
      const active = await db.prepare("SELECT id FROM learning_recommendations WHERE id=? AND tenant_id=? AND student_user_id=? AND source_type='family' AND status='pending' AND archived_at IS NULL")
        .bind(input.familyTaskId ?? null, context.tenantId, context.userId).first();
      throw new Error(active ? "family_task_changed" : "family_task_not_found");
    }
  } catch (error) {
    if (input.familyTaskId && error instanceof Error && error.message.includes("submissions.tenant_id, submissions.family_task_id")) throw new Error("family_submission_pending");
    if (input.sequenceId && error instanceof Error && error.message.includes("submissions.tenant_id, submissions.sequence_id, submissions.sequence_stage")) throw new Error("sequence_submission_pending");
    throw error;
  }
  return { id, reviewStatus: "human_review" };
}
