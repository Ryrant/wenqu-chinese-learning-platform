import type { FamilyPlan } from "./family-task";

export const PARTICIPATION_LABELS = { not_started: ["尚未开始", "Not started"], in_progress: ["正在尝试", "In progress"], completed: ["家长报告已完成", "Reported complete"], unable: ["无法完成", "Unable to complete"], stopped: ["中途停止", "Stopped"] } as const;
export const INSTRUCTION_LABELS = { clear: ["能看懂说明", "Clear"], needs_explanation: ["需要进一步解释", "Needs explanation"], unclear: ["仍未看懂", "Still unclear"], not_read: ["尚未阅读", "Not read yet"] } as const;
export const OPERATION_LABELS = { none: ["不需要操作帮助", "No help needed"], guidance: ["需要操作指引", "Needs guidance"], hands_on: ["需要他人协助操作", "Needs hands-on help"], unavailable: ["需要帮助但未获得", "Help was unavailable"] } as const;
export const ALTERNATIVE_LABELS = { not_needed: ["未需要替代交流", "Not needed"], worked: ["同伴或教师替代可用", "Peer or teacher alternative worked"], did_not_work: ["尝试后仍不可用", "Tried, but did not work"], not_tried: ["需要替代但尚未尝试", "Needed, but not tried"] } as const;
export const FEEDBACK_RESPONSE_LABELS = { clarify: ["解释任务说明", "Clarify instructions"], operation: ["提供操作指引", "Provide platform guidance"], partner: ["安排替代交流", "Arrange an alternative partner"], adjust_task: ["建议调整任务", "Suggest a task adjustment"], other: ["其他具体支持", "Other support"] } as const;
export const FOLLOWUP_OUTCOME_LABELS = { resolved: ["本项使用困难已解决", "This difficulty is resolved"], partly: ["有所改善，仍需帮助", "Partly improved; help is still needed"], unresolved: ["仍有困难", "Still difficult"], not_tried: ["尚未尝试", "Not tried yet"] } as const;
export const FEEDBACK_CASE_LABELS = { unrecorded: ["尚未记录处理", "No support recorded"], awaiting: ["待家长再反馈", "Awaiting family follow-up"], resolved: ["家长报告已解决", "Family reports resolved"], needs_followup: ["仍需跟进", "Further support needed"], not_tried: ["家长尚未尝试", "Family has not tried yet"], not_needed: ["未标记使用困难", "No difficulty reported"], followup: ["后续反馈", "Follow-up"], withdrawn: ["原反馈已撤销", "Feedback withdrawn"] } as const;
export type FollowupOutcome = keyof typeof FOLLOWUP_OUTCOME_LABELS;
export type FamilyFeedbackResponse = { id: string; feedbackId: string; kind: keyof typeof FEEDBACK_RESPONSE_LABELS; detail: string; authorName: string; createdAt: string; voidedAt: string | null; voidReason: string | null; canVoid: boolean };
export type FeedbackFields = { participation: keyof typeof PARTICIPATION_LABELS; instructions: keyof typeof INSTRUCTION_LABELS; operationHelp: keyof typeof OPERATION_LABELS; alternative: keyof typeof ALTERNATIVE_LABELS; note: string };
export type FeedbackSnapshot = { version: 1; title: string; detail: string; objectiveId: string | null; objectiveTitle: string | null; assignmentTitle: string | null; plan: FamilyPlan | null };
export type FeedbackTask = { id: string; studentId: string; studentName: string; classId: string | null; className: string | null; revision: number; status: string; snapshot: FeedbackSnapshot };
export type FamilyFeedbackEntry = FeedbackFields & {
  id: string; taskId: string; studentId: string; studentName: string; classId: string | null; className: string | null; revision: number; snapshot: FeedbackSnapshot;
  authorName: string; createdAt: string; voidedAt: string | null; voidReason: string | null; canVoid: boolean;
  responseId: string | null; followupOutcome: FollowupOutcome | null; responses: FamilyFeedbackResponse[]; canRespond: boolean;
};
export type FamilyFeedbackData = { tasks: FeedbackTask[]; entries: FamilyFeedbackEntry[]; generatedAt: string };
export type FeedbackView = "guardian" | "teaching";
export function feedbackReasonRequired(value: Pick<FeedbackFields, "participation" | "instructions" | "operationHelp" | "alternative">) {
  return value.participation === "unable" || value.participation === "stopped" || value.instructions === "needs_explanation" || value.instructions === "unclear"
    || value.operationHelp !== "none" || value.alternative === "did_not_work" || value.alternative === "not_tried";
}
export function feedbackCaseState(entry: FamilyFeedbackEntry, entries: FamilyFeedbackEntry[]): keyof typeof FEEDBACK_CASE_LABELS {
  if (entry.voidedAt) return "withdrawn";
  if (entry.responseId) return "followup";
  if (!feedbackReasonRequired(entry) && !entry.responses.length) return "not_needed";
  const response = entry.responses.find((item) => !item.voidedAt);
  if (!response) return "unrecorded";
  const followup = entries.find((item) => item.responseId === response.id && !item.voidedAt);
  if (!followup) return "awaiting";
  return followup.followupOutcome === "resolved" ? "resolved" : followup.followupOutcome === "not_tried" ? "not_tried" : "needs_followup";
}
