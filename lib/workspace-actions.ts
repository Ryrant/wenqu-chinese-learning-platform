import type { PlatformRole } from "./platform-store";

/** 命令名称与入口最低角色；具体对象权限继续由各领域服务校验。 */
export const workspaceActionRoles = {
  answer_review_item: "student",
  archive_content: "admin",
  archive_family_task: "guardian",
  archive_lesson_plan: "teacher",
  confirm_alternative_exchange: "teacher",
  confirm_family_submission: "guardian",
  confirm_submission_review: "teacher",
  create_assignment: "teacher",
  create_class: "teacher",
  create_family_task: "guardian",
  create_intervention: "teacher",
  create_learning_sequence: "teacher",
  create_member: "admin",
  create_reminder: "guardian",
  create_trial_record: "teacher",
  generate_lesson: "teacher",
  mark_notification: undefined,
  publish_assignment: "teacher",
  publish_teaching_next_step: "teacher",
  reprocess_content: "admin",
  reset_member_password: "admin",
  review_content: "admin",
  review_submission: "teacher",
  schedule_delayed_retest: "teacher",
  set_class_enrollments: "admin",
  set_guardian_links: "admin",
  set_member_status: "admin",
  submit_diagnostic: "student",
  submit_text: "student",
  suggest_intervention: "teacher",
  suggest_text_review: "teacher",
  update_consent: "guardian",
  update_family_task: "guardian",
  update_lesson_plan: "teacher",
  update_recommendation_status: undefined,
  upsert_diagnostic_item: "admin",
  upsert_learning_objective: "admin",
  void_trial_record: "teacher",
} as const satisfies Record<string, PlatformRole | undefined>;

export type WorkspaceActionName = keyof typeof workspaceActionRoles;

export function workspaceActionRole(action: string): PlatformRole | undefined {
  return Object.hasOwn(workspaceActionRoles, action)
    ? workspaceActionRoles[action as WorkspaceActionName]
    : undefined;
}
