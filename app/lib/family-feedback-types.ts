import type { FamilyPlan } from "./family-task";

export const PARTICIPATION_LABELS = { not_started: ["尚未开始", "Not started"], in_progress: ["正在尝试", "In progress"], completed: ["家长报告已完成", "Reported complete"], unable: ["无法完成", "Unable to complete"], stopped: ["中途停止", "Stopped"] } as const;
export const INSTRUCTION_LABELS = { clear: ["能看懂说明", "Clear"], needs_explanation: ["需要进一步解释", "Needs explanation"], unclear: ["仍未看懂", "Still unclear"], not_read: ["尚未阅读", "Not read yet"] } as const;
export const OPERATION_LABELS = { none: ["不需要操作帮助", "No help needed"], guidance: ["需要操作指引", "Needs guidance"], hands_on: ["需要他人协助操作", "Needs hands-on help"], unavailable: ["需要帮助但未获得", "Help was unavailable"] } as const;
export const ALTERNATIVE_LABELS = { not_needed: ["未需要替代交流", "Not needed"], worked: ["同伴或教师替代可用", "Peer or teacher alternative worked"], did_not_work: ["尝试后仍不可用", "Tried, but did not work"], not_tried: ["需要替代但尚未尝试", "Needed, but not tried"] } as const;
export type FeedbackFields = { participation: keyof typeof PARTICIPATION_LABELS; instructions: keyof typeof INSTRUCTION_LABELS; operationHelp: keyof typeof OPERATION_LABELS; alternative: keyof typeof ALTERNATIVE_LABELS; note: string };
export type FeedbackSnapshot = { version: 1; title: string; detail: string; objectiveId: string | null; objectiveTitle: string | null; assignmentTitle: string | null; plan: FamilyPlan | null };
export type FeedbackTask = { id: string; studentId: string; studentName: string; classId: string | null; className: string | null; revision: number; status: string; snapshot: FeedbackSnapshot };
export type FamilyFeedbackEntry = FeedbackFields & {
  id: string; taskId: string; studentId: string; studentName: string; classId: string | null; className: string | null; revision: number; snapshot: FeedbackSnapshot;
  authorName: string; createdAt: string; voidedAt: string | null; voidReason: string | null; canVoid: boolean;
};
export type FamilyFeedbackData = { tasks: FeedbackTask[]; entries: FamilyFeedbackEntry[]; generatedAt: string };
export type FeedbackView = "guardian" | "teaching";
export function feedbackReasonRequired(value: Pick<FeedbackFields, "participation" | "instructions" | "operationHelp" | "alternative">) {
  return value.participation === "unable" || value.participation === "stopped" || value.instructions === "needs_explanation" || value.instructions === "unclear"
    || value.operationHelp !== "none" || value.alternative === "did_not_work" || value.alternative === "not_tried";
}
