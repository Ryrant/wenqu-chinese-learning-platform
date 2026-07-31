import { assertSubmissionReviewAccess } from "./access-control";
import { generateGroundedText } from "./ai/grounding";
import { prepareMasteryEvidenceInsert } from "./learning-loop-service";
import type { PlatformContext } from "./platform-store";
import { searchPublishedKnowledge } from "./retrieval";

export type ReviewSuggestion = { submissionId: string; suggestedScore: number; comment: string; weaknessTags: string[] };
export type ConfirmedReview = { submissionId: string; score: number; comment: string };

export async function suggestTextReview(db: D1Database, context: PlatformContext, submissionId: string, config: { openAiKey?: string; model?: string }): Promise<ReviewSuggestion> {
  await assertSubmissionReviewAccess(db, context, submissionId);
  const submission = await db.prepare(`
    SELECT s.id,s.text_answer AS textAnswer,s.review_status AS reviewStatus,a.title AS assignmentTitle
    FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    WHERE s.id=? AND s.tenant_id=? AND s.text_answer IS NOT NULL
  `).bind(submissionId, context.tenantId).first<{ id: string; textAnswer: string; reviewStatus: string; assignmentTitle: string }>();
  if (!submission) throw new Error("submission_not_found");
  if (submission.reviewStatus === "reviewed") throw new Error("submission_already_reviewed");
  const chunks = await searchPublishedKnowledge(db, { tenantId: context.tenantId, query: `${submission.assignmentTitle} ${submission.textAnswer}`, limit: 5 });
  const result = await generateGroundedText({
    purpose: "review",
    prompt: `请给出文字作业评分建议、评语和薄弱点标签。任务：${submission.assignmentTitle}\n学生答案：${submission.textAnswer}`,
    role: "teacher",
    contextChunks: chunks,
  }, config);
  const scoreMatch = result.text.match(/([0-9]{1,3})\s*分/);
  const suggestedScore = Math.max(0, Math.min(Number(scoreMatch?.[1] ?? 80), 100));
  const weaknessTags = [...new Set((result.text.match(/薄弱点[:：]\s*([^\n]+)/)?.[1] ?? "表达完整度").split(/[、,，]/).map((item) => item.trim()).filter(Boolean))].slice(0, 5);
  const outcomes = await db.batch([
    db.prepare(`INSERT INTO submission_reviews
      (id,tenant_id,submission_id,reviewer_user_id,ai_suggested_score,ai_comment,weakness_tags_json,status)
      SELECT ?,?,?,?,?,?,?,'ai_suggested'
      WHERE EXISTS (SELECT 1 FROM submissions WHERE id=? AND tenant_id=? AND review_status!='reviewed')`)
      .bind(crypto.randomUUID(), context.tenantId, submissionId, context.userId, suggestedScore, result.text, JSON.stringify(weaknessTags), submissionId, context.tenantId),
    db.prepare(`UPDATE submissions SET review_status='ai_suggested_pending_review'
      WHERE id=? AND tenant_id=? AND review_status!='reviewed'`)
      .bind(submissionId, context.tenantId),
  ]);
  if (!outcomes[1].meta.changes) throw new Error("submission_already_reviewed");
  return { submissionId, suggestedScore, comment: result.text, weaknessTags };
}

export async function confirmSubmissionReview(db: D1Database, context: PlatformContext, input: { submissionId: string; score: number; comment: string }): Promise<ConfirmedReview> {
  await assertSubmissionReviewAccess(db, context, input.submissionId);
  const score = Math.max(0, Math.min(input.score, 100));
  const comment = input.comment.slice(0, 2000);
  const submission = await db.prepare(`SELECT student_user_id AS studentUserId,review_status AS reviewStatus
    FROM submissions WHERE id=? AND tenant_id=?`)
    .bind(input.submissionId, context.tenantId)
    .first<{ studentUserId: string; reviewStatus: string }>();
  if (!submission) throw new Error("submission_not_found");
  if (submission.reviewStatus === "reviewed") throw new Error("submission_already_reviewed");
  const evidence = await db.prepare(`SELECT s.student_user_id AS studentUserId,ao.objective_id AS objectiveId
    FROM submissions s
    JOIN assignment_objectives ao ON ao.tenant_id=s.tenant_id AND ao.assignment_id=s.assignment_id
    WHERE s.id=? AND s.tenant_id=?`)
    .bind(input.submissionId, context.tenantId)
    .all<{ studentUserId: string; objectiveId: string }>();
  if (!evidence.results.length) throw new Error("assignment_objective_not_found");
  try {
    await db.batch([
      db.prepare(`INSERT INTO submission_review_confirmations
        (id,tenant_id,submission_id,reviewer_user_id,score,comment)
        VALUES (?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), context.tenantId, input.submissionId, context.userId, score, comment),
      db.prepare("INSERT INTO submission_reviews (id,tenant_id,submission_id,reviewer_user_id,final_score,final_comment,weakness_tags_json,status) VALUES (?,?,?,?,?,?,?,'confirmed')")
        .bind(crypto.randomUUID(), context.tenantId, input.submissionId, context.userId, score, comment, "[]"),
      db.prepare(`UPDATE submissions
        SET score=?,confidence=1,feedback=?,review_status='reviewed',reviewed_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND review_status!='reviewed'`)
        .bind(score, comment, input.submissionId, context.tenantId),
      ...evidence.results.map((item) => prepareMasteryEvidenceInsert(db, {
        tenantId: context.tenantId,
        studentUserId: item.studentUserId,
        objectiveId: item.objectiveId,
        score: score / 100,
      })),
    ]);
  } catch (error) {
    const existing = await db.prepare(`SELECT id FROM submission_review_confirmations
      WHERE tenant_id=? AND submission_id=?`)
      .bind(context.tenantId, input.submissionId)
      .first();
    if (existing) throw new Error("submission_already_reviewed");
    throw error;
  }
  return { submissionId: input.submissionId, score, comment };
}
