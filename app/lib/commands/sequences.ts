import { createLearningSequence, scheduleDelayedRetest, publishTeachingNextStep } from "../learning-sequence-service";
import { createTrialRecord, voidTrialRecord } from "../trial-service";
import { text, requireText, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const sequencesCommands = {
  create_trial_record: async (body, context) => {
    const { db } = context;
    return Response.json(await createTrialRecord(db, context, {
      id: requireText(body.id, "trial_record_id", 120), sequenceId: requireText(body.sequenceId, "sequence_id", 120),
      kind: requireText(body.kind, "trial_kind", 40), method: body.method, minutes: body.minutes,
      referenceSubmissionId: text(body.referenceSubmissionId, 120) || null, note: requireText(body.note, "trial_note", 2000),
    }), { status: 201 });
  },

  void_trial_record: async (body, context) => {
    const { db } = context;
    return Response.json(await voidTrialRecord(db, context, {
      id: requireText(body.id, "trial_record_id", 120), reason: requireText(body.reason, "trial_void_reason", 1000),
    }));
  },

  publish_teaching_next_step: async (body, context) => {
    const { db } = context;
    const result = await publishTeachingNextStep(db, context, {
      id: requireText(body.id, "teaching_decision_id", 120), sequenceId: requireText(body.sequenceId, "sequence_id", 120),
      referenceSubmissionId: requireText(body.referenceSubmissionId, "reference_submission_id", 120), kind: requireText(body.kind, "teaching_decision", 40),
      rationale: requireText(body.rationale, "decision_rationale", 2000), remaining: requireText(body.remaining, "decision_remaining", 1000),
      title: requireText(body.title, "sequence_title", 120), practicePrompt: requireText(body.practicePrompt, "practice_prompt", 2000),
      transferPrompt: requireText(body.transferPrompt, "transfer_prompt", 2000), transferContext: requireText(body.transferContext, "transfer_context", 1000),
    });
    return Response.json(result, { status: 201 });
  },

  schedule_delayed_retest: async (body, context) => {
    const { db } = context;
    const result = await scheduleDelayedRetest(db, context, {
      sequenceId: requireText(body.sequenceId, "sequence_id", 120), referenceSubmissionId: requireText(body.referenceSubmissionId, "reference_submission_id", 120),
      prompt: requireText(body.prompt, "retest_prompt", 2000), context: requireText(body.context, "retest_context", 1000),
      availableAt: requireText(body.availableAt, "retest_available_at", 80),
    });
    return Response.json(result, { status: 201 });
  },

  create_learning_sequence: async (body, context) => {
    const { db } = context;
    const result = await createLearningSequence(db, context, {
      id: body.id === undefined ? undefined : requireText(body.id, "sequence_id", 120),
      baselineSubmissionId: requireText(body.baselineSubmissionId, "baseline_submission_id", 120), objectiveId: requireText(body.objectiveId, "objective_id", 120),
      title: requireText(body.title, "sequence_title", 120), practicePrompt: requireText(body.practicePrompt, "practice_prompt", 2000),
      transferPrompt: requireText(body.transferPrompt, "transfer_prompt", 2000), transferContext: requireText(body.transferContext, "transfer_context", 1000),
    });
    return Response.json(result, { status: 201 });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
