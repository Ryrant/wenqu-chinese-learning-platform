import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { ArrowRight, Check, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState, PageHeader } from "@/components/workspace/workspace-ui";
import { RetainedFeature } from "@/components/workspace/retained-feature";
import { practiceCharacters } from "@/lib/hanzi-practice";
import { practiceError, type JourneyCatalog, type ReadingResult, type WritingResult } from "@/lib/practice-types";
import { postJson, requestJson } from "@/lib/workspace/api";
import type { PracticeTask } from "@/lib/practice-task-types";
import type { Notify } from "@/lib/platform-types";
import styles from "./journey-map.module.css";

const ReadingWorkshop = lazy(() => import("./reading-workshop"));
const HanziWritingLab = lazy(() => import("./hanzi-writing-lab"));
const DialogueChallenge = lazy(() => import("./dialogue-challenge"));
const stages = ["读懂课文", "写好汉字", "情境交流"];

export default function JourneyMap({ notify, assignedTask }: { notify: Notify; assignedTask?: PracticeTask }) {
  const [query, setQuery] = useSearchParams();
  const { pathname } = useLocation();
  const navigation = useNavigationType();
  const incomingRun = query.get("run") ?? ""; const incomingScenario = query.get("scenario") ?? "";
  const [selection, setSelection] = useState(() => ({ run: assignedTask?.activities.find((item) => item.kind === "journey")?.id ?? (pathname === "/student/journeys" ? incomingRun : ""), scenario: assignedTask?.snapshot.scenario?.id ?? (pathname === "/student/journeys" ? incomingScenario : "") }));
  const runId = selection.run;
  const [catalog, setCatalog] = useState<JourneyCatalog | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [viewStep, setViewStep] = useState<number | null>(null);
  const version = useRef(0);
  const starts = useRef(new Map<string, string>());
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const advance = useCallback(() => { setViewStep(null); setReload((value) => value + 1); }, []);
  useEffect(() => {
    if (assignedTask || pathname !== "/student/journeys") return;
    if (!incomingRun && !incomingScenario) {
      if (navigation === "POP") { setSelection({ run: "", scenario: "" }); return; }
      if (selection.run) setQuery({ run: selection.run }, { replace: true });
      else if (selection.scenario) setQuery({ scenario: selection.scenario }, { replace: true });
      return;
    }
    setSelection((current) => current.run === incomingRun && current.scenario === incomingScenario ? current : { run: incomingRun, scenario: incomingScenario });
  }, [assignedTask, pathname, navigation, incomingRun, incomingScenario, selection.run, selection.scenario, setQuery]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<JourneyCatalog>(`/api/v1/journeys${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`, { cache: "no-store", signal: controller.signal }).then((data) => {
      if (controller.signal.aborted || current !== version.current) return;
      setCatalog(data); setReadError("");
      for (const [scenario, id] of starts.current) if (data.runs.some((item) => item.id === id)) starts.current.delete(scenario);
    }).catch(() => { if (!controller.signal.aborted && current === version.current) setReadError("关卡进度暂时没有读取成功，请重新读取。已经保存的记录仍会保留。"); });
    return () => controller.abort();
  }, [reload, runId]);
  const requestedRun = catalog?.runs.find((item) => item.id === runId);
  const choices = assignedTask ? [{ id: assignedTask.snapshot.scenario!.id, title: assignedTask.snapshot.scenario!.title, className: assignedTask.className }] : [...new Map([...(catalog?.journeys ?? []), ...(catalog?.runs.map((item) => ({ id: item.scenarioId, title: item.title, className: item.className })) ?? [])].map((item) => [item.id, item])).values()];
  const scenarioId = assignedTask?.snapshot.scenario?.id ?? requestedRun?.scenarioId ?? choices.find((item) => item.id === selection.scenario)?.id ?? choices[0]?.id;
  const rounds = (catalog?.runs.filter((item) => item.scenarioId === scenarioId && (!assignedTask || item.id === runId || assignedTask.activities.some((activity) => activity.id === item.id && activity.kind === "journey"))) ?? []).toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  const run = requestedRun ?? rounds[0];
  const available = assignedTask ? assignedTask.available : catalog?.journeys.some((item) => item.id === scenarioId) ?? false;
  const selectedStep = viewStep === null || !run ? run?.stage ?? 0 : Math.min(viewStep, run.stage);
  const reading = run?.records.find((item) => item.kind === "reading");
  async function start() {
    if (!scenarioId) return;
    const id = starts.current.get(scenarioId) ?? crypto.randomUUID(); starts.current.set(scenarioId, id);
    const origin = window.location.pathname + window.location.search;
    const operation = ++version.current; setBusy(true); setError("");
    try {
      const data = await postJson<JourneyCatalog>("/api/v1/journeys", { action: "start", id, scenarioId, practiceTaskId: assignedTask?.id });
      if (operation !== version.current || window.location.pathname + window.location.search !== origin) { refresh(); return; }
      version.current++; setCatalog(data); setSelection({ run: id, scenario: "" }); if (window.location.pathname === "/student/journeys") setQuery({ run: id }); setViewStep(null); starts.current.delete(scenarioId);
    } catch (reason) { if (operation === version.current && window.location.pathname + window.location.search === origin) setError(practiceError(reason)); refresh(); }
    finally { setBusy(false); }
  }
  return <section className={styles.page}>
    <PageHeader title="主题闯关地图" description="读懂一篇课文，写好相关汉字，再把中文用在对话里。"/>
    <div className={styles.toolbar}><label>学习主题<NativeSelect value={scenarioId ?? ""} disabled={busy || !!assignedTask || !choices.length} onChange={(event) => { setSelection({ run: "", scenario: event.target.value }); setQuery({ scenario: event.target.value }); setViewStep(null); }}>{!choices.length && <option value="">等待老师发布</option>}{choices.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.className}{catalog?.journeys.some((source) => source.id === item.id) ? "" : "（历史）"}</option>)}</NativeSelect></label><div><Button variant="outline" disabled={busy} onClick={refresh}><RefreshCw/>重新读取</Button><Button disabled={busy || !available} onClick={() => void start()}>{busy ? "正在准备…" : run ? "开始新一轮" : "开始主题闯关"}<ArrowRight/></Button></div></div>
    {(error || readError) && <p className={styles.error} role="alert">{error || readError}</p>}
    {!catalog ? readError ? <EmptyState title="主题进度暂未载入" description="请点击重新读取，恢复已保存的主题与关卡。"/> : <p role="status">正在读取主题与关卡…</p> : !choices.length ? <EmptyState title="等待老师发布主题" description="老师关联课文、练习字和情境对话后，就可以在这里开始完整的三关练习。"/> : !run ? <div className={styles.intro}><h2>一条主题，三种练习</h2><p>先阅读和自测，再写一写相关汉字，最后进入情境交流。每一关都会保存记录，刷新后也能继续。</p><Button disabled={busy || !available} onClick={() => void start()}>开始这一轮</Button></div> : <>
      <div className={styles.heading}><div><h2>{run.title}</h2><p>《{run.lesson.title}》 · 练习字：{run.characters.join("、")} · 已完成 {run.stage}/3 关</p></div><label>回看轮次<NativeSelect value={run.id} disabled={busy} onChange={(event) => { setSelection({ run: event.target.value, scenario: "" }); setQuery({ run: event.target.value }); setViewStep(null); }}>{rounds.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt.includes("T") ? item.createdAt : `${item.createdAt.replace(" ", "T")}Z`).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {item.stage === 3 ? "已完成" : `已完成 ${item.stage}/3 关`}</option>)}</NativeSelect></label></div>
      <ol className={styles.map} aria-label="主题关卡进度">{stages.map((title, index) => <li key={title} data-complete={run.stage > index} data-current={selectedStep === index}><button disabled={index > run.stage || !run.available} aria-current={selectedStep === index ? "step" : undefined} onClick={() => setViewStep(index)}><span>{run.stage > index ? <Check/> : index > run.stage ? <LockKeyhole/> : index + 1}</span><div><strong>{title}</strong><small>{run.stage > index ? "已完成，可回看" : index === run.stage ? "当前关卡" : "完成前一关后解锁"}</small></div></button></li>)}</ol>
      {!run.available && <p className={styles.error}>任务已归档或班级权限有变化，已有记录仍可回看。</p>}
      {(run.stage === 3 || !run.available) && <section className={styles.summary} aria-label="本轮学习小结"><h2>{run.stage === 3 ? "三关完成，留下这次进步" : "已保存的学习记录"}</h2><dl><div><dt>阅读自测</dt><dd>{reading ? `最近答对 ${(reading.result as ReadingResult).correct}/${(reading.result as ReadingResult).total} 题` : "尚未完成"}</dd></div><div><dt>汉字练习</dt><dd>{run.characters.map((character) => { const item = run.records.find((item) => item.kind === "writing" && item.referenceId === character); return `${character}：${item ? `重试 ${(item.result as WritingResult).mistakes} 次` : "尚未完成"}`; }).join("；")}</dd></div><div><dt>情境交流</dt><dd>已练 {run.dialogue.steps}/{run.dialogue.total} 项表达，主动提示 {run.dialogue.hints} 次</dd></div></dl><p>这是练习过程的记录，语言表现由老师结合原始作品判断，不自动计入课程成绩。</p></section>}
      {run.available && <div className={styles.activity}>
        <RetainedFeature active={selectedStep === 0}><section aria-label="第 1 关：读懂课文"><ReadingWorkshop key={run.id} notify={notify} fixedLesson={run.lesson} journeyRunId={run.id} onSaved={advance} embedded/></section></RetainedFeature>
        <RetainedFeature active={selectedStep === 1}><section aria-label="第 2 关：写好汉字"><HanziWritingLab key={run.id} characters={practiceCharacters.filter((item) => run.characters.includes(item.character))} journeyRunId={run.id} onSaved={advance} embedded/></section></RetainedFeature>
        <RetainedFeature active={selectedStep === 2}><section aria-label="第 3 关：情境交流"><DialogueChallenge notify={notify} fixedSessionId={run.dialogueSessionId} onProgress={advance} embedded/></section></RetainedFeature>
      </div>}
      {(run.stage === 3 || !run.available) && <details><summary>回看本轮对话</summary><DialogueChallenge notify={notify} fixedSessionId={run.dialogueSessionId} embedded/></details>}
    </>}
  </section>;
}
