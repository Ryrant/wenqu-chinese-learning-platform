import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "../workspace/workspace-ui";

import type { Act, Notify, Row, WorkspaceData } from "../../lib/platform-types";
import { stringValue } from "../../lib/platform-types";
import type { DimensionReviewScore, ObjectiveReviewScore, ReviewSuggestion } from "../../lib/assessment-service";
import type { WorkDiagnosticSnapshot } from "../../lib/diagnostic-types";
import { DiagnosticStimulus } from "../diagnostic-evidence";
import { readFamilyWorkSnapshot } from "../../lib/family-task";
import { FamilyExchangeConfirmation, FamilyWorkEvidence } from "../family/family-task-guide";
import { HELP_LEVEL_LABELS, readSequenceWork, sequenceTime, type HelpLevel } from "../../lib/learning-sequence-types";
import { WorkEvidence } from "../learning/learning-sequences";
import sequenceStyles from "../learning/learning-sequences.module.css";

export type ReviewDraft = { score: string; comment: string; objectiveScores: Record<string, string>; dimensionScores: Record<string, string>; helpLevel?: HelpLevel | ""; contextConfirmed?: boolean; promptCount?: string };

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
  const retestReference = sequence?.stage === "retest" ? data.learningSequences?.find((item) => item.id === sequence.sequenceId)?.transfer.find((work) => work.id === sequence.referenceSubmissionId) : undefined;
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
      if (result.suggestedScore === null) return notify("未获得评分建议", "请依据学生作品填写评价。");
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
      await act("confirm_submission_review", { id, score: Number(draft.score), comment: draft.comment, objectiveScores, dimensionScores, helpLevel: draft.helpLevel || "unknown", contextConfirmed: draft.contextConfirmed ?? false, promptCount: draft.promptCount?.trim() ? Number(draft.promptCount) : null });
      onReviewed(); notify("评分已保存", "仅明确评价的目标已更新掌握度。");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "请重试";
      notify("评分失败", message === "invalid_review_prompt_count" ? "提示次数需为 0 到 1000 的整数，未核对时请留空。" : message === "invalid_review_prompt_observation" ? "提示次数与已记录的帮助程度不一致，请核对后再保存；输入已保留。" : message, "error");
    }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <SectionHeading title={sequence?.title ?? stringValue(submission.assignmentTitle)} description={`${stringValue(submission.studentName)} · ${submission.asset_key ? "语音作品" : "文字作业"}`} action={<Badge variant="outline">待批阅</Badge>}/>
    <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><div className="min-w-0 space-y-5">
    <section className="submission-content rounded-lg bg-muted/50 p-4"><h4 className="mb-3 text-sm font-medium">学生作品</h4>{submission.asset_key ? <audio key={id} controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(id)}/audio`} aria-label="学生录音"/> : <p>{stringValue(submission.text_answer)}</p>}</section>
    {snapshot.version === 1 && <section className="diagnostic-task-prompt"><h4>本次诊断要求</h4><p>{snapshot.prompt}</p>{snapshot.mediaId && <DiagnosticStimulus id={snapshot.mediaId} kind="image"/>}</section>}
    {!!submission.family_task_id && <><FamilyWorkEvidence value={submission.family_snapshot_json}/><FamilyExchangeConfirmation key={id} work={submission} actor="teacher" act={act} notify={notify}/></>}
    {sequence && <section className="diagnostic-task-prompt"><h4>本阶段要求</h4><p>{sequence.prompt}</p><p>情境变化：{sequence.context}</p>{sequence.availableAt && <p>复测开放：{sequenceTime(sequence.availableAt)}</p>}
      {retestReference && <details><summary>查看固定参照迁移作品 · {retestReference.id.slice(0, 8)}</summary><WorkEvidence work={retestReference} objectiveId={sequence.objectiveId}/></details>}</section>}
    {!!submission.text_answer && <Button type="button" variant="outline" disabled={busy} onClick={suggest}>生成 AI 建议</Button>}
    {review?.status === "ai_suggested" && <div className="ai-review-box"><strong>{review.ai_suggested_score == null ? "未获得可靠评分建议" : `AI 建议：${review.ai_suggested_score} 分`}</strong><p>{stringValue(review.ai_comment, "暂无文字建议")}</p></div>}
    </div><form className="review-confirm-form min-w-0 rounded-xl border bg-muted/30 p-5" onSubmit={confirm}>
      <SectionHeading title="评价与反馈"/><label>总分<Input type="number" min="0" max="100" step="any" required disabled={busy} value={draft.score} onChange={(event) => setDraft({ ...draft, score: event.target.value })}/></label>
      <fieldset className="review-score-group" disabled={busy}><legend>目标评价</legend><p>未观察到的目标留空，不更新掌握度。</p>{objectives.map((item) => <label key={String(item.id)}>{stringValue(item.title)}<Input type="number" min="0" max="100" step="any" placeholder="未评价" value={draft.objectiveScores[String(item.id)] ?? ""} onChange={(event) => setDraft({ ...draft, objectiveScores: { ...draft.objectiveScores, [String(item.id)]: event.target.value } })}/></label>)}</fieldset>
      {rubric.length !== storedRubric.length && <p>原量规有重名维度，这些维度暂不评分；仍可填写总分、目标分及其余维度。</p>}
      {!!rubric.length && <fieldset className="review-score-group" disabled={busy}><legend>量规维度评价</legend>{rubric.map((item) => <label key={item.name}>{item.name}（权重 {item.weight}%）<Input type="number" min="0" max="100" step="any" placeholder="未评价" value={draft.dimensionScores[item.name] ?? ""} onChange={(event) => setDraft({ ...draft, dimensionScores: { ...draft.dimensionScores, [item.name]: event.target.value } })}/></label>)}</fieldset>}
      <label>给学生的反馈<Textarea value={draft.comment} disabled={busy} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} placeholder="说明优点、改进点与下一步建议" maxLength={2000} required/></label>
      <fieldset className={sequenceStyles.observations} disabled={busy}><legend>完成条件观察</legend><label>教师观察到的帮助程度<NativeSelect className="w-full" value={draft.helpLevel ?? (sequence ? "" : "unknown")} required={!!sequence} onChange={(event) => setDraft({ ...draft, helpLevel: event.target.value as HelpLevel })}>{sequence && <option value="">请选择实际情况</option>}{Object.entries(HELP_LEVEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
      {(sequence?.stage === "transfer" || sequence?.stage === "retest") && <label className={sequenceStyles.check}><input type="checkbox" checked={draft.contextConfirmed ?? false} onChange={(event) => setDraft({ ...draft, contextConfirmed: event.target.checked })}/>已核对本次对象或情境与{sequence.stage === "retest" ? "参照迁移作品" : "初次任务"}不同；未勾选时保留“尚待验证”。</label>}</fieldset>
      <label>提示次数（经教师核对，可留空）<Input type="number" min="0" max="1000" step="1" disabled={busy} value={draft.promptCount ?? ""} onChange={(event) => setDraft({ ...draft, promptCount: event.target.value })}/><small>仅记录针对内容提供的提示，不含任务说明。空白为未记录，0 表示已核对没有提示。</small></label>
      {waitingForFamily && <p role="status">确认交流与帮助情况后，可以保存教师评价；同伴或教师替代交流可由本班教师见证确认。</p>}
      <Button type="submit" disabled={busy || waitingForFamily}>{busy ? "处理中…" : "保存评价"}</Button>
    </form>
  </div></div>;
}
