import type { RubricDimension } from "./learning-loop";

export const SEQUENCE_STAGE_LABELS = { practice: "针对性练习", transfer: "迁移任务", retest: "延后复测" } as const;
export type SequenceStage = keyof typeof SEQUENCE_STAGE_LABELS;
export type HelpLevel = "unknown" | "independent" | "prompted" | "assisted";
export const HELP_LEVEL_LABELS: Record<HelpLevel, string> = { unknown: "未记录", independent: "独立完成", prompted: "提供了提示", assisted: "共同完成或较多帮助" };
export const TEACHING_DECISION_LABELS = { practice: "继续练习", fade_support: "减少提示", challenge: "进阶挑战", collect_evidence: "补充证据" } as const;
export type TeachingDecisionKind = keyof typeof TEACHING_DECISION_LABELS;
export type ReviewEvidence = { version: 1; rubric: RubricDimension[]; objectives: Array<{ id: string; title: string }>; helpLevel: HelpLevel; contextConfirmed: boolean };
export type SequenceWorkSnapshot = { version: 1; sequenceId: string; stage: SequenceStage; title: string; prompt: string; context: string; objectiveId: string; objectiveTitle: string; rubric: RubricDimension[]; medium: "text" | "audio"; availableAt?: string; referenceSubmissionId?: string };
export type SequenceEvidence = {
  id: string; title: string; prompt: string; mediaId: string | null; textAnswer: string | null; hasAudio: boolean;
  submittedAt: string; reviewedAt: string | null; reviewed: boolean; score: number | null; feedback: string;
  objectives: Array<{ id: string; title: string; score: number }>; dimensions: Array<{ name: string; score: number }>;
  rubric: RubricDimension[] | null; helpLevel: HelpLevel; contextConfirmed: boolean;
};
export type SequenceSource = { studentUserId: string; studentName: string; assignmentId: string; assignmentStatus: string; referenceRubric: RubricDimension[]; work: SequenceEvidence };
export type TeachingDecision = { id: string; reference: SequenceEvidence; kind: TeachingDecisionKind; rationale: string; remaining: string; nextSequenceId: string; nextTitle: string; teacherName: string; createdAt: string };
export type LearningSequence = {
  id: string; studentUserId: string; studentName: string; assignmentId: string; objectiveId: string; objectiveTitle: string;
  title: string; practicePrompt: string; transferPrompt: string; transferContext: string; rubric: RubricDimension[]; medium: "text" | "audio";
  baseline: SequenceEvidence; practice: SequenceEvidence[]; transfer: SequenceEvidence[];
  retestPrompt: string; retestContext: string; retestAvailableAt: string | null; retestReferenceId: string | null; retestOpen: boolean; retest: SequenceEvidence[]; canScheduleRetest: boolean;
  decisions: TeachingDecision[]; origin: { sequenceId: string; title: string; kind: TeachingDecisionKind } | null; canPlanNext: boolean;
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
export function sequenceStages(sequence: LearningSequence): SequenceStage[] { return sequence.retestAvailableAt ? ["practice", "transfer", "retest"] : ["practice", "transfer"]; }
export function sequenceStageReady(sequence: LearningSequence, stage: SequenceStage) {
  return stage === "practice" || (stage === "retest" ? sequence.retestOpen : sequence.practice.some((work) => work.reviewed));
}
export function nextSequenceStage(sequence: LearningSequence): SequenceStage | null {
  if (!sequence.practice.some((work) => work.reviewed)) return "practice";
  if (!sequence.transfer.some((work) => work.reviewed)) return "transfer";
  return sequence.retestOpen && !sequence.retest.some((work) => work.reviewed) ? "retest" : null;
}
export function sequencePrompt(sequence: LearningSequence, stage: SequenceStage) { return stage === "practice" ? sequence.practicePrompt : stage === "transfer" ? sequence.transferPrompt : sequence.retestPrompt; }
export function sequenceTime(value: string) {
  // SQLite CURRENT_TIMESTAMP 是 UTC；与复测的带时区时间统一显示，避免看起来在开放前提交。
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）";
}
