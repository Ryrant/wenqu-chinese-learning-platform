import { useState } from "react";
import { isRecommendationDue } from "@/app/lib/learning-loop";
import { stringValue } from "@/app/lib/platform-types";
import { DiagnosticStimulus } from "@/app/diagnostic-evidence";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { LoopProps } from "@/app/features/shared/learning-display";
import { optionsFrom, dueLabel } from "@/app/features/shared/learning-display";

export function StudentReviewCenter({ data, act, refresh, notify }: LoopProps & { refresh: () => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, { selectedOption: number; revision: number }>>({});
  const [busyId, setBusyId] = useState("");
  const reviews = data.recommendations.filter((item) =>
    item.source_type === "diagnostic"
    && item.status === "pending"
    && isRecommendationDue(typeof item.due_at === "string" ? item.due_at : null)
  );

  async function answer(id: string) {
    const item = reviews.find((review) => review.id === id);
    if (!item || !Number.isInteger(answers[id]?.selectedOption) || answers[id].revision !== Number(item.reviewRevision)) return notify("请选择答案", "请按当前题目选择一个选项后再提交。", "error");
    setBusyId(id);
    try {
      const result = await act("answer_review_item", { id, ...answers[id] });
      notify(result.correct ? "回答正确" : "需要再巩固", result.correct ? "这道错题已完成。" : "系统已安排次日再次复习。");
    } catch (reason) {
      if (reason instanceof Error && reason.message === "review_item_changed") {
        try { await refresh(); notify("题目已更新，本次未计分", "请按最新题目重新选择答案；题目所属目标改变时，请重新完成诊断。", "error"); }
        catch (error) { notify("题目已更新，本次未计分", `重新读取失败：${error instanceof Error ? error.message : "请刷新页面后重试"}`, "error"); }
      } else notify("复习提交失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusyId("");
    }
  }

  return <Card className="panel loop-panel">
    <div className="panel-heading"><div><h3>错题复习</h3></div><span>{reviews.length} 题</span></div>
    {reviews.length ? reviews.map((item) => {
      const id = String(item.id);
      const options = optionsFrom(item.reviewOptionsJson);
      return <div className="review-card" key={id}>
        <strong>{stringValue(item.reviewPrompt, stringValue(item.title))}</strong>
        <small>{stringValue(item.objectiveTitle)} · {dueLabel(item.due_at)}</small>
        {item.reviewAbility === "listening" && !!item.reviewMediaId && <DiagnosticStimulus id={String(item.reviewMediaId)} kind="audio"/>}
        <div className="option-grid">{options.map((option, index) => <label key={option}>
          <input type="radio" name={`review-${id}`} disabled={busyId === id} checked={answers[id]?.revision === Number(item.reviewRevision) && answers[id]?.selectedOption === index} onChange={() => setAnswers({ ...answers, [id]: { selectedOption: index, revision: Number(item.reviewRevision) } })}/>
          <span>{String.fromCharCode(65 + index)}. {option}</span>
        </label>)}</div>
        <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" disabled={busyId === id} onClick={() => answer(id)}>{busyId === id ? "提交中…" : "检查答案"}</Button>
      </div>;
    }) : <p className="empty-state">暂无到期错题，完成入学诊断后可在这里复习。</p>}
  </Card>;
}

export default StudentReviewCenter;
