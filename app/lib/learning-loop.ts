export type DiagnosticEvidence = { objectiveId: string; isCorrect: boolean };
export type ObjectiveScore = { score: number; evidenceCount: number };
export type RubricDimension = { name: string; weight: number };
export type LearningPlanKind = "teacher" | "review" | "family" | "assignment";
export type LearningPlanItem = { id: string; kind: LearningPlanKind; dueAt?: string | null };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function calculateDiagnosticScores(evidence: DiagnosticEvidence[]) {
  const totals: Record<string, { correct: number; count: number }> = {};
  for (const item of evidence) {
    const objectiveId = item.objectiveId.trim();
    if (!objectiveId) continue;
    const total = totals[objectiveId] ?? { correct: 0, count: 0 };
    total.count += 1;
    if (item.isCorrect) total.correct += 1;
    totals[objectiveId] = total;
  }
  return Object.fromEntries(Object.entries(totals).map(([objectiveId, total]) => [
    objectiveId,
    { score: total.correct / total.count, evidenceCount: total.count },
  ])) as Record<string, ObjectiveScore>;
}

export function matchesDiagnosticItemSet(expectedIds: string[], submittedIds: string[]) {
  if (expectedIds.length !== submittedIds.length) return false;
  const expected = new Set(expectedIds);
  const submitted = new Set(submittedIds);
  return expected.size === expectedIds.length
    && submitted.size === submittedIds.length
    && expected.size === submitted.size
    && [...expected].every((id) => submitted.has(id));
}

export function blendMastery(previousMastery: number | null, previousEvidenceCount: number, score: number, evidenceCount = 1) {
  const nextScore = clamp01(score);
  const mastery = previousMastery === null
    ? nextScore
    : clamp01(previousMastery * 0.7 + nextScore * 0.3);
  return {
    mastery: Number(mastery.toFixed(4)),
    evidenceCount: Math.max(0, previousEvidenceCount) + Math.max(1, evidenceCount),
  };
}

function planPriority(item: LearningPlanItem, now: Date) {
  const due = item.dueAt ? new Date(item.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const daysUntilDue = (due - now.getTime()) / 86400000;
  if (item.kind === "teacher") return 500;
  if (item.kind === "review") return daysUntilDue <= 1 ? 400 : 140;
  if (item.kind === "family") return 300;
  if (daysUntilDue <= 3) return 200;
  return 100;
}

export function rankLearningPlan<T extends LearningPlanItem>(items: T[], now = new Date()) {
  return [...items]
    .sort((left, right) => {
      const priority = planPriority(right, now) - planPriority(left, now);
      if (priority) return priority;
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return leftDue - rightDue || left.id.localeCompare(right.id);
    })
    .slice(0, 3);
}

export function isRecommendationDue(dueAt: string | null | undefined, now = new Date()) {
  if (!dueAt) return true;
  const dueTime = new Date(dueAt).getTime();
  return Number.isFinite(dueTime) && dueTime <= now.getTime();
}

export function validateRubric(value: unknown): RubricDimension[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("invalid_rubric");
  const rubric = value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("invalid_rubric");
    const name = "name" in item && typeof item.name === "string" ? item.name.trim().slice(0, 40) : "";
    const weight = "weight" in item ? Number(item.weight) : Number.NaN;
    if (!name || !Number.isInteger(weight) || weight < 1 || weight > 100) throw new Error("invalid_rubric");
    return { name, weight };
  });
  if (rubric.reduce((sum, item) => sum + item.weight, 0) !== 100) throw new Error("invalid_rubric");
  return rubric;
}
