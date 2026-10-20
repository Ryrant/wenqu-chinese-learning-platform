import { useState } from "react";
import { stringValue } from "@/app/lib/platform-types";
import type { InterventionSuggestion } from "@/app/lib/diagnostic-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import type { LoopProps } from "@/app/features/shared/learning-display";

export function TeacherIntervention({ data, act, notify }: LoopProps) {
  const students = [...new Map(data.enrollments.filter((item) => item.status === "active").map((item) => [String(item.studentUserId), stringValue(item.studentName)])).entries()];
  const objectives = data.learningObjectives.filter((item) => item.status !== "inactive");
  const [studentUserId, setStudentUserId] = useState(students[0]?.[0] ?? "");
  const [objectiveId, setObjectiveId] = useState(String(objectives[0]?.id ?? ""));
  const [title, setTitle] = useState("专项巩固");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [suggestion, setSuggestion] = useState<InterventionSuggestion | null>(null);
  const [busy, setBusy] = useState<"suggest" | "publish" | null>(null);
  const [stale, setStale] = useState(false);

  function resetDraft() {
    setSuggestion(null); setStale(false); setTitle("专项巩固"); setDetail(""); setDueAt("");
  }

  async function suggest() {
    if (busy) return;
    setBusy("suggest");
    try {
      const result = await act("suggest_intervention", { studentUserId, objectiveId });
      const draft = result.suggestion as InterventionSuggestion;
      setSuggestion(draft); setStale(false);
      if (draft.ready) { setTitle(draft.title); setDetail(draft.detail); }
    } catch (reason) {
      notify("草稿生成失败", reason instanceof Error ? reason.message : "请重试，当前输入已保留。", "error");
    } finally { setBusy(null); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || stale || (suggestion && !suggestion.ready)) return;
    setBusy("publish");
    try {
      const result = await act("create_intervention", { studentUserId, objectiveId, title, detail, dueAt: dueAt || null,
        ...(suggestion ? { evidenceKey: suggestion.evidenceKey } : {}) });
      resetDraft();
      notify(result.created === false ? "相同依据的任务已存在" : "针对练习已发布", result.created === false
        ? `原任务${result.status === "completed" ? "已经完成" : "仍在学生计划中"}，本次没有重复发送。` : "教师确认的练习与依据已进入学生今日计划。");
    } catch (reason) {
      if (reason instanceof Error && reason.message === "support_evidence_changed") setStale(true);
      notify("干预发布失败", reason instanceof Error && reason.message === "support_evidence_changed"
        ? "诊断证据已更新，请重新生成并核对草稿；当前输入已保留。" : reason instanceof Error ? reason.message : "请重试", "error");
    } finally { setBusy(null); }
  }

  return <form className="panel form-card" onSubmit={submit}>
    <div><h3>安排针对练习</h3></div>
    <fieldset className="diagnostic-form-fields" disabled={!!busy}>
    <label>学生<NativeSelect className="w-full" value={studentUserId} onChange={(event) => { setStudentUserId(event.target.value); resetDraft(); }} required><option value="">请选择</option>{students.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</NativeSelect></label>
    <label>学习目标<NativeSelect className="w-full" value={objectiveId} onChange={(event) => { setObjectiveId(event.target.value); resetDraft(); }} required><option value="">请选择</option>{objectives.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.title)}</option>)}</NativeSelect></label>
    <small>切换学生或目标会清空当前未发布草稿。</small>
    <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" disabled={!studentUserId || !objectiveId} onClick={suggest}>{busy === "suggest" ? "正在读取诊断证据…" : "依据诊断生成草稿"}</Button>
    {suggestion && <section aria-live="polite"><strong>{suggestion.ready ? "支持任务草稿 · 待教师确认" : "证据不足 · 请补充诊断或评价"}</strong>
      <details className="support-evidence" open={!suggestion.ready || stale}><summary>选择依据与评价记录</summary><p className="generated-copy">{suggestion.rationale}</p></details>
      {stale && <p role="alert">证据已更新，请重新生成草稿后核对；当前输入尚未发送。</p>}
      <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" onClick={resetDraft}>改为教师手动安排</Button>
    </section>}
    {(!suggestion || suggestion.ready) && <><label>任务标题<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required/></label>
    <label>干预说明<Textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="说明练习重点与完成标准" maxLength={1000} required={!!suggestion}/></label>
    <label>截止时间<Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label></>}
    </fieldset>
    {(!suggestion || suggestion.ready) && <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={!!busy || stale || !studentUserId || !objectiveId}>{busy === "publish" ? "发布中…" : suggestion ? "确认支持方案并发布" : "发送到学生计划"}</Button>}
  </form>;
}

export default TeacherIntervention;
