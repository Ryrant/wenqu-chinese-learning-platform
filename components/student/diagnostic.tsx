import { useRef, useState } from "react";
import { numberValue, stringValue } from "@/lib/platform-types";
import { DiagnosticStimulus } from "@/components/diagnostic-evidence";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import type { LoopProps } from "@/lib/learning-display";
import { optionsFrom } from "@/lib/learning-display";

export function StudentDiagnostic({ data, act, notify, onStartAssignment }: LoopProps & { onStartAssignment?: (id: string) => void }) {
  const levels = [...new Set(data.diagnosticItems.map((item) => stringValue(item.level, "A2")))];
  const [selectedLevel, setSelectedLevel] = useState(levels[0] ?? "A2");
  const items = data.diagnosticItems.filter((item) => stringValue(item.level, "A2") === selectedLevel);
  const diagnosticAssignments = data.assignments.filter((item) => item.status === "published" && item.diagnostic_mode);
  const [answers, setAnswers] = useState<Record<string, { selectedOption: number; revision: number }>>({});
  const [busy, setBusy] = useState(false);
  const pendingAttempt = useRef<{ key: string; id: string } | null>(null);
  const level = selectedLevel;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!items.every((item) => answers[String(item.id)]?.revision === Number(item.revision))) {
      notify("还有题目未完成或已更新", "请按当前题面回答全部四选一题目后再提交。", "error");
      return;
    }
    setBusy(true);
    try {
      const submittedAnswers = items.map((item) => ({ itemId: String(item.id), ...answers[String(item.id)] }));
      const key = JSON.stringify({ level, answers: submittedAnswers });
      if (pendingAttempt.current?.key !== key) pendingAttempt.current = { key, id: crypto.randomUUID() };
      const result = await act("submit_diagnostic", {
        attemptId: pendingAttempt.current.id, level, answers: submittedAnswers,
      });
      pendingAttempt.current = null;
      setAnswers({});
      notify("诊断已完成", `本次正确率 ${Math.round(numberValue(result.score) * 100)}%，错题已加入复习中心。`);
    } catch (reason) {
      notify("诊断提交失败", reason instanceof Error && reason.message === "invalid_diagnostic_revision" ? "题目在作答期间已更新，请刷新页面后重新作答；本次未生成成绩。" : reason instanceof Error ? reason.message : "请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!data.diagnosticItems.length && !diagnosticAssignments.length && !data.diagnosticSummary) return null;

  return <Card className="panel loop-panel">
    <div className="panel-heading">
      <div><h3>入学诊断</h3></div>
      {data.diagnosticSummary && <Badge variant="secondary">最近 {Math.round(numberValue(data.diagnosticSummary.score) * 100)}%</Badge>}
    </div>
    {!!items.length && <p className="text-muted-foreground">选择一个答案，了解当前阅读与听力水平。</p>}
    {levels.length > 1 && <label className="diagnostic-level">
      诊断级别
      <NativeSelect className="w-full" value={selectedLevel} disabled={busy} onChange={(event) => {
        setSelectedLevel(event.target.value);
        setAnswers({});
      }}>
        {levels.map((item) => <option key={item} value={item}>{item}</option>)}
      </NativeSelect>
    </label>}
    {items.length ? <form onSubmit={submit} className="diagnostic-form">
      {items.map((item, index) => {
        const id = String(item.id);
        const options = optionsFrom(item.optionsJson ?? item.options_json);
        const mediaId = item.mediaId ?? item.media_id;
        return <fieldset key={id}>
          <legend><b>{index + 1}.</b> {stringValue(item.prompt)} <small>{stringValue(item.objectiveTitle)}</small></legend>
          {item.ability === "listening" && !!mediaId && <DiagnosticStimulus id={String(mediaId)} kind="audio"/>}
          <div className="option-grid">{options.map((option, optionIndex) => <label key={option}>
            <input type="radio" name={`diagnostic-${id}`} disabled={busy} checked={answers[id]?.revision === Number(item.revision) && answers[id]?.selectedOption === optionIndex} onChange={() => setAnswers({ ...answers, [id]: { selectedOption: optionIndex, revision: Number(item.revision) } })}/>
            <span>{String.fromCharCode(65 + optionIndex)}. {option}</span>
          </label>)}</div>
        </fieldset>;
      })}
      <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={busy}>{busy ? "正在提交…" : "提交诊断"}</Button>
    </form> : !!data.diagnosticItems.length && <p className="empty-state">机构尚未发布当前级别的诊断题。</p>}
    {!!diagnosticAssignments.length && <><h4>口述与短文诊断</h4>
    {diagnosticAssignments.map((item) => <div className="history-row" key={String(item.id)}>
      <div><strong>{stringValue(item.title)}</strong><small>{item.diagnostic_mode === "speaking" ? "图片口述 · 提交录音" : "短文表达 · 提交文字"} · 教师评价</small></div>
      {onStartAssignment && <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" onClick={() => onStartAssignment(String(item.id))}>进入诊断任务</Button>}
    </div>)}</>}
  </Card>;
}

export default StudentDiagnostic;
