import type { RubricDimension } from "./learning-loop";

export const SEQUENCE_STAGE_LABELS = { practice: "针对性练习", transfer: "迁移任务" } as const;
export type SequenceStage = keyof typeof SEQUENCE_STAGE_LABELS;
export type HelpLevel = "unknown" | "independent" | "prompted" | "assisted";
export const HELP_LEVEL_LABELS: Record<HelpLevel, string> = { unknown: "未记录", independent: "独立完成", prompted: "提供了提示", assisted: "共同完成或较多帮助" };
export type ReviewEvidence = { version: 1; rubric: RubricDimension[]; objectives: Array<{ id: string; title: string }>; helpLevel: HelpLevel; contextConfirmed: boolean };
export type SequenceWorkSnapshot = { version: 1; sequenceId: string; stage: SequenceStage; title: string; prompt: string; context: string; objectiveId: string; objectiveTitle: string; rubric: RubricDimension[]; medium: "text" | "audio" };
export type SequenceEvidence = {
  id: string; title: string; prompt: string; mediaId: string | null; textAnswer: string | null; hasAudio: boolean;
  submittedAt: string; reviewedAt: string | null; reviewed: boolean; score: number | null; feedback: string;
  objectives: Array<{ id: string; title: string; score: number }>; dimensions: Array<{ name: string; score: number }>;
  rubric: RubricDimension[] | null; helpLevel: HelpLevel; contextConfirmed: boolean;
};
export type SequenceSource = { studentUserId: string; studentName: string; assignmentId: string; assignmentStatus: string; referenceRubric: RubricDimension[]; work: SequenceEvidence };
export type LearningSequence = {
  id: string; studentUserId: string; studentName: string; assignmentId: string; objectiveId: string; objectiveTitle: string;
  title: string; practicePrompt: string; transferPrompt: string; transferContext: string; rubric: RubricDimension[]; medium: "text" | "audio";
  baseline: SequenceEvidence; practice: SequenceEvidence[]; transfer: SequenceEvidence[];
};
export function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export function readReviewEvidence(value: unknown): ReviewEvidence | null {
  const item = jsonValue<ReviewEvidence | null>(value, null);
  return item?.version === 1 && Array.isArray(item.rubric) && Array.isArray(item.objectives)
    && Object.hasOwn(HELP_LEVEL_LABELS, item.helpLevel) && typeof item.contextConfirmed === "boolean" ? item : null;
}
export function readSequenceWork(value: unknown): SequenceWorkSnapshot | null {
  const item = jsonValue<SequenceWorkSnapshot | null>(value, null);
  return item?.version === 1 && Object.hasOwn(SEQUENCE_STAGE_LABELS, item.stage) && typeof item.sequenceId === "string"
    && typeof item.title === "string" && typeof item.prompt === "string" && typeof item.context === "string"
    && typeof item.objectiveId === "string" && typeof item.objectiveTitle === "string" && Array.isArray(item.rubric)
    && (item.medium === "text" || item.medium === "audio") ? item : null;
}
export function sameRubric(left: RubricDimension[] | null, right: RubricDimension[] | null) {
  return !!left?.length && !!right && left.length === right.length
    && left.every((item) => right.some((other) => item.name === other.name && item.weight === other.weight));
}
export function sequenceTaskId(id: string, stage: SequenceStage) { return `sequence:${id}:${stage}`; }
