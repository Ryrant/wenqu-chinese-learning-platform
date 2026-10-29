import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState, PageHeader, SectionHeading } from "@/components/workspace/workspace-ui";
import { PracticeRecordDetail } from "@/components/learning/practice-record-detail";
import { readingLessons } from "@/lib/reading-lessons";
import type { ReadingCatalog } from "@/lib/reading-content-service";
import type { DialogueCatalog } from "@/lib/dialogue-types";
import type { PracticeDetail } from "@/lib/practice-types";
import { practiceTaskError, practiceTaskLabels, type ClassroomPractice, type PracticeTaskKind, type PracticeTasks } from "@/lib/practice-task-types";
import { postJson, requestJson } from "@/lib/workspace/api";
import { sequenceTime } from "@/lib/learning-sequence-types";
import type { Notify } from "@/lib/platform-types";
import styles from "./practice-dashboard.module.css";

type Filters = { classId: string; studentId: string; period: 7 | 30 };
const params = (value: Filters) => new URLSearchParams({ classId: value.classId, studentId: value.studentId, period: String(value.period) });
export default function TeacherPracticeDashboard({ notify }: { notify: Notify }) {
  const [filters, setFilters] = useState<Filters>({ classId: "", studentId: "", period: 30 });
  const [data, setData] = useState<ClassroomPractice | null>(null);
  const [tasks, setTasks] = useState<PracticeTasks | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string[]>([]);
  const [committedPrevious, setCommittedPrevious] = useState<string[]>([]);
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const [sources, setSources] = useState<{ reading: ReadingCatalog; dialogue: DialogueCatalog } | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [kind, setKind] = useState<PracticeTaskKind>("reading");
  const [studentId, setStudentId] = useState("");
  const [lessonId, setLessonId] = useState(readingLessons[0].id);
  const [scenarioId, setScenarioId] = useState("");
  const [characters, setCharacters] = useState("人、天");
  const [dictationKind, setDictationKind] = useState<"words" | "sentences">("words");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef(new Map<string, string>());
  const [expanded, setExpanded] = useState<{ kind: string; id: string } | null>(null);
  const [record, setRecord] = useState<PracticeDetail | null>(null);
  const [recordError, setRecordError] = useState("");
  const [recordLoading, setRecordLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current; setReading(true);
    const query = params(filters); if (cursor) query.set("cursor", cursor);
    const taskQuery = new URLSearchParams({ view: "teaching", classId: filters.classId, studentId: filters.studentId });
    void Promise.all([
      requestJson<ClassroomPractice>("/api/v1/practice/classroom?" + query, { cache: "no-store", signal: controller.signal }),
      requestJson<PracticeTasks>("/api/v1/practice/tasks?" + taskQuery, { cache: "no-store", signal: controller.signal }),
    ]).then(([next, nextTasks]) => {
      if (controller.signal.aborted || current !== version.current) return;
      setData(next); setTasks(nextTasks); setCommittedPrevious(previous); setReadError(""); setReading(false);
    }).catch(() => { if (!controller.signal.aborted && current === version.current) { setReadError("班级练习暂时未能读取，仍展示上次读取范围的内容，请重试。"); setReading(false); } });
    return () => controller.abort();
  }, [filters, cursor, previous, reload]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      requestJson<ReadingCatalog>("/api/v1/reading/lessons?view=teacher", { signal: controller.signal, cache: "no-store" }),
      requestJson<DialogueCatalog>("/api/v1/dialogue?view=teacher", { signal: controller.signal, cache: "no-store" }),
    ]).then(([reading, dialogue]) => { if (!controller.signal.aborted) { setSources({ reading, dialogue }); setSourceError(""); } }).catch(() => { if (!controller.signal.aborted) setSourceError("发布内容暂未读取成功，请重新读取后再发布；填写内容仍保留。"); });
    return () => controller.abort();
  }, [reload]);
  const expandedKind = expanded?.kind; const expandedId = expanded?.id;
  useEffect(() => {
    if (!expandedKind || !expandedId || !data) return;
    const controller = new AbortController(); setRecordLoading(true); setRecordError("");
    const query = params(data); query.set("recordKind", expandedKind); query.set("recordId", expandedId); query.set("cursor", data.currentCursor);
    void requestJson<PracticeDetail>("/api/v1/practice/classroom?" + query, { cache: "no-store", signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) { setRecord(next); setRecordLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setRecordError("这条原始记录暂时未能读取，或已不在当前任教范围，请重新读取。"); setRecordLoading(false); } });
    return () => controller.abort();
  }, [expandedKind, expandedId, data, reload]);
  function changeFilters(next: Filters) {
    version.current++; setFilters(next); setCursor(null); setPrevious([]); setExpanded(null); setReload((value) => value + 1);
  }
  function refresh() { version.current++; setCursor(null); setPrevious([]); setReload((value) => value + 1); }
  const classId = filters.classId || data?.classes[0]?.id || "";
  const students = data?.students.filter((item) => item.classId === classId) ?? [];
  const selectedStudent = students.find((item) => item.id === studentId);
  const lessons = [...readingLessons, ...(sources?.reading.lessons.filter((item) => item.source?.classId === classId && item.source.status === "published") ?? [])];
  const lesson = lessons.find((item) => item.id === lessonId);
  const scenarios = sources?.dialogue.scenarios.filter((item) => item.classId === classId && item.status === "published" && item.journey) ?? [];
  const scenario = scenarios.find((item) => item.id === scenarioId);
  const scopePending = !data || data.classId !== filters.classId || data.studentId !== filters.studentId || data.period !== filters.period;
  async function publish(event: React.FormEvent) {
    event.preventDefault(); if (!selectedStudent || !classId) return;
    const target = { action: "publish", classId, studentId, kind, title, detail, dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      ...(kind === "writing" ? { characters: [...characters.replace(/[、，,\s]/g, "")] } : kind === "journey" ? { scenarioId, scenarioRevision: scenario?.revision } : { lessonId, sourceRevision: lesson?.source?.revision ?? 0, ...(kind === "dictation" ? { dictationKind } : {}) }) };
    const key = JSON.stringify(target); const id = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, id);
    setBusy(true); setError("");
    try {
      await postJson<PracticeTasks>("/api/v1/practice/tasks", { ...target, id });
      requests.current.delete(key); notify("练习安排已发布", "内容已固定，学生实际保存练习后自动更新完成状态。"); refresh();
    } catch (reason) { setError(practiceTaskError(reason)); }
    finally { setBusy(false); }
  }
  async function archive(id: string) {
    setBusy(true); setError("");
    try { await postJson<PracticeTasks>("/api/v1/practice/tasks", { action: "archive", id }); notify("安排已归档", "停止推进，原始练习记录仍保留。"); refresh(); }
    catch (reason) { setError(practiceTaskError(reason)); }
    finally { setBusy(false); }
  }
  return <section className={styles.page}>
    <PageHeader title="班级练习" description="查看本班关联练习，布置具体内容，回看实际作答。" actions={<Button variant="outline" disabled={reading || busy} onClick={refresh}>重新读取看板</Button>}/>
    <div className={styles.filters}><label>班级<NativeSelect value={filters.classId} disabled={busy} onChange={(event) => { setStudentId(""); changeFilters({ ...filters, classId: event.target.value, studentId: "" }); }}><option value="">全部任教班级</option>{data?.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label>学生<NativeSelect value={filters.studentId} disabled={busy || !data} onChange={(event) => changeFilters({ ...filters, studentId: event.target.value })}><option value="">全部在籍学生</option>{[...new Map(data?.students.map((item) => [item.id, item]) ?? []).values()].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label>时间范围<NativeSelect value={filters.period} disabled={busy} onChange={(event) => changeFilters({ ...filters, period: Number(event.target.value) as 7 | 30 })}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option></NativeSelect></label>
    </div>
    {readError && <p role="alert">{readError}</p>}
    {!data ? <p role="status">{reading ? "正在读取班级练习…" : "班级练习尚未载入，请重新读取。"}</p> : <>
      <section className={styles.panel} aria-label="班级练习汇总"><SectionHeading title="当前范围的练习" description={(data.classes.find((item) => item.id === data.classId)?.name ?? "全部任教班级") + " · " + sequenceTime(data.rangeStart) + " 至 " + sequenceTime(data.asOf)}/>
        <p>安排 {data.tasks.total} 项 · 自动完成 {data.tasks.completed} 项 · 暂停或归档 {data.tasks.paused} 项</p>
        <p className={styles.note}>练习汇总与常见错词仅包含当前有效分析授权的 {data.consentedStudents}/{data.studentCount} 名学生。主题与其子练习分别展示，不相加为成绩。</p>
        <dl className={styles.metrics}>{data.metrics.map((item) => <div key={item.kind}><dt>{practiceTaskLabels[item.kind as PracticeTaskKind]}</dt><dd>{item.rounds} 轮 · 完成 {item.completed} 轮{item.total !== null ? " · " + (item.kind === "dictation" ? "与参考一致 " : "自测答对 ") + item.correct + "/" + item.total : ""}</dd></div>)}</dl>
        {!data.consentedStudents && <p>当前没有有效学习分析授权；安排状态和本班原始记录仍可查看。</p>}
      </section>
      <section className={styles.panel}><SectionHeading title="发布具体练习"/><form onSubmit={publish} className={styles.form}><fieldset disabled={busy || reading || scopePending || !sources}><div className={styles.filters}>
        <label>安排班级<NativeSelect value={classId} onChange={(event) => { setStudentId(""); changeFilters({ ...filters, classId: event.target.value, studentId: "" }); }}>{data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
        <label>指定学生<NativeSelect required value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">请选择学生</option>{students.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
        <label>练习类型<NativeSelect value={kind} onChange={(event) => setKind(event.target.value as PracticeTaskKind)}>{Object.entries(practiceTaskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
      </div>
        {kind === "writing" ? <label>指定汉字（最多 12 字）<Input required value={characters} onChange={(event) => setCharacters(event.target.value)} placeholder="例如：人、天"/></label> : kind === "journey" ? <label>已发布的本班主题<NativeSelect required value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}><option value="">请选择三关主题</option>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.title} · 版本 {item.revision}</option>)}</NativeSelect></label> : <label>指定课文<NativeSelect required value={lessonId} onChange={(event) => setLessonId(event.target.value)}>{!lesson && <option value="" disabled>请重新选择本班或平台课文</option>}{lessons.map((item) => <option key={item.id} value={item.id}>{item.title}{item.source ? " · 版本 " + item.source.revision : " · 平台课文"}</option>)}</NativeSelect></label>}
        {kind === "dictation" && <label>听写项目<NativeSelect value={dictationKind} onChange={(event) => setDictationKind(event.target.value as typeof dictationKind)}><option value="words">课文重点词</option><option value="sentences">课文短句</option></NativeSelect><small>发布时固定前 5 个不重复项目；不足 5 项时使用全部项目。提前结束仍待完成。</small></label>}
        <label>安排标题<Input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
        <label>练习要求<Textarea required maxLength={2000} value={detail} onChange={(event) => setDetail(event.target.value)}/></label>
        <label>截止时间（可不填）<Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
        <Button type="submit" disabled={!selectedStudent || (kind === "journey" ? !scenario : kind !== "writing" && !lesson)}>{busy ? "正在保存…" : "固定内容并发布"}</Button>
      </fieldset></form>{sourceError && <p role="alert">{sourceError}</p>}{error && <p role="alert">{error}</p>}</section>
      <section className={styles.panel}><SectionHeading title="练习安排"/>{tasks?.tasks.length ? tasks.tasks.map((item) => <article className={styles.row} key={item.id}><div><h3>{item.title}</h3><p>{item.studentName} · {item.className} · {practiceTaskLabels[item.snapshot.kind]} · {item.archivedAt ? "已归档" : item.status === "completed" ? "已自动完成" : item.available ? "待完成" : "已暂停"}</p><p>{item.detail}</p>{item.snapshot.lesson && <small>固定《{item.snapshot.lesson.title}》{item.snapshot.lesson.source ? " · 版本 " + item.snapshot.lesson.source.revision : ""}</small>}{item.snapshot.characters && <small>指定字：{item.snapshot.characters.join("、")}</small>}{item.dueAt && <small>截止 {sequenceTime(item.dueAt)}</small>}</div>{!item.archivedAt && <Button variant="outline" disabled={busy || reading || scopePending} onClick={() => void archive(item.id)}>归档安排</Button>}</article>) : <EmptyState title="当前范围没有练习安排"/>}</section>
      <section className={styles.panel}><SectionHeading title="常见错词" description="按当前完整时间范围汇总，点击可核对一条对应原始记录。"/>{data.wrongWords.length ? <ul className={styles.wrongWords}>{data.wrongWords.map((item) => <li key={item.kind + item.word}><Button variant="outline" onClick={() => setExpanded({ kind: item.kind, id: item.recordId })}>{item.word} · {item.count} 次</Button></li>)}</ul> : <p>当前没有可汇总的错词记录。</p>}</section>
      <section className={styles.panel}><SectionHeading title="本班原始练习记录" description="包含本班主题、班级课文和明确布置的练习。独立书写和个人生词本保留在本人范围。"/>
        {expanded && <section className={styles.detail} aria-label="班级原始记录"><Button variant="ghost" onClick={() => setExpanded(null)}>收起原始记录</Button>{recordLoading && <p role="status">正在读取原始记录…</p>}{recordError && <p role="alert">{recordError}</p>}{record?.entry.id === expanded.id && record.entry.kind === expanded.kind && <PracticeRecordDetail detail={record} subject="学生"/>}</section>}
        {data.records.length ? data.records.map((item) => <article className={styles.row} key={item.kind + item.id}><div><h3>{item.title}</h3><p>{item.studentName} · {item.className} · {sequenceTime(item.createdAt)}</p><p>{item.summary} · {item.status === "finished" ? "已完成" : item.status === "ended" ? "提前结束" : "进行中"}</p></div><Button variant="outline" onClick={() => setExpanded({ kind: item.kind, id: item.id })}>查看原始记录</Button></article>) : <EmptyState title="当前范围没有关联记录"/>}
        <div className={styles.pagination}><Button variant="outline" disabled={reading || scopePending || !committedPrevious.length} onClick={() => { version.current++; setCursor(committedPrevious.at(-1)!); setPrevious(committedPrevious.slice(0, -1)); setExpanded(null); setReload((value) => value + 1); }}>上一页</Button><span>第 {committedPrevious.length + 1} 页</span><Button variant="outline" disabled={reading || scopePending || !data.nextCursor} onClick={() => { version.current++; setCursor(data.nextCursor); setPrevious([...committedPrevious, data.currentCursor]); setExpanded(null); setReload((value) => value + 1); }}>下一页</Button></div>
      </section>
    </>}
  </section>;
}
