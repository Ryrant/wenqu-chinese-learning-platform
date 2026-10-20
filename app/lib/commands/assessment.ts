import { confirmSubmissionReview, suggestTextReview } from "../assessment-service";
import { assertSubmissionReviewAccess } from "../access-control";
import { createIntervention } from "../learning-loop-service";
import { aiProviderSettings, loadPlatformSettings } from "../platform-settings";
import { suggestIntervention } from "../intervention-support";
import { text, requireText, audit, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

const reviewSubmissionCommand: WorkspaceActionHandler = async (body, context, action) => {
  const { db } = context;
  const id = requireText(body.id, "submission_id");
  const score = typeof body.score === "number" ? body.score : Number.NaN;
  if (action === "review_submission") await assertSubmissionReviewAccess(db, context, id);
  const result = await confirmSubmissionReview(db, context, { submissionId: id, score, comment: text(body.comment, 2000), objectiveScores: body.objectiveScores, dimensionScores: body.dimensionScores, helpLevel: body.helpLevel, contextConfirmed: body.contextConfirmed, promptCount: body.promptCount });
  return Response.json({ ...result, id, reviewStatus: "reviewed" });
};

export const assessmentCommands = {
  suggest_intervention: async (body, context) => {
    const suggestion = await suggestIntervention(context, requireText(body.studentUserId, "student_user_id", 120), requireText(body.objectiveId, "objective_id", 120));
    return Response.json({ suggestion }, { headers: { "Cache-Control": "private, no-store" } });
  },

  create_intervention: async (body, context) => {
    const { db, tenantId, userId } = context;
    const result = await createIntervention(db, context, {
      studentUserId: requireText(body.studentUserId, "student_user_id", 120),
      objectiveId: requireText(body.objectiveId, "objective_id", 120),
      title: requireText(body.title, "intervention_title", 120),
      detail: text(body.detail, 1000),
      dueAt: text(body.dueAt, 40) || null,
      evidenceKey: body.evidenceKey === undefined ? undefined : requireText(body.evidenceKey, "evidence_key", 64),
    });
    await audit(db, tenantId, userId, "intervention.created", "learning_recommendation", result.id);
    return Response.json(result, { status: 201 });
  },

  suggest_text_review: async (body, context) => {
    const { db, tenantId, userId } = context;
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
  },

  review_submission: reviewSubmissionCommand,

  confirm_submission_review: reviewSubmissionCommand,
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
