import { useState } from "react";
import { stringValue } from "@/app/lib/platform-types";
import { DiagnosticMediaInput } from "@/app/diagnostic-evidence";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionHeading } from "@/app/components/workspace-ui";
import type { LoopProps } from "@/app/features/shared/learning-display";

export function AdminObjectiveLibrary({ data, act, notify }: LoopProps) {
  const [code, setCode] = useState("A2-NEW");
  const [title, setTitle] = useState("");
  const [skill, setSkill] = useState("阅读");
  const [level, setLevel] = useState("A2");
  const [objectiveId, setObjectiveId] = useState(String(data.learningObjectives[0]?.id ?? ""));
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctOption, setCorrectOption] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [ability, setAbility] = useState("reading");
  const [mediaId, setMediaId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [questionLevel, setQuestionLevel] = useState("A2");

  async function saveObjective(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await act("upsert_learning_objective", { code, title, skill, level, status: "active" });
      setTitle("");
      setObjectiveId(String(result.id));
      notify("课程目标已保存", "目标可用于诊断题、任务和掌握度统计。");
    } catch (reason) {
      notify("目标保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
  }

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    setSavingQuestion(true);
    try {
      await act("upsert_diagnostic_item", { objectiveId, level: questionLevel, prompt, options, correctOption, explanation, ability, mediaId, status: "active" });
      setPrompt(""); setOptions(["", "", "", ""]); setExplanation("");
      setMediaId("");
      notify("诊断题已保存", "四选一题目已加入学生入学诊断。");
    } catch (reason) {
      notify("题目保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally { setSavingQuestion(false); }
  }

  return <section className="loop-section">
    <SectionHeading title="课程目标与诊断题库"/>
    <section className="loop-grid">
      <form className="panel form-card" onSubmit={saveObjective}>
        <h3>新增课程目标</h3>
        <div className="field-row"><label>目标代码<Input value={code} onChange={(event) => setCode(event.target.value)} required/></label><label>级别<NativeSelect className="w-full" value={level} onChange={(event) => setLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option><option>B2</option></NativeSelect></label></div>
        <label>目标名称<Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：理解节日叙事" required/></label>
        <label>技能领域<NativeSelect className="w-full" value={skill} onChange={(event) => setSkill(event.target.value)}><option>听力</option><option>口语</option><option>阅读</option><option>写作</option><option>文化</option></NativeSelect></label>
        <Button type="submit" className="h-auto min-h-10 whitespace-normal">保存课程目标</Button>
        <small>当前共有 {data.learningObjectives.length} 个目标。</small>
      </form>
      <form className="panel form-card" onSubmit={saveQuestion}>
        <h3>新增四选一诊断题</h3>
        <fieldset className="diagnostic-form-fields" disabled={uploading || savingQuestion}>
        <label>诊断能力<NativeSelect className="w-full" value={ability} disabled={uploading || savingQuestion} onChange={(event) => { setAbility(event.target.value); setMediaId(""); }}><option value="reading">阅读理解</option><option value="listening">听力理解</option></NativeSelect></label>
        <label>题目级别<NativeSelect className="w-full" value={questionLevel} onChange={(event) => setQuestionLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option><option>B2</option></NativeSelect></label>
        {ability === "listening" && <DiagnosticMediaInput kind="audio" value={mediaId} onChange={setMediaId} uploading={uploading} setUploading={setUploading} notify={notify} disabled={savingQuestion}/>}
        <label>关联目标<NativeSelect className="w-full" value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required><option value="">请选择</option>{data.learningObjectives.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.code)} · {stringValue(item.title)}</option>)}</NativeSelect></label>
        <label>题干<Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} required maxLength={500}/></label>
        {options.map((option, index) => <label key={index}>选项 {String.fromCharCode(65 + index)}<Input value={option} onChange={(event) => setOptions(options.map((value, optionIndex) => optionIndex === index ? event.target.value : value))} required/></label>)}
        <label>正确选项<NativeSelect className="w-full" value={correctOption} onChange={(event) => setCorrectOption(Number(event.target.value))}>{options.map((_, index) => <option value={index} key={index}>{String.fromCharCode(65 + index)}</option>)}</NativeSelect></label>
        <label>解析<Textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} maxLength={1000}/></label>
        </fieldset>
        <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={!objectiveId || savingQuestion || uploading || (ability === "listening" && !mediaId)}>{savingQuestion ? "正在保存…" : "保存诊断题"}</Button>
      </form>
    </section>
    <Card className="panel"><h3>题库概览</h3>{data.diagnosticItems.length ? data.diagnosticItems.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.prompt)}</strong><small>{stringValue(item.objectiveTitle)} · {stringValue(item.level)} · {stringValue(item.status)}</small></div><span className="status published">四选一</span></div>) : <p className="empty-state">题库为空，请先新增课程目标和诊断题。</p>}</Card>
  </section>;
}

export default AdminObjectiveLibrary;
