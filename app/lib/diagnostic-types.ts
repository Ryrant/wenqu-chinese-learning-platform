export const ABILITY_LABELS = { listening: "听力", speaking: "口语", reading: "阅读", writing: "书面表达" } as const;
export type Ability = keyof typeof ABILITY_LABELS;
export type DiagnosticMode = "" | "speaking" | "writing";
export type ChoiceSnapshot = { version: 1; revision: number; ability: "listening" | "reading"; objectiveId: string; objectiveTitle: string; prompt: string; options: string[]; correctOption: number; mediaId: string | null };
export type WorkDiagnosticSnapshot = { version: 1; ability: "speaking" | "writing"; title: string; prompt: string; mediaId: string | null; objectives: Array<{ id: string; title: string }>; rubric: Array<{ name: string; weight: number }> };
export type EvidenceScore = { objectiveId: string; title: string; score: number };
export type ChoiceEvidenceAnswer = { prompt: string; selected: string; expected: string; correct: boolean; mediaId: string | null };
export type AbilityEvidence = {
  id: string; ability: Ability; kind: "choice" | "work"; title: string; submittedAt: string; measuredAt: string | null;
  status: "assessed" | "pending" | "unassessed"; evidenceCount: number; scores: EvidenceScore[];
  answers: ChoiceEvidenceAnswer[]; submissionId: string | null; textAnswer: string | null; hasAudio: boolean;
  prompt: string; mediaId: string | null; reviewer: string | null; feedback: string | null;
  dimensions: Array<{ name: string; score: number }>; familyHelp: string | null;
};
export type AbilityProfile = {
  student: { id: string; displayName: string }; legacyAnswerCount: number; evidence: AbilityEvidence[];
};
export const diagnosticMediaUrl = (id: string) => `/api/v1/diagnostic-media/${encodeURIComponent(id)}`;
