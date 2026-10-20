import type { WorkspaceActionName } from "../workspace-actions";
import type { WorkspaceSection } from "../platform-types";

const changedSections: Record<WorkspaceActionName, readonly WorkspaceSection[]> = {
  answer_review_item: ["progress", "quality"],
  archive_content: ["content", "quality"], archive_family_task: ["progress"], archive_lesson_plan: ["lessons"],
  confirm_alternative_exchange: ["progress"], confirm_family_submission: ["progress"],
  confirm_submission_review: ["progress", "teaching", "quality"],
  create_assignment: ["teaching", "progress", "quality"], create_class: ["teaching"],
  create_family_task: ["progress", "notifications"], create_intervention: ["progress"], create_invitation: ["members"],
  create_learning_sequence: ["progress"], create_member: ["members"], create_reminder: ["notifications"], create_trial_record: ["trials"],
  generate_lesson: ["lessons", "quality"], mark_notification: ["notifications"],
  publish_assignment: ["teaching", "progress", "quality"], publish_teaching_next_step: ["progress", "notifications"],
  reprocess_content: ["content", "quality"], reset_member_password: ["members"], review_content: ["content", "quality"],
  review_submission: ["progress", "teaching", "quality"], schedule_delayed_retest: ["progress"],
  set_class_enrollments: ["teaching", "progress", "quality"], set_guardian_links: ["members", "teaching", "progress", "consents", "quality"],
  set_member_status: ["members", "teaching", "progress", "consents", "quality"],
  submit_diagnostic: ["progress", "quality"], submit_text: ["progress", "teaching", "quality"],
  suggest_intervention: [], suggest_text_review: ["progress", "quality"], update_consent: ["consents", "quality"],
  update_family_task: ["progress"], update_lesson_plan: ["lessons"], update_recommendation_status: ["progress", "quality"],
  upsert_diagnostic_item: ["curriculum", "progress", "quality"], upsert_learning_objective: ["curriculum", "progress", "quality"], void_trial_record: ["trials"],
};

export function sectionsChangedByAction(action: string): readonly WorkspaceSection[] {
  return Object.hasOwn(changedSections, action) ? changedSections[action as WorkspaceActionName] : [];
}
