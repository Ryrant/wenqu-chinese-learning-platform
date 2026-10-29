import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/workspace/workspace-ui";
import { practiceCharacters } from "@/lib/hanzi-practice";
import { practiceTaskLabels, type PracticeTasks } from "@/lib/practice-task-types";
import { practiceSavedEvent, requestJson } from "@/lib/workspace/api";
import { usePracticeSelection } from "@/lib/workspace/use-practice-selection";
import { sequenceTime } from "@/lib/learning-sequence-types";
import type { Notify } from "@/lib/platform-types";
import styles from "./practice-tasks.module.css";

const ReadingWorkshop = lazy(() => import("./reading-workshop"));
const HanziWritingLab = lazy(() => import("./hanzi-writing-lab"));
const DictationLab = lazy(() => import("./dictation-lab"));
const JourneyMap = lazy(() => import("./journey-map"));
export default function StudentPracticeTasks({ notify }: { notify: Notify }) {
  const [selected, setSelected] = usePracticeSelection("/student/practice", "practiceTaskId");
  const [data, setData] = useState<PracticeTasks | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(true);
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener(practiceSavedEvent, refresh);
    return () => window.removeEventListener(practiceSavedEvent, refresh);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current; setReading(true);
    void requestJson<PracticeTasks>("/api/v1/practice/tasks", { cache: "no-store", signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted && current === version.current) { setData(next); setReading(false); setError(""); }
    }).catch(() => { if (!controller.signal.aborted && current === version.current) { setError("安排暂时未能读取，已加载的内容和输入仍保留，请重试。"); setReading(false); } });
    return () => controller.abort();
  }, [reload]);
  const task = data?.tasks.find((item) => item.id === selected);
  const snapshot = task?.snapshot;
  return <section className={styles.page}>
    <PageHeader title="教师练习安排" description="按老师固定的内容练习，保存记录后自动更新完成状态。" actions={<Button variant="outline" disabled={reading} onClick={refresh}>重新读取安排</Button>}/>
    {error && <p role="alert">{error}</p>}
    {!data ? <p role="status">{reading ? "正在读取练习安排…" : "练习安排尚未载入，请重新读取。"}</p> : <div className={styles.layout}>
      <aside className={styles.list} aria-label="本人练习安排">{data.tasks.length ? data.tasks.map((item) => <Button key={item.id} variant={selected === item.id ? "secondary" : "ghost"} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><strong>{item.title}</strong><span>{practiceTaskLabels[item.snapshot.kind]} · {item.className}</span><small>{item.archivedAt ? "已归档" : item.status === "completed" ? "已完成" : !item.available ? "已暂停" : "待完成"}{item.dueAt ? " · 截止 " + sequenceTime(item.dueAt) : ""}</small></Button>) : <EmptyState title="老师尚未布置练习" description="自主练习仍可从对应页面开始。"/>}</aside>
      <div className={styles.content}>{selected && !task ? <EmptyState title="未找到指定安排" description="请从本人安排列表重新选择。"/> : !task || !snapshot ? <EmptyState title="选择一项安排" description="查看练习要求，继续已保存的进度。"/> : <>
        <section className={styles.instructions}><h2>{task.title}</h2><p>{task.detail}</p><p>{task.className} · {practiceTaskLabels[snapshot.kind]} · {task.status === "completed" ? "已根据保存记录自动完成" : task.available ? "待完成" : "暂停推进"}</p>{task.dueAt && <p>截止：{sequenceTime(task.dueAt)}</p>}
          {snapshot.lesson && <p>固定课文：《{snapshot.lesson.title}》{snapshot.lesson.source ? " · 版本 " + snapshot.lesson.source.revision : ""}</p>}
          {snapshot.characters && <p>指定字：{snapshot.characters.join("、")}{snapshot.kind === "writing" ? " · 已保存 " + task.writtenCharacters.length + "/" + snapshot.characters.length + " 字" : ""}</p>}
          <Link to="/student/portfolio">到成长档案回看原始记录</Link>
        </section>
        {!task.available ? <section><p role="status">安排或来源已归档，或学籍已变化，停止推进；原有记录仍保留。</p>{snapshot.lesson?.sentences.map((sentence) => <p key={sentence}>{sentence}</p>)}</section> : <div key={task.id}>
          {snapshot.kind === "reading" && <ReadingWorkshop notify={notify} fixedLesson={snapshot.lesson} practiceTaskId={task.id} onSaved={refresh} embedded/>}
          {snapshot.kind === "writing" && <HanziWritingLab characters={practiceCharacters.filter((item) => snapshot.characters?.includes(item.character))} practiceTaskId={task.id} onSaved={refresh} embedded/>}
          {snapshot.kind === "dictation" && <DictationLab assignedTask={task}/>}
          {snapshot.kind === "journey" && <JourneyMap notify={notify} assignedTask={task}/>}
        </div>}
      </>}</div>
    </div>}
  </section>;
}
