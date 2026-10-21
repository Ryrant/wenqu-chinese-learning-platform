import { studentAccessClause, submissionAccessClause } from "./access-control";
import type { AbilityEvidence, AbilityProfile, ChoiceSnapshot, WorkDiagnosticSnapshot } from "./diagnostic-types";
import type { PlatformContext } from "./platform-store";
import { readReviewEvidence, submissionHelpLevel } from "./learning-sequence-types";
import { learningAnalyticsConsentSql, readLearningAnalyticsState } from "./learning-analytics";

export async function readAbilityProfile(context: PlatformContext, studentId: string): Promise<AbilityProfile> {
  const { db, tenantId } = context;
  const access = studentAccessClause(context, "u.id", "rm.tenant_id");
  const student = await db.prepare(`SELECT DISTINCT u.id,u.display_name AS displayName FROM users u
    JOIN role_memberships rm ON rm.user_id=u.id AND rm.tenant_id=? AND rm.role='student' AND rm.status='active'
    WHERE u.id=? AND u.status='active' AND ${access.sql}`)
    .bind(tenantId, studentId, ...access.args).first<{ id: string; displayName: string }>();
  if (!student) throw new Error("ability_profile_not_found");
  const analytics = await readLearningAnalyticsState(db, tenantId, studentId);
  if (!analytics.available) return { student, legacyAnswerCount: 0, evidence: [], ...analytics };
  const submissions = submissionAccessClause(context, "s", "c");
  const [choices, works] = await Promise.all([
    db.prepare(`SELECT da.evidence_json AS snapshot,da.selected_option AS selectedOption,da.is_correct AS isCorrect,
        dt.id AS attemptId,dt.level,dt.completed_at AS completedAt,dt.rowid AS sequence
      FROM diagnostic_answers da JOIN diagnostic_attempts dt ON dt.id=da.attempt_id AND dt.tenant_id=da.tenant_id
      WHERE da.tenant_id=? AND dt.student_user_id=? AND COALESCE(json_extract(da.evidence_json,'$.analyticsAllowed'),1)=1
        AND ${learningAnalyticsConsentSql("da.tenant_id", "dt.student_user_id")}
      ORDER BY dt.completed_at DESC,dt.id,da.rowid`)
      .bind(tenantId, studentId).all<{ snapshot: string; selectedOption: number; isCorrect: number; attemptId: string; level: string; completedAt: string; sequence: number }>(),
    db.prepare(`SELECT s.id,s.text_answer AS textAnswer,s.asset_key AS assetKey,s.review_status AS reviewStatus,
        s.created_at AS submittedAt,s.reviewed_at AS reviewedAt,s.feedback,s.family_help_level AS familyHelp,
        s.diagnostic_snapshot_json AS snapshot,sr.objective_scores_json AS objectiveScores,sr.dimension_scores_json AS dimensions,sr.evidence_json AS reviewEvidence,
        u.display_name AS reviewer,COALESCE(sr.rowid,s.rowid) AS sequence
      FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
      JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      LEFT JOIN submission_reviews sr ON sr.tenant_id=s.tenant_id AND sr.submission_id=s.id AND sr.status='confirmed'
      LEFT JOIN users u ON u.id=sr.reviewer_user_id
      WHERE s.tenant_id=? AND s.student_user_id=? AND s.diagnostic_snapshot_json!='{}' AND ${submissions.sql}
        AND COALESCE(json_extract(sr.evidence_json,'$.analyticsAllowed'),1)=1
        AND COALESCE(json_extract(s.diagnostic_snapshot_json,'$.analyticsAllowed'),1)=1
        AND ${learningAnalyticsConsentSql("s.tenant_id", "s.student_user_id")}
      ORDER BY s.created_at DESC,s.rowid DESC`)
      .bind(tenantId, studentId, ...submissions.args).all<{ id: string; textAnswer: string | null; assetKey: string | null; reviewStatus: string; submittedAt: string; reviewedAt: string | null; feedback: string | null; familyHelp: string | null; snapshot: string; objectiveScores: string | null; dimensions: string | null; reviewEvidence: string | null; reviewer: string | null; sequence: number }>(),
  ]);
  const grouped = new Map<string, { evidence: AbilityEvidence; results: Map<string, { title: string; correct: number; count: number }> }>();
  let legacyAnswerCount = 0;
  for (const row of choices.results) {
    const snapshot = JSON.parse(row.snapshot) as Partial<ChoiceSnapshot>;
    // 历史答案没有题面快照，不能用编辑后的题目补造原始证据。
    if (snapshot.version !== 1 || !snapshot.ability || !snapshot.objectiveId || !snapshot.options) { legacyAnswerCount++; continue; }
    const key = `${row.attemptId}:${snapshot.ability}`;
    let group = grouped.get(key);
    if (!group) {
      group = { results: new Map(), evidence: {
        id: key, ability: snapshot.ability, kind: "choice", title: `${row.level} ${snapshot.ability === "listening" ? "听力" : "阅读"}选择题`,
        submittedAt: row.completedAt, measuredAt: row.completedAt, status: "assessed", sequence: row.sequence, evidenceCount: 0, scores: [], answers: [],
        submissionId: null, textAnswer: null, hasAudio: false, prompt: "", mediaId: null, reviewer: "客观题核对", feedback: null, dimensions: [], familyHelp: null,
      } };
      grouped.set(key, group);
    }
    group.evidence.evidenceCount++;
    group.evidence.answers.push({ prompt: snapshot.prompt ?? "", selected: snapshot.options[row.selectedOption], expected: snapshot.options[snapshot.correctOption!], correct: row.isCorrect === 1, mediaId: snapshot.mediaId ?? null });
    const result = group.results.get(snapshot.objectiveId) ?? { title: snapshot.objectiveTitle ?? snapshot.objectiveId, correct: 0, count: 0 };
    result.count++; result.correct += row.isCorrect === 1 ? 1 : 0;
    group.results.set(snapshot.objectiveId, result);
  }
  const evidence: AbilityEvidence[] = [...grouped.values()].map((group) => ({ ...group.evidence,
    scores: [...group.results].map(([objectiveId, result]) => ({ objectiveId, title: result.title, score: Math.round(result.correct / result.count * 100) })),
  }));
  for (const row of works.results) {
    const snapshot = JSON.parse(row.snapshot) as WorkDiagnosticSnapshot;
    if (snapshot.version !== 1) continue;
    const measured = (JSON.parse(row.objectiveScores ?? "[]") as Array<{ objectiveId: string; score: number }>);
    const scores = row.reviewStatus === "reviewed" ? measured.map((item) => ({ ...item, title: snapshot.objectives.find((goal) => goal.id === item.objectiveId)?.title ?? item.objectiveId })) : [];
    const status = row.reviewStatus !== "reviewed" ? "pending" : scores.length ? "assessed" : "unassessed";
    evidence.push({ id: row.id, ability: snapshot.ability, kind: "work", title: snapshot.title, submittedAt: row.submittedAt,
      measuredAt: row.reviewedAt, status, sequence: row.sequence, evidenceCount: status === "assessed" ? 1 : 0, scores, answers: [],
      submissionId: row.id, textAnswer: row.textAnswer, hasAudio: !!row.assetKey, prompt: snapshot.prompt, mediaId: snapshot.mediaId,
      reviewer: row.reviewer, feedback: row.feedback, dimensions: JSON.parse(row.dimensions ?? "[]"), familyHelp: row.familyHelp,
      helpLevel: submissionHelpLevel(row.familyHelp, readReviewEvidence(row.reviewEvidence)?.helpLevel),
    });
  }
  evidence.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.id.localeCompare(b.id));
  return { student, legacyAnswerCount, evidence, ...analytics };
}
