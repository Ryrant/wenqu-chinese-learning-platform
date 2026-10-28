import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState, PageHeader, SectionHeading } from "@/components/workspace/workspace-ui";
import { DialogueGoals, DialogueTranscript } from "@/components/learning/dialogue-transcript";
import { dialogueErrorMessage, dialogueTemplates, type DialogueCatalog, type DialogueContent, type DialogueGoal, type DialogueScenario } from "@/lib/dialogue-types";
import { postJson, requestJson } from "@/lib/workspace/api";
import type { Notify } from "@/lib/platform-types";
import { readingLessons } from "@/lib/reading-lessons";
import { practiceCharacters } from "@/lib/hanzi-practice";
import styles from "./dialogue-scenarios.module.css";

type Draft = { id: string; revision: number; title: string; classId: string; content: DialogueContent };
function fromTemplate(index: number): Draft {
  const template = dialogueTemplates[index];
  return { id: crypto.randomUUID(), revision: 0, title: template.title, classId: "", content: structuredClone(template.content) };
}
function fromScenario(scenario: DialogueScenario): Draft {
  const { roleName, brief, opening, goals, aiEnabled, journey } = scenario;
  return { id: scenario.id, revision: scenario.revision, title: scenario.title, classId: scenario.classId, content: structuredClone({ roleName, brief, opening, goals, aiEnabled, ...(journey ? { journey } : {}) }) };
}

export default function TeacherDialogueScenarios({ notify }: { notify: Notify }) {
  const [catalog, setCatalog] = useState<DialogueCatalog | null>(null);
  const [draft, setDraft] = useState<Draft>(() => fromTemplate(0));
  const [templateIndex, setTemplateIndex] = useState(0);
  const [reviewId, setReviewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<DialogueCatalog>("/api/v1/dialogue?view=teacher", { cache: "no-store", signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted && current === version.current) { setCatalog(data); setError(""); }
    }).catch(() => { if (!controller.signal.aborted && current === version.current) setError("情境与对话记录暂时没有读取成功，请重试。编辑内容仍保留。"); });
    return () => controller.abort();
  }, [reload]);

  const scenarios = (catalog?.scenarios ?? []) as DialogueScenario[];
  const current = scenarios.find((item) => item.id === draft.id);
  const classId = draft.classId || catalog?.classes[0]?.id || "";
  const review = catalog?.sessions.find((item) => item.id === reviewId) ?? catalog?.sessions[0];
  const journeyLesson = readingLessons.find((item) => item.id === draft.content.journey?.lessonId) ?? readingLessons[0];
  const availableCharacters = practiceCharacters.filter((item) => journeyLesson.sentences.join("").includes(item.character));
  function changeContent(patch: Partial<DialogueContent>) { setDraft({ ...draft, content: { ...draft.content, ...patch } }); }
  function changeGoal(index: number, patch: Partial<DialogueGoal>) { changeContent({ goals: draft.content.goals.map((goal, at) => at === index ? { ...goal, ...patch } : goal) }); }
  async function perform(action: "publish" | "archive") {
    version.current++; setBusy(true); setError("");
    try {
      const data = await postJson<DialogueCatalog>("/api/v1/dialogue", action === "archive" ? { action, id: draft.id, revision: draft.revision } : {
        action, ...draft, classId, content: { ...draft.content, goals: draft.content.goals.map((goal) => ({ ...goal, expressions: goal.expressions.map((value) => value.trim()).filter(Boolean) })) },
      });
      version.current++; setCatalog(data);
      const saved = data.scenarios.find((item) => item.id === draft.id) as DialogueScenario | undefined;
      if (saved) setDraft(fromScenario(saved));
      notify(action === "publish" ? "情境已发布" : "情境已归档", action === "publish" ? "班内学生现在可以开始新一轮练习。" : "学生的历史对话仍然保留。");
    } catch (reason) { setError(dialogueErrorMessage(reason)); notify("本次操作尚未确认", dialogueErrorMessage(reason), "error"); setReload((value) => value + 1); }
    finally { setBusy(false); }
  }

  return <section className={styles.page}>
    <PageHeader title="情境对话任务" description="用一段有来有回的交流，让学生练习课堂里的中文。"/>
    <div className={styles.toolbar}><label>选择模板<NativeSelect value={templateIndex} disabled={busy} onChange={(event) => setTemplateIndex(Number(event.target.value))}>{dialogueTemplates.map((item, index) => <option key={item.title} value={index}>{item.title}</option>)}</NativeSelect></label><Button variant="outline" disabled={busy} onClick={() => { setDraft(fromTemplate(templateIndex)); setError(""); }}><Plus/>新建情境</Button><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!catalog ? <p role="status">正在读取班级与情境…</p> : !catalog.classes.length ? <EmptyState title="先创建一个教学班" description="情境按班级发布。请先到班级管理创建班级并加入学生。"/> : <div className={styles.layout}>
      <aside className={styles.library}><h2>已发布与已归档</h2>{scenarios.length ? scenarios.map((item) => <button key={item.id} type="button" disabled={busy} aria-pressed={draft.id === item.id} onClick={() => { setDraft(fromScenario(item)); setError(""); }}><strong>{item.title}</strong><small>{item.className} · 版本 {item.revision} · {item.status === "published" ? "已发布" : "已归档"}</small></button>) : <p>右侧模板可以直接修改后发布。</p>}</aside>
      <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void perform("publish"); }}>
        <SectionHeading title={current ? "编辑情境" : "从模板开始"} description={current ? `班级固定为 ${current.className}；发布新版本后，已开始的轮次继续保留原任务。` : "修改角色和表达要求，再发布到一个班级。"}/>
        <fieldset disabled={busy} className={styles.fields}>
          <div className={styles.pair}><label>情境名称<Input required maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label><label>发布班级<NativeSelect required disabled={draft.revision > 0} value={classId} onChange={(event) => setDraft({ ...draft, classId: event.target.value })}>{catalog.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label></div>
          <label>对话角色<Input required maxLength={60} value={draft.content.roleName} onChange={(event) => changeContent({ roleName: event.target.value })}/></label>
          <label>学生看到的情境说明<Textarea required rows={3} maxLength={1000} value={draft.content.brief} onChange={(event) => changeContent({ brief: event.target.value })}/></label>
          <label>角色开场白<Textarea required rows={2} maxLength={300} value={draft.content.opening} onChange={(event) => changeContent({ opening: event.target.value })}/></label>
          <label className={styles.check}><input type="checkbox" checked={!!draft.content.journey} onChange={(event) => changeContent({ journey: event.target.checked ? { lessonId: journeyLesson.id, characters: availableCharacters.slice(0, 2).map((item) => item.character) } : undefined })}/>同时发布为主题闯关</label>
          {draft.content.journey && <fieldset className={styles.goal}><legend>阅读 → 书写 → 对话</legend><label>关联课文<NativeSelect value={journeyLesson.id} onChange={(event) => { const lesson = readingLessons.find((item) => item.id === event.target.value)!; changeContent({ journey: { lessonId: lesson.id, characters: practiceCharacters.filter((item) => lesson.sentences.join("").includes(item.character)).slice(0, 2).map((item) => item.character) } }); }}>{readingLessons.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</NativeSelect></label><p className={styles.note}>选择课文中出现的 1–4 个字。学生完成词义自测、依次写完这些字后，进入当前情境对话；记录按轮次保留。</p><div className={styles.toolbar}>{availableCharacters.map((item) => <label key={item.character} className={styles.check}><input type="checkbox" checked={draft.content.journey!.characters.includes(item.character)} disabled={!draft.content.journey!.characters.includes(item.character) && draft.content.journey!.characters.length >= 4} onChange={(event) => changeContent({ journey: { lessonId: journeyLesson.id, characters: event.target.checked ? [...draft.content.journey!.characters, item.character] : draft.content.journey!.characters.filter((value) => value !== item.character) } })}/>{item.character} · {item.pinyin}</label>)}</div>{!draft.content.journey.characters.length && <p className={styles.error}>请选择至少一个练习字。</p>}</fieldset>}
          <div className={styles.goalsHeading}><h3>依次练习的表达</h3><span>每轮发言最多推进一项</span></div>
          {draft.content.goals.map((goal, index) => <fieldset key={index} className={styles.goal}><legend>第 {index + 1} 项</legend>
            <label>表达目标<Input required maxLength={80} value={goal.title} onChange={(event) => changeGoal(index, { title: event.target.value })}/></label>
            <label>可匹配的表达，每行一句<Textarea required rows={3} maxLength={647} value={goal.expressions.join("\n")} onChange={(event) => changeGoal(index, { expressions: event.target.value.split("\n") })}/><small>最多 8 句，每句 80 字。忽略标点和空格，包含任一句即可推进；不能判断语义是否正确。</small></label>
            <label>还没匹配时怎样追问<Textarea required rows={2} maxLength={300} value={goal.prompt} onChange={(event) => changeGoal(index, { prompt: event.target.value })}/></label>
            <label>匹配后角色怎样回应<Textarea required rows={2} maxLength={300} value={goal.response} onChange={(event) => changeGoal(index, { response: event.target.value })}/></label>
            <label>学生点提示时看到的帮助<Textarea required rows={2} maxLength={300} value={goal.hint} onChange={(event) => changeGoal(index, { hint: event.target.value })}/></label>
            {draft.content.goals.length > 1 && <Button variant="ghost" type="button" onClick={() => changeContent({ goals: draft.content.goals.filter((_, at) => at !== index) })}>移除第 {index + 1} 项</Button>}
          </fieldset>)}
          <Button variant="outline" type="button" disabled={draft.content.goals.length >= 6} onClick={() => changeContent({ goals: [...draft.content.goals, { title: "", expressions: [""], prompt: "", response: "", hint: "" }] })}><Plus/>添加表达目标</Button>
          <label className={styles.check}><input type="checkbox" checked={draft.content.aiEnabled} onChange={(event) => changeContent({ aiEnabled: event.target.checked })}/>允许 AI 辅助角色回复</label>
          <p className={styles.note}>{catalog.aiConfigured ? "平台已配置 AI 服务。启用后，会将学生发言和最近几轮对话发送到该服务；调用失败时使用教师脚本。" : "平台尚未配置 AI 服务，启用后也会先使用教师脚本。"}推进仍按表达规则判断，不生成能力分数或课程成绩。</p>
          <div className={styles.actions}><Button type="submit">{busy ? "正在保存…" : current ? "发布当前版本" : "发布到班级"}</Button>{current?.status === "published" && <Button type="button" variant="outline" onClick={() => void perform("archive")}>归档情境</Button>}</div>
        </fieldset>
      </form>
    </div>}
    {catalog && <section className={styles.reviews}>
      <SectionHeading title="学生对话回看" description="展示最近 50 轮，结合原始发言与提示记录观察表现；表达匹配不等于掌握语言能力。"/>
      {review ? <><label className={styles.reviewSelect}>选择对话<NativeSelect value={review.id} onChange={(event) => setReviewId(event.target.value)}>{catalog.sessions.map((item) => <option key={item.id} value={item.id}>{item.studentName} · {item.scenario.title} · 已练 {item.step}/{item.scenario.goals.length} 项 · {new Date(item.createdAt + (item.createdAt.includes("T") ? "" : "Z")).toLocaleString("zh-CN")}</option>)}</NativeSelect></label><div className={styles.reviewLayout}><div><h3>{review.studentName} · {review.scenario.title}</h3><p>{review.scenario.brief}</p><p>开始时的任务版本：{review.scenario.revision}</p><DialogueGoals session={review}/></div><DialogueTranscript session={review} review/></div></> : <EmptyState title="还没有学生开始对话" description="学生进入情境闯关后，记录会保存在这里。"/>}
    </section>}
  </section>;
}
