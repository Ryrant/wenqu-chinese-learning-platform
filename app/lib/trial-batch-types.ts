import type { FamilyFeedbackEntry } from "./family-feedback-types";
import type { HelpLevel } from "./learning-sequence-types";
import type { TrialEntry } from "./trial-types";

export type BatchParticipant = { id: string; name: string; status: string };
export type BatchSequence = { id: string; studentId: string; assignmentId: string; objectiveId: string; title: string; rubricJson: string; medium: string };
export type BatchFamilyTask = { id: string; studentId: string; assignmentId: string | null; objectiveId: string | null; title: string; revision: number; historical: boolean };
export type BatchClass = { id: string; name: string; version: string; participants: BatchParticipant[]; objectives: Array<{ id: string; title: string }>; sequences: BatchSequence[]; familyTasks: BatchFamilyTask[] };
export type BatchScope = { version: 1; classId: string; className: string; objectiveId: string; objectiveTitle: string; startDate: string; endDate: string; workScope: string; participants: BatchParticipant[]; sequences: BatchSequence[]; familyTasks: BatchFamilyTask[] };
export type TrialBatch = { id: string; title: string; revision: number; scope: BatchScope; teacherName: string; createdAt: string; voidedAt: string | null; voidReason: string | null; canVoid: boolean };
export type BatchCatalog = { classes: BatchClass[]; batches: TrialBatch[]; generatedAt: string };
export type BatchEvidence = { id: string; title: string; submittedAt: string; reviewed: boolean; reviewedAt: string | null; goalScore: number | null; helpLevel: HelpLevel; promptCount: number | null; contextConfirmed: boolean; inPeriod: boolean; rubricMatched: boolean };
export type BatchGroup = { source: BatchSequence; available: boolean; baseline: BatchEvidence | null; practice: BatchEvidence[]; transfer: BatchEvidence[]; retest: BatchEvidence[]; transferStatus: string; retestStatus: string; retestAvailableAt: string | null };
export type BatchReport = { batch: TrialBatch; participants: Array<BatchParticipant & { currentStatus: string | null; groups: BatchGroup[] }>; entries: TrialEntry[]; feedback: FamilyFeedbackEntry[]; workloadScope: "institution" | "self"; generatedAt: string };

export function trialTimestamp(value: string) {
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value);
}
export const batchFamilyVersion = (revision: number) => revision ? `v${revision}` : "历史版本未保留";
export function batchPeriod(scope: Pick<BatchScope, "startDate" | "endDate">) {
  return { start: Date.parse(`${scope.startDate}T00:00:00+08:00`), end: Date.parse(`${scope.endDate}T00:00:00+08:00`) + 86400000 };
}
export function batchSummary(report: BatchReport) {
  const activeFeedback = report.feedback.filter((entry) => !entry.voidedAt);
  const answered = new Set(activeFeedback.map((entry) => JSON.stringify([entry.taskId, entry.revision])));
  const independent = (work: BatchEvidence | undefined) => !!work?.reviewed && work.goalScore !== null && work.helpLevel === "independent" && work.contextConfirmed;
  return {
    participants: report.participants.length,
    withoutGroups: report.participants.filter((person) => !person.groups.length).length,
    unavailableGroups: report.participants.flatMap((person) => person.groups).filter((group) => !group.available).length,
    missingTransfer: report.participants.filter((person) => !person.groups.some((group) => group.transfer.length)).length,
    independentTransfer: report.participants.filter((person) => person.groups.some((group) => independent(group.transfer[0]))).length,
    independentRetest: report.participants.filter((person) => person.groups.some((group) => independent(group.retest[0]))).length,
    familyRecords: activeFeedback.length,
    familyStudents: new Set(activeFeedback.map((entry) => entry.studentId)).size,
    missingFamilyTasks: report.batch.scope.familyTasks.filter((task) => !answered.has(JSON.stringify([task.id, task.revision]))).length,
  };
}
