import type { SequenceEvidence } from "./learning-sequence-types";

export const FOLLOWUP_LABELS = {
  review: "待教师批阅", confirmation: "待交流确认", retest: "复测已到期", practice: "待练习作品",
  transfer: "待迁移作品", initial: "待补初次证据", transfer_setup: "待安排迁移", evidence: "独立迁移证据待补",
} as const;
export type FollowupKind = keyof typeof FOLLOWUP_LABELS;
export type FollowupGoal = { id: string; title: string };
export type FollowupAction =
  | { kind: "review"; submissionId: string }
  | { kind: "sequence"; studentId: string; sequenceId: string }
  | { kind: "source"; studentId: string; sourceId: string; objectiveId: string }
  | { kind: "assignment"; classId: string; assignmentId: string; objectiveId: string };
export type TeachingFollowup = {
  id: string; kind: FollowupKind; classId: string; className: string; studentId: string; studentName: string;
  goals: FollowupGoal[]; title: string; detail: string; time: string | null; work: SequenceEvidence | null; action: FollowupAction;
};
export type TeachingFollowupData = {
  classes: Array<{ id: string; name: string }>;
  students: Array<{ id: string; name: string; classIds: string[] }>;
  objectives: Array<FollowupGoal & { classIds: string[] }>;
  items: TeachingFollowup[]; generatedAt: string;
};
