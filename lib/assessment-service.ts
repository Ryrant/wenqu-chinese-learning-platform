import { assertSubmissionReviewAccess } from "./access-control";
import { generateGroundedText } from "./ai/grounding";
import { prepareMasteryEvidenceInsert } from "./learning-loop-service";
import type { PlatformDatabase } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";
import { searchPublishedKnowledge } from "./retrieval";
import { readFamilyWorkSnapshot } from "./family-task";
import { HELP_LEVEL_LABELS, jsonValue, readPromptCount, readSequenceWork, type HelpLevel, type ReviewEvidence } from "./learning-sequence-types";
import type { WorkDiagnosticSnapshot } from "./diagnostic-types";
import { auditStatement } from "./audit";

export type ObjectiveReviewScore = { objectiveId: string; score: number };
export type DimensionReviewScore = { name: string; score: number };
export type ReviewSuggestion = { submissionId: string; suggestedScore: number | null; comment: string; weaknessTags: string[]; objectiveScores: ObjectiveReviewScore[]; dimensionScores: DimensionReviewScore[] };
export type ConfirmedReview = { submissionId: string; score: number; comment: string; objectiveScores: ObjectiveReviewScore[]; dimensionScores: DimensionReviewScore[] };

function scoredItems(value: unknown, key: "objectiveId" | "name", allowed: string[]): Array<Record<string, string | number>> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("invalid_review_scores");
  const seen = new Set<string>();
  return value.map((item) => {
    const id = item?.[key];
    if (typeof id !== "string" || !allowed.includes(id) || seen.has(id) || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) throw new Error("invalid_review_scores");
    seen.add(id);
    return { [key]: id, score: item.score };
  });
}

export function parseReviewSuggestion(text: string, objectiveIds: string[], dimensionNames: string[]) {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!value || typeof value !== "object" || (value.suggestedScore !== null && (typeof value.suggestedScore !== "number" || !Number.isFinite(value.suggestedScore) || value.suggestedScore < 0 || value.suggestedScore > 100)) || typeof value.comment !== "string" || !value.comment.trim() || !Array.isArray(value.weaknessTags) || value.weaknessTags.some((tag: unknown) => typeof tag !== "string")) throw new Error("invalid_review_suggestion");
  const objectiveScores = scoredItems(value.objectiveScores, "objectiveId", objectiveIds) as ObjectiveReviewScore[];
  const dimensionScores = scoredItems(value.dimensionScores, "name", dimensionNames) as DimensionReviewScore[];
  if (value.suggestedScore === null && (objectiveScores.length || dimensionScores.length)) throw new Error("invalid_review_suggestion");
  return { suggestedScore: value.suggestedScore as number | null, comment: value.comment.slice(0, 2000), weaknessTags: value.weaknessTags.slice(0, 5) as string[], objectiveScores, dimensionScores };
}

export async function suggestTextReview(db: PlatformDatabase, context: PlatformContext, submissionId: string, config: { openAiKey?: string; model?: string }): Promise<ReviewSuggestion> {
  await assertSubmissionReviewAccess(db, context, submissionId);
  const submission = await db.prepare(`
    SELECT s.id,s.text_answer AS textAnswer,s.review_status AS reviewStatus,a.title AS assignmentTitle,a.rubric_json AS rubricJson,s.family_snapshot_json AS familySnapshotJson,s.sequence_snapshot_json AS sequenceSnapshotJson,s.diagnostic_snapshot_json AS diagnosticSnapshotJson
    FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    WHERE s.id=? AND s.tenant_id=? AND s.text_answer IS NOT NULL
  `).bind(submissionId, context.tenantId).first<{ id: string; textAnswer: string; reviewStatus: string; assignmentTitle: string; rubricJson: string; familySnapshotJson: string; sequenceSnapshotJson: string; diagnosticSnapshotJson: string }>();
  if (!submission) throw new Error("submission_not_found");
  if (submission.reviewStatus === "reviewed") throw new Error("submission_already_reviewed");
  const objectives = await db.prepare(`SELECT lo.id,lo.title FROM submissions s
    JOIN assignment_objectives ao ON ao.tenant_id=s.tenant_id AND ao.assignment_id=s.assignment_id
    JOIN learning_objectives lo ON lo.tenant_id=ao.tenant_id AND lo.id=ao.objective_id
    WHERE s.id=? AND s.tenant_id=?`).bind(submissionId, context.tenantId).all<{ id: string; title: string }>();
  const family = readFamilyWorkSnapshot(submission.familySnapshotJson);
  const sequence = readSequenceWork(submission.sequenceSnapshotJson);
  const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(submission.diagnosticSnapshotJson, {});
  const reviewObjectives = sequence ? [{ id: sequence.objectiveId, title: sequence.objectiveTitle }] : family ? [{ id: family.objectiveId, title: family.objectiveTitle }] : diagnostic.objectives ?? objectives.results;
  const rubric = sequence?.rubric ?? family?.rubric ?? diagnostic.rubric ?? JSON.parse(submission.rubricJson || "[]") as Array<{ name: string; weight: number }>;
  const chunks = await searchPublishedKnowledge(db, { tenantId: context.tenantId, query: `${submission.assignmentTitle} ${submission.textAnswer}`, limit: 5 });
  const result = await generateGroundedText({
    purpose: "review",
    prompt: `请按下面的任务目标和评分量规评价学生作品，仅返回 JSON：{"suggestedScore":0到100的数字或null,"comment":"评语及来源编号","weaknessTags":[],"objectiveScores":[{"objectiveId":"目标ID","score":0到100的数字}],"dimensionScores":[{"name":"量规维度名称","score":0到100的数字}]}。没有可靠评分依据时 suggestedScore 为 null，两个评分数组留空；未观察到的目标或维度不要评分。\n任务：${sequence?.title ?? family?.title ?? diagnostic.title ?? submission.assignmentTitle}${sequence ? `\n要求：${sequence.prompt}\n迁移情境：${sequence.context}` : family ? `\n交流要求：${family.detail}\n${family.plan?.template?.work.zh ?? ""}` : diagnostic.prompt ? `\n要求：${diagnostic.prompt}` : ""}\n目标：${JSON.stringify(reviewObjectives)}\n量规：${JSON.stringify(rubric)}\n学生答案：${submission.textAnswer}`,
    role: "teacher",
    contextChunks: chunks,
  }, config);
  let suggestion: Omit<ReviewSuggestion, "submissionId"> = { suggestedScore: null, comment: "未获得可靠的评分建议，请教师依据作品和量规评价。", weaknessTags: [], objectiveScores: [], dimensionScores: [] };
  if (result.status === "completed") {
    try {
      suggestion = parseReviewSuggestion(result.text, reviewObjectives.map((item) => item.id), rubric.map((item) => item.name));
    } catch (error) {
      console.warn("review_suggestion_invalid", { submissionId, reason: error instanceof SyntaxError ? "invalid_json" : "invalid_review_scores" });
    }
  }
  const outcomes = await db.batch([
    db.prepare(`INSERT INTO submission_reviews
      (id,tenant_id,submission_id,reviewer_user_id,ai_suggested_score,ai_comment,weakness_tags_json,objective_scores_json,dimension_scores_json,status)
      SELECT ?,?,?,?,?,?,?,?,?,'ai_suggested'
      WHERE EXISTS (SELECT 1 FROM submissions WHERE id=? AND tenant_id=? AND review_status!='reviewed')`)
      .bind(crypto.randomUUID(), context.tenantId, submissionId, context.userId, suggestion.suggestedScore, suggestion.comment, JSON.stringify(suggestion.weaknessTags), JSON.stringify(suggestion.objectiveScores), JSON.stringify(suggestion.dimensionScores), submissionId, context.tenantId),
    db.prepare(`UPDATE submissions SET review_status='ai_suggested_pending_review'
      WHERE id=? AND tenant_id=? AND review_status!='reviewed'`)
      .bind(submissionId, context.tenantId),
    auditStatement(db, context.tenantId, context.userId, "submission.ai_review_suggested", "submission", submissionId, {}, true),
  ]);
  if (!outcomes[1].meta.changes) throw new Error("submission_already_reviewed");
  return { submissionId, ...suggestion };
}

export async function confirmSubmissionReview(db: PlatformDatabase, context: PlatformContext, input: { submissionId: string; score: number; comment: string; objectiveScores?: unknown; dimensionScores?: unknown; helpLevel?: unknown; contextConfirmed?: unknown; promptCount?: unknown }): Promise<ConfirmedReview> {
  await assertSubmissionReviewAccess(db, context, input.submissionId);
  if (typeof input.score !== "number" || !Number.isFinite(input.score) || input.score < 0 || input.score > 100) throw new Error("invalid_review_score");
  const score = input.score;
  const comment = input.comment.slice(0, 2000);
  const submission = await db.prepare(`SELECT s.student_user_id AS studentUserId,s.review_status AS reviewStatus,
      s.family_task_id AS familyTaskId,s.family_confirmed_at AS familyConfirmedAt,s.family_help_level AS familyHelpLevel,a.rubric_json AS rubricJson,s.family_snapshot_json AS familySnapshotJson,s.sequence_snapshot_json AS sequenceSnapshotJson,s.diagnostic_snapshot_json AS diagnosticSnapshotJson
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id WHERE s.id=? AND s.tenant_id=?`)
    .bind(input.submissionId, context.tenantId)
    .first<{ studentUserId: string; reviewStatus: string; familyTaskId: string | null; familyConfirmedAt: string | null; familyHelpLevel: string | null; rubricJson: string; familySnapshotJson: string; sequenceSnapshotJson: string; diagnosticSnapshotJson: string }>();
  if (!submission) throw new Error("submission_not_found");
  if (submission.reviewStatus === "reviewed") throw new Error("submission_already_reviewed");
  if (submission.familyTaskId && !submission.familyConfirmedAt) throw new Error("family_confirmation_required");
  const evidence = await db.prepare(`SELECT s.student_user_id AS studentUserId,ao.objective_id AS objectiveId,lo.title
    FROM submissions s
    JOIN assignment_objectives ao ON ao.tenant_id=s.tenant_id AND ao.assignment_id=s.assignment_id
    JOIN learning_objectives lo ON lo.tenant_id=ao.tenant_id AND lo.id=ao.objective_id
    WHERE s.id=? AND s.tenant_id=?`)
    .bind(input.submissionId, context.tenantId)
    .all<{ studentUserId: string; objectiveId: string; title: string }>();
  const family = readFamilyWorkSnapshot(submission.familySnapshotJson);
  const sequence = readSequenceWork(submission.sequenceSnapshotJson);
  const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(submission.diagnosticSnapshotJson, {});
  const objectives = sequence ? [{ id: sequence.objectiveId, title: sequence.objectiveTitle }] : family ? [{ id: family.objectiveId, title: family.objectiveTitle }] : diagnostic.objectives ?? evidence.results.map((item) => ({ id: item.objectiveId, title: item.title }));
  if (!objectives.length) throw new Error("assignment_objective_not_found");
  const rubric = sequence?.rubric ?? family?.rubric ?? diagnostic.rubric ?? JSON.parse(submission.rubricJson || "[]") as Array<{ name: string; weight: number }>;
  const objectiveScores = scoredItems(input.objectiveScores, "objectiveId", objectives.map((item) => item.id)) as ObjectiveReviewScore[];
  const dimensionScores = scoredItems(input.dimensionScores, "name", rubric.map((item) => item.name)) as DimensionReviewScore[];
  if ((sequence && input.helpLevel === undefined) || (input.helpLevel !== undefined && (typeof input.helpLevel !== "string" || !Object.hasOwn(HELP_LEVEL_LABELS, input.helpLevel)))) throw new Error("invalid_review_help_level");
  if (input.contextConfirmed !== undefined && typeof input.contextConfirmed !== "boolean") throw new Error("invalid_review_context");
  const promptCount = readPromptCount(input.promptCount);
  if (input.promptCount != null && promptCount === null) throw new Error("invalid_review_prompt_count");
  if ((input.helpLevel === "independent" && promptCount !== null && promptCount > 0)
    || ((input.helpLevel === "prompted" || submission.familyHelpLevel === "prompted") && promptCount === 0)) throw new Error("invalid_review_prompt_observation");
  const reviewEvidence: ReviewEvidence = { version: 1, rubric, objectives, helpLevel: input.helpLevel as HelpLevel ?? "unknown", promptCount, contextConfirmed: (sequence?.stage === "transfer" || sequence?.stage === "retest") && input.contextConfirmed === true };
  try {
    await db.batch([
      db.prepare(`INSERT INTO submission_review_confirmations
        (id,tenant_id,submission_id,reviewer_user_id,score,comment)
        VALUES (?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), context.tenantId, input.submissionId, context.userId, score, comment),
      db.prepare("INSERT INTO submission_reviews (id,tenant_id,submission_id,reviewer_user_id,final_score,final_comment,weakness_tags_json,objective_scores_json,dimension_scores_json,evidence_json,status) VALUES (?,?,?,?,?,?,?,?,?,?,'confirmed')")
        .bind(crypto.randomUUID(), context.tenantId, input.submissionId, context.userId, score, comment, "[]", JSON.stringify(objectiveScores), JSON.stringify(dimensionScores), JSON.stringify(reviewEvidence)),
      db.prepare(`UPDATE submissions
        SET score=?,confidence=1,feedback=?,review_status='reviewed',reviewed_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND review_status!='reviewed'`)
        .bind(score, comment, input.submissionId, context.tenantId),
      // 只更新教师明确评价的目标，不能把总分复制给所有关联能力。
      ...objectiveScores.map((item) => prepareMasteryEvidenceInsert(db, {
        tenantId: context.tenantId,
        studentUserId: submission.studentUserId,
        objectiveId: item.objectiveId,
        score: item.score / 100,
      })),
      ...(submission.familyTaskId ? [db.prepare(`UPDATE learning_recommendations SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND student_user_id=? AND source_type='family'`)
        .bind(submission.familyTaskId, context.tenantId, submission.studentUserId)] : []),
      // 成绩、证据、家庭任务状态与审计一起提交，失败时不能留下已生效的评分。
      db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,'submission.reviewed','submission',?,?)")
        .bind(crypto.randomUUID(), context.tenantId, context.userId, input.submissionId, JSON.stringify({ score })),
    ]);
  } catch (error) {
    const existing = await db.prepare(`SELECT id FROM submission_review_confirmations
      WHERE tenant_id=? AND submission_id=?`)
      .bind(context.tenantId, input.submissionId)
      .first();
    if (existing) throw new Error("submission_already_reviewed");
    throw error;
  }
  return { submissionId: input.submissionId, score, comment, objectiveScores, dimensionScores };
}
