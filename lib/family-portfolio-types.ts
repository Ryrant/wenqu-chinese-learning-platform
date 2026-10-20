import type { FamilyWorkSnapshot } from "./family-task";
import type { HelpLevel, SequenceEvidence } from "./learning-sequence-types";

export type PortfolioStudent = { id: string; displayName: string };
export type FamilyPortfolioEntry = {
  work: SequenceEvidence; snapshot: FamilyWorkSnapshot | null; className: string;
  confirmedAt: string | null; confirmedByName: string | null; confirmationRole: "guardian" | "teacher" | null; familyHelpLevel: HelpLevel;
  sequences: Array<{ id: string; title: string; objectiveTitle: string; direct: boolean }>;
};
export type FamilyPortfolioData = { students: PortfolioStudent[]; student: PortfolioStudent | null; entries: FamilyPortfolioEntry[]; generatedAt: string };

export function familyConfirmationLabel(entry: FamilyPortfolioEntry) {
  if (!entry.confirmedAt) return entry.work.reviewed ? "历史交流确认未留存" : "交流待确认";
  return entry.confirmationRole === "teacher" ? "教师已见证交流" : entry.confirmationRole === "guardian" ? "家长已确认交流" : "交流已确认";
}
