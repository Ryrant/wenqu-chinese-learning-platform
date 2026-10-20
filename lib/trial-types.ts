import { readPromptCount, type LearningSequence } from "./learning-sequence-types";

export const TRIAL_KIND_LABELS = { preparation: "备课", ai_revision: "AI 草稿修改", review: "批阅", not_completed: "无法完成", withdrawn: "退出", no_improvement: "表现未改善（教师观察）" } as const;
export const TRIAL_METHOD_LABELS = { platform: "平台辅助", previous: "原有工作方式" } as const;
export type TrialKind = keyof typeof TRIAL_KIND_LABELS;
export type TrialMethod = keyof typeof TRIAL_METHOD_LABELS;
export type TrialEntry = {
  id: string; sequenceId: string; sequenceTitle: string; studentName: string; className: string; kind: TrialKind;
  method: TrialMethod | null; minutes: number | null; referenceSubmissionId: string | null; referenceTitle: string | null;
  note: string; teacherName: string; createdAt: string; voidedAt: string | null; voidReason: string | null; canVoid: boolean;
};
export const isWorkload = (kind: string) => kind === "preparation" || kind === "ai_revision" || kind === "review";

export function trialSummary(entries: TrialEntry[], sequences: LearningSequence[]) {
  const active = entries.filter((item) => !item.voidedAt);
  // 下一轮可能把上一轮作品作为初次依据，同一份作品只能计算一次。
  const works = new Map(sequences.flatMap((item) => [item.baseline, ...item.practice, ...item.transfer, ...item.retest]).filter((work) => work.reviewed).map((work) => [work.id, work]));
  const known = [...works.values()].filter((work) => readPromptCount(work.promptCount) !== null).length;
  return {
    workload: (["preparation", "ai_revision", "review"] as const).flatMap((kind) => (["platform", "previous"] as const).map((method) => {
      const records = active.filter((item) => item.kind === kind && item.method === method);
      return { kind, method, count: records.length, minutes: records.length ? records.reduce((sum, item) => sum + (item.minutes ?? 0), 0) : null };
    })),
    observations: (["not_completed", "withdrawn", "no_improvement"] as const).map((kind) => ({ kind, count: active.filter((item) => item.kind === kind).length })),
    prompts: { known, missing: works.size - known },
  };
}
