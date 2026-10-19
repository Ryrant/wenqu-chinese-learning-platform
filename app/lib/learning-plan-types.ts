import type { Ability } from "./diagnostic-types";
import type { LearningPlanItem } from "./learning-loop";
import type { HelpLevel } from "./learning-sequence-types";

export type PlanReference = {
  id: string; title: string; measuredAt: string | null; score: number | null;
  kind: "choice" | "work"; ability?: Ability; helpLevel?: HelpLevel; promptCount?: number | null;
};
export type PlanBasis = { objectiveId: string; title: string; note: string; records: PlanReference[] };
export type EvidencePlanItem = LearningPlanItem & Record<string, unknown> & {
  studentUserId: string; title: string; selectionReason: string; basis: PlanBasis[]; sequenceId?: string;
};
