import { submissionAccessClause } from "./access-control";
import type { WorkDiagnosticSnapshot } from "./diagnostic-types";
import { readFamilyWorkSnapshot } from "./family-task";
import { jsonValue, readPromptCount, readReviewEvidence, readSequenceWork, type SequenceEvidence } from "./learning-sequence-types";
import type { PlatformDatabase } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";

export type WorkRow = {
  id: string; assignment_id: string; student_user_id: string; studentName: string; className: string; assignmentTitle: string; assignmentStatus: string;
  text_answer: string | null; asset_key: string | null; score: number | null; feedback: string | null;
  created_at: string; reviewed_at: string | null; review_status: string; rubricJson: string; objectiveTitlesJson: string;
  diagnostic_snapshot_json: string; family_snapshot_json: string; family_help_level: string | null;
  family_confirmed_at: string | null; family_confirmation_role: string | null; familyConfirmedName: string | null;
  sequence_id: string | null; sequence_stage: string | null; sequence_snapshot_json: string;
  evidenceJson: string | null; objectiveScoresJson: string | null; dimensionScoresJson: string | null;
};

// 任务组与作品集共用同一份鉴权后的作品证据，不能从最近提交分页重建完整历史。
export async function readWorkRows(db: PlatformDatabase, context: PlatformContext, filter: string, args: unknown[] = []) {
  const access = submissionAccessClause(context);
  return (await db.prepare(`SELECT s.*,a.title AS assignmentTitle,a.status AS assignmentStatus,a.rubric_json AS rubricJson,
    u.display_name AS studentName,c.name AS className,fc.display_name AS familyConfirmedName,
    sr.evidence_json AS evidenceJson,sr.objective_scores_json AS objectiveScoresJson,sr.dimension_scores_json AS dimensionScoresJson,
    (SELECT json_group_array(json_object('id',lo.id,'title',lo.title)) FROM assignment_objectives ao
      JOIN learning_objectives lo ON lo.tenant_id=ao.tenant_id AND lo.id=ao.objective_id
      WHERE ao.tenant_id=a.tenant_id AND ao.assignment_id=a.id) AS objectiveTitlesJson
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id JOIN users u ON u.id=s.student_user_id
    LEFT JOIN users fc ON fc.id=s.family_confirmed_by
    LEFT JOIN submission_reviews sr ON sr.id=(SELECT r.id FROM submission_reviews r
      WHERE r.tenant_id=s.tenant_id AND r.submission_id=s.id AND r.status='confirmed' ORDER BY r.rowid DESC LIMIT 1)
    WHERE s.tenant_id=? AND ${access.sql} AND (${filter}) ORDER BY s.created_at DESC,s.rowid DESC`)
    .bind(context.tenantId, ...access.args, ...args).all<WorkRow>()).results;
}

export function workEvidence(row: WorkRow): SequenceEvidence {
  const review = readReviewEvidence(row.evidenceJson);
  const family = readFamilyWorkSnapshot(row.family_snapshot_json);
  const task = readSequenceWork(row.sequence_snapshot_json);
  const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(row.diagnostic_snapshot_json, {});
  const titles = review?.objectives ?? (family ? [{ id: family.objectiveId, title: family.objectiveTitle }] : diagnostic.objectives ?? jsonValue<Array<{ id: string; title: string }>>(row.objectiveTitlesJson, []));
  const scores = row.review_status === "reviewed" ? jsonValue<Array<{ objectiveId: string; score: number }>>(row.objectiveScoresJson, []) : [];
  return {
    id: row.id, title: task?.title ?? family?.title ?? diagnostic.title ?? row.assignmentTitle,
    prompt: task?.prompt ?? family?.detail ?? diagnostic.prompt ?? "", mediaId: diagnostic.mediaId ?? null,
    textAnswer: row.text_answer, hasAudio: !!row.asset_key, submittedAt: row.created_at, reviewedAt: row.reviewed_at,
    reviewed: row.review_status === "reviewed", score: row.review_status === "reviewed" ? row.score : null,
    feedback: row.review_status === "reviewed" ? row.feedback ?? "" : "",
    objectives: scores.map((item) => ({ id: item.objectiveId, title: titles.find((goal) => goal.id === item.objectiveId)?.title ?? item.objectiveId, score: item.score })),
    dimensions: row.review_status === "reviewed" ? jsonValue(row.dimensionScoresJson, []) : [],
    // 旧普通作品没有保存量规时，不能用当前作业补造历史评价依据。
    rubric: review?.rubric ?? task?.rubric ?? family?.rubric ?? (diagnostic.version === 1 ? diagnostic.rubric ?? null : null),
    helpLevel: row.family_help_level === "prompted" || row.family_help_level === "assisted" ? row.family_help_level
      : review?.helpLevel ?? (row.family_help_level === "independent" ? "independent" : "unknown"),
    contextConfirmed: review?.contextConfirmed ?? false, promptCount: readPromptCount(review?.promptCount),
  };
}
