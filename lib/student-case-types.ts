import type { ChoiceSnapshot } from "./diagnostic-types";
import type { FamilyFeedbackEntry, FamilyFeedbackResponse } from "./family-feedback-types";
import type { FamilyWorkSnapshot } from "./family-task";
import type { SequenceEvidence, TeachingDecision } from "./learning-sequence-types";
import type { LearningAnalyticsState } from "./learning-analytics";

export type CaseView = "student" | "guardian" | "teaching";
export type CaseGoal = { id: string; title: string };
export const CASE_EVENT_LABELS = { choice: "诊断作答", work: "学生作品", review: "教师评价", sequence: "练习与迁移安排", decision: "后续教学判断", retest: "延后复测安排", feedback: "家庭使用反馈", support: "家庭困难处理", withdrawal: "记录撤销" } as const;
type EventBase = { id: string; at: string; goals: CaseGoal[] };
export type CaseEvent = EventBase & (
  { kind: "choice"; snapshot: ChoiceSnapshot; selected: number; correct: boolean; attemptId: string }
  | { kind: "work" | "review"; work: SequenceEvidence; stage: string; className: string; family: FamilyWorkSnapshot | null; confirmedAt: string | null; confirmedBy: string | null; confirmationRole: string | null; sequenceIds: string[] }
  | { kind: "sequence"; sequenceId: string; title: string; practice: string; transfer: string; context: string; baselineId: string }
  | { kind: "decision"; sequenceId: string; decision: TeachingDecision }
  | { kind: "retest"; sequenceId: string; prompt: string; context: string; availableAt: string; referenceId: string | null }
  | { kind: "feedback"; entry: FamilyFeedbackEntry }
  | { kind: "support"; response: FamilyFeedbackResponse; feedbackId: string; taskTitle: string; revision: number; originalNote: string }
  | { kind: "withdrawal"; sourceId: string; sourceKind: "feedback" | "support"; reason: string }
);
export type CaseTask = { id: string; kind: "teacher" | "family"; title: string; detail: string; goal: CaseGoal | null; status: string; revision: number | null; updatedAt: string; authorName: string };
export type StudentCaseData = {
  students: Array<{ id: string; displayName: string }>; student: { id: string; displayName: string } | null;
  objectives: CaseGoal[]; events: CaseEvent[]; tasks: CaseTask[]; legacyChoiceCount: number; generatedAt: string;
} & Partial<LearningAnalyticsState>;
export const caseTimestamp = (value: string) => Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value);
