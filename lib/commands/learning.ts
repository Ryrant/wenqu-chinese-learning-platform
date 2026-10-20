import { answerReviewItem, submitDiagnostic, updateRecommendationStatus } from "../learning-loop-service";
import { createStudentSubmission } from "../submission-service";
import { text, requireText, number, audit, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const learningCommands = {
  submit_text: async (body, context) => {
    const { db } = context;
    const assignmentId = requireText(body.assignmentId, "assignment_id");
    const answer = requireText(body.answer, "answer", 10000);
    const result = await createStudentSubmission(db, context, { id: body.submissionId === undefined ? undefined : requireText(body.submissionId, "submission_id", 120), assignmentId, textAnswer: answer, familyTaskId: text(body.familyTaskId, 120) || null,
      sequenceId: text(body.sequenceId, 120) || null, sequenceStage: body.sequenceStage === undefined ? undefined : requireText(body.sequenceStage, "sequence_stage", 30),
      familyPartner: body.familyPartner === undefined ? undefined : requireText(body.familyPartner, "exchange_partner", 30),
      familyRevision: body.familyRevision === undefined ? undefined : Number(body.familyRevision) });
    return Response.json(result, { status: 201 });
  },

  submit_diagnostic: async (body, context) => {
    const { db } = context;
    const answers = Array.isArray(body.answers) ? body.answers.map((value) => {
      const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return { itemId: text(item.itemId, 120), selectedOption: number(item.selectedOption, -1), revision: number(item.revision, -1) };
    }) : [];
    const result = await submitDiagnostic(db, context, { id: body.attemptId === undefined ? undefined : requireText(body.attemptId, "diagnostic_attempt_id", 120), level: text(body.level, 20) || "A2", answers });
    return Response.json(result, { status: 201 });
  },

  answer_review_item: async (body, context) => {
    const { db, tenantId, userId } = context;
    const result = await answerReviewItem(db, context, {
      recommendationId: requireText(body.id, "recommendation_id", 120),
      selectedOption: number(body.selectedOption, -1),
      revision: number(body.revision, -1),
    });
    await audit(db, tenantId, userId, "review_item.answered", "learning_recommendation", result.id, { correct: result.correct });
    return Response.json(result);
  },

  update_recommendation_status: async (body, context) => {
    const { db, tenantId, userId } = context;
    const status = body.status === "completed" ? "completed" : body.status === "pending" ? "pending" : null;
    if (!status) throw new Error("invalid_recommendation_status");
    const result = await updateRecommendationStatus(db, context, { id: requireText(body.id, "recommendation_id", 120), status });
    await audit(db, tenantId, userId, "recommendation.status_updated", "learning_recommendation", result.id, { status });
    return Response.json(result);
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
