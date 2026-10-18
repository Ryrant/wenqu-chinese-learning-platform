"use client";

import type { Act, Notify, Row, WorkspaceData } from "./lib/platform-types";
import { stringValue } from "./lib/platform-types";
import type { DimensionReviewScore, ObjectiveReviewScore, ReviewSuggestion } from "./lib/assessment-service";
import type { WorkDiagnosticSnapshot } from "./lib/diagnostic-types";
import { DiagnosticStimulus } from "./diagnostic-evidence";
import { readFamilyWorkSnapshot } from "./lib/family-task";
import { FamilyExchangeConfirmation, FamilyWorkEvidence } from "./family-task-guide";
import { HELP_LEVEL_LABELS, readSequenceWork, type HelpLevel } from "./lib/learning-sequence-types";
import sequenceStyles from "./learning-sequences.module.css";

export type ReviewDraft = { score: string; comment: string; objectiveScores: Record<string, string>; dimensionScores: Record<string, string>; helpLevel?: HelpLevel | ""; contextConfirmed?: boolean };

function scoreMap(value: unknown, key: "objectiveId" | "name") {
  const items = JSON.parse(typeof value === "string" ? value : "[]") as Array<Record<string, string | number>>;
  return Object.fromEntries(items.map((item) => [String(item[key]), String(item.score)]));
}

export function SubmissionReview({ submission, review, data, savedDraft, setDraft, busy, setBusy, act, notify, onReviewed }: {
  submission: Row; review?: Row; data: WorkspaceData; savedDraft?: ReviewDraft; setDraft: (draft: ReviewDraft) => void;
  busy: boolean; setBusy: (value: boolean) => void; act: Act; notify: Notify; onReviewed: () => void;
}) {
  const id = String(submission.id);
  const assignment = data.assignments.find((item) => item.id === submission.assignment_id);
  const snapshot = JSON.parse(stringValue(submission.diagnostic_snapshot_json, "{}")) as Partial<WorkDiagnosticSnapshot>;
  const family = readFamilyWorkSnapshot(submission.family_snapshot_json);
  const sequence = readSequenceWork(submission.sequence_snapshot_json);
  const objectiveIds = stringValue(assignment?.objectiveIds, "").split(",");
  const objectives = sequence ? [{ id: sequence.objectiveId, title: sequence.objectiveTitle }] : family ? [{ id: family.objectiveId, title: family.objectiveTitle }] : snapshot.version === 1 && snapshot.objectives ? snapshot.objectives : data.learningObjectives.filter((item) => objectiveIds.includes(String(item.id)));
  const storedRubric = sequence?.rubric ?? family?.rubric ?? (snapshot.version === 1 && snapshot.rubric ? snapshot.rubric : JSON.parse(stringValue(assignment?.rubric_json, "[]")) as Array<{ name: string; weight: number }>);
  const rubric = storedRubric.filter((item) => storedRubric.filter((other) => other.name === item.name).length === 1);
  const draft = savedDraft ?? {
    score: review?.ai_suggested_score == null ? "" : String(review.ai_suggested_score), comment: "",
    objectiveScores: scoreMap(review?.objective_scores_json, "objectiveId"), dimensionScores: scoreMap(review?.dimension_scores_json, "name"),
  };
  const waitingForFamily = !!submission.family_task_id && !submission.family_confirmed_at;

  async function suggest() {
    setBusy(true);
    try {
      const result = await act("suggest_text_review", { id }) as unknown as ReviewSuggestion;
      if (result.suggestedScore === null) return notify("未获得评分建议", "请依据学生作品填写评价，已有输入已保留。");
      setDraft({ ...draft, score: String(result.suggestedScore), comment: result.comment,
        objectiveScores: Object.fromEntries(result.objectiveScores.map((item) => [item.objectiveId, String(item.score)])),
        dimensionScores: Object.fromEntries(result.dimensionScores.map((item) => [item.name, String(item.score)])),
      });
      notify("AI 建议已生成", "请核对各项目后再确认评分。");
    } catch (reason) { notify("生成建议失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const objectiveScores: ObjectiveReviewScore[] = objectives.flatMap((item) => {
        const value = draft.objectiveScores[String(item.id)];
        return value?.trim() ? [{ objectiveId: String(item.id), score: Number(value) }] : [];
      });
      const dimensionScores: DimensionReviewScore[] = rubric.flatMap((item) => {
        const value = draft.dimensionScores[item.name];
        return value?.trim() ? [{ name: item.name, score: Number(value) }] : [];
      });
      await act("confirm_submission_review", { id, score: Number(draft.score), comment: draft.comment, objectiveScores, dimensionScores, helpLevel: draft.helpLevel || "unknown", contextConfirmed: draft.contextConfirmed ?? false });
      onReviewed(); notify("评分已保存", "仅明确评价的目标已更新掌握度。");
    } catch (reason) { notify("评分失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  return <>
    <div className="panel-heading"><div><span className="eyebrow">教师批阅面板</span><h3>{sequence?.title ?? stringValue(submission.assignmentTitle)}</h3><p>{stringValue(submission.studentName)} · {submission.asset_key ? "语音作品" : "文字作业"}</p></div><span className="status draft">待审核</span></div>
    <section className="submission-content"><h4>学生提交内容</h4>{submission.asset_key ? <audio key={id} controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(id)}/audio`} aria-label="学生录音"/> : <p>{stringValue(submission.text_answer)}</p>}</section>
    {snapshot.version === 1 && <section className="diagnostic-task-prompt"><h4>本次诊断要求</h4><p>{snapshot.prompt}</p>{snapshot.mediaId && <DiagnosticStimulus id={snapshot.mediaId} kind="image"/>}<small>以下目标和量规采用学生提交时保存的版本。</small></section>}
    {!!submission.family_task_id && <><FamilyWorkEvidence value={submission.family_snapshot_json}/><FamilyExchangeConfirmation key={id} work={submission} actor="teacher" act={act} notify={notify}/><small>家庭交流作品使用提交时保存的学习目标与量规。</small></>}
    {sequence && <section className="diagnostic-task-prompt"><h4>本阶段要求</h4><p>{sequence.prompt}</p><p>迁移情境变化：{sequence.context}</p><small>使用本组固定的目标与量规；实际帮助和新情境需由教师核对。</small></section>}
    {submission.text_answer && <button type="button" className="soft-button" disabled={busy} onClick={suggest}>生成 AI 建议</button>}
    {review?.status === "ai_suggested" && <div className="ai-review-box"><strong>{review.ai_suggested_score == null ? "未获得可靠评分建议" : `AI 建议：${review.ai_suggested_score} 分`}</strong><p>{stringValue(review.ai_comment, "暂无文字建议")}</p><small>该建议不会自动写入学生成绩。</small></div>}
    <form className="review-confirm-form" onSubmit={confirm}>
      <label>教师确认总分<input type="number" min="0" max="100" step="any" required disabled={busy} value={draft.score} onChange={(event) => setDraft({ ...draft, score: event.target.value })}/></label>
      <fieldset className="review-score-group" disabled={busy}><legend>目标评价</legend><p>未观察到的目标留空，不更新掌握度。</p>{objectives.map((item) => <label key={String(item.id)}>{stringValue(item.title)}<input type="number" min="0" max="100" step="any" placeholder="未评价" value={draft.objectiveScores[String(item.id)] ?? ""} onChange={(event) => setDraft({ ...draft, objectiveScores: { ...draft.objectiveScores, [String(item.id)]: event.target.value } })}/></label>)}</fieldset>
      {rubric.length !== storedRubric.length && <p>原量规有重名维度，这些维度暂不评分；仍可填写总分、目标分及其余维度。</p>}
      {!!rubric.length && <fieldset className="review-score-group" disabled={busy}><legend>量规维度评价</legend>{rubric.map((item) => <label key={item.name}>{item.name}（权重 {item.weight}%）<input type="number" min="0" max="100" step="any" placeholder="未评价" value={draft.dimensionScores[item.name] ?? ""} onChange={(event) => setDraft({ ...draft, dimensionScores: { ...draft.dimensionScores, [item.name]: event.target.value } })}/></label>)}</fieldset>}
      <label>给学生的反馈<textarea value={draft.comment} disabled={busy} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} placeholder="说明优点、改进点与下一步建议" maxLength={2000} required/></label>
      <fieldset className={sequenceStyles.observations} disabled={busy}><legend>完成条件观察</legend><label>教师观察到的帮助程度<select value={draft.helpLevel ?? (sequence ? "" : "unknown")} required={!!sequence} onChange={(event) => setDraft({ ...draft, helpLevel: event.target.value as HelpLevel })}>{sequence && <option value="">请选择实际情况</option>}{Object.entries(HELP_LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {sequence?.stage === "transfer" && <label className={sequenceStyles.check}><input type="checkbox" checked={draft.contextConfirmed ?? false} onChange={(event) => setDraft({ ...draft, contextConfirmed: event.target.checked })}/>已核对本次对象或情境与初次任务不同；未勾选时保留“迁移尚待验证”。</label>}</fieldset>
      {waitingForFamily && <p role="status">确认交流与帮助情况后，可以保存教师评价；同伴或教师替代交流可由本班教师见证确认。</p>}
      <button className="primary-button" disabled={busy || waitingForFamily}>{busy ? "处理中…" : "教师确认并保存"}</button>
    </form>
  </>;
}
