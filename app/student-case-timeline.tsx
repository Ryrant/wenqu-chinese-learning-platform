"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DiagnosticStimulus } from "./diagnostic-evidence";
import { FamilyTaskGuide, FamilyWorkEvidence } from "./family-task-guide";
import { WorkEvidence } from "./learning-sequences";
import { ALTERNATIVE_LABELS, FEEDBACK_RESPONSE_LABELS, FOLLOWUP_OUTCOME_LABELS, INSTRUCTION_LABELS, OPERATION_LABELS, PARTICIPATION_LABELS } from "./lib/family-feedback-types";
import { sequenceTime, TEACHING_DECISION_LABELS } from "./lib/learning-sequence-types";
import { CASE_EVENT_LABELS, type CaseEvent, type CaseView, type StudentCaseData } from "./lib/student-case-types";
import { UnitReportLink } from "./unit-report-links";
import styles from "./student-case-timeline.module.css";

function EventDetail({ event, goalId }: { event: CaseEvent; goalId?: string }) {
  if (event.kind === "choice") return <><p className={styles.copy}>{event.snapshot.prompt}</p>{event.snapshot.mediaId && <DiagnosticStimulus id={event.snapshot.mediaId} kind="audio"/>}<p>原始回答：{event.snapshot.options[event.selected]} · {event.correct ? "正确" : `参考答案：${event.snapshot.options[event.snapshot.correctOption]}`}</p><p>诊断批次：{event.attemptId}。本条仅表示这道题的作答。</p></>;
  if (event.kind === "work" || event.kind === "review") return <><p>{event.className} · {event.stage} · 作品 {event.work.id}</p><WorkEvidence work={event.work} objectiveId={goalId}/>
    {(event.stage === "迁移任务" || event.stage === "延后复测") && <p>新对象或情境：{event.work.contextConfirmed ? "教师已核对" : "尚未确认"}</p>}
    {event.family && <FamilyWorkEvidence value={event.family}/>}{event.confirmedAt && <p>交流确认：{sequenceTime(event.confirmedAt)} · {event.confirmedBy ?? "确认人未留存"} · {event.confirmationRole === "teacher" ? "教师见证" : event.confirmationRole === "guardian" ? "家长确认" : "确认身份未留存"}。交流确认与语言评价分别保留。</p>}
    {!event.family && event.stage === "家庭交流作品" && <FamilyWorkEvidence value={null}/>}{event.sequenceIds.map((id) => <p key={id}><UnitReportLink sequenceId={id}>查看关联单元原始证据 · {id.slice(0, 8)}</UnitReportLink></p>)}</>;
  if (event.kind === "sequence") return <><h4>{event.title}</h4><p>依据作品：{event.baselineId}</p><p className={styles.copy}>练习：{event.practice}</p><p className={styles.copy}>迁移：{event.transfer}</p><p className={styles.copy}>改变的情境：{event.context}</p><UnitReportLink sequenceId={event.sequenceId}>查看单元原始证据</UnitReportLink></>;
  if (event.kind === "decision") return <><p>{event.decision.teacherName} · {TEACHING_DECISION_LABELS[event.decision.kind]}</p><p className={styles.copy}>选择理由：{event.decision.rationale}</p><p className={styles.copy}>仍待观察：{event.decision.remaining}</p><WorkEvidence work={event.decision.reference} objectiveId={goalId}/><UnitReportLink sequenceId={event.sequenceId}>查看判断依据及下一轮任务</UnitReportLink></>;
  if (event.kind === "retest") return <><p>开放时间：{sequenceTime(event.availableAt)}</p><p className={styles.copy}>{event.prompt}</p><p className={styles.copy}>新情境：{event.context}</p><p>固定参照作品：{event.referenceId ?? "未保留"}</p><UnitReportLink sequenceId={event.sequenceId}>查看复测安排及作品</UnitReportLink></>;
  if (event.kind === "feedback") {
    const entry = event.entry;
    return <><h4>{entry.snapshot.title} · {entry.revision ? `v${entry.revision}` : "原版本未保留"}</h4><p>{entry.authorName} · {entry.className ?? "原班级未关联"} · {entry.id}</p>
      <p>{PARTICIPATION_LABELS[entry.participation].join(" / ")}</p><p>说明 / Instructions：{INSTRUCTION_LABELS[entry.instructions].join(" / ")}</p><p>操作帮助 / Platform help：{OPERATION_LABELS[entry.operationHelp].join(" / ")}</p><p>替代交流 / Alternative：{ALTERNATIVE_LABELS[entry.alternative].join(" / ")}</p>
      <p className={styles.copy}>{entry.note || "未补充说明 / No additional note"}</p>{entry.responseId && <p>后续反馈 / Follow-up：{entry.followupOutcome ? FOLLOWUP_OUTCOME_LABELS[entry.followupOutcome].join(" / ") : "结果未保留"} · 对应处理 {entry.responseId}</p>}
      <p className={styles.copy}>原任务说明 / Original instructions：{entry.snapshot.detail}</p><FamilyTaskGuide plan={entry.snapshot.plan}/>{entry.voidedAt && <p className={styles.copy}>本记录已撤销 / Withdrawn：{entry.voidReason}</p>}</>;
  }
  if (event.kind === "support") return <><h4>{FEEDBACK_RESPONSE_LABELS[event.response.kind].join(" / ")}</h4><p>{event.response.authorName} · {event.response.id}</p><p>原反馈 / Original feedback：{event.taskTitle} · v{event.revision} · {event.feedbackId}</p><p className={styles.copy}>{event.originalNote}</p><p className={styles.copy}>{event.response.detail}</p>{event.response.voidedAt && <p className={styles.copy}>本记录已撤销 / Withdrawn：{event.response.voidReason}</p>}</>;
  if (event.kind === "withdrawal") return <><p>{event.sourceKind === "feedback" ? "家庭反馈" : "教师处理"} · {event.sourceId}</p><p className={styles.copy}>{event.reason}</p><p>原记录保留；撤销不修改作品评价。 / The original record is retained.</p></>;
}
function TimelineEvent({ event, goalId }: { event: CaseEvent; goalId?: string }) {
  const [open, setOpen] = useState(false);
  const title = event.kind === "work" || event.kind === "review" ? `${event.stage} · ${event.work.title}` : event.kind === "sequence" ? event.title
    : event.kind === "feedback" ? event.entry.snapshot.title : event.kind === "support" ? event.taskTitle : event.kind === "choice" ? event.snapshot.objectiveTitle : "";
  return <details className={styles.event} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><strong>{CASE_EVENT_LABELS[event.kind]}{title ? ` · ${title}` : ""}</strong><span>{sequenceTime(event.at)} · {event.id.split(":").slice(1).join(":").slice(0, 8)}</span></summary>
    {open && <div className={styles.detail}><EventDetail event={event} goalId={goalId}/></div>}
  </details>;
}
const unknownGoal = "__unknown__";
const initialFilters = { goalId: "", kind: "", visible: 10, newest: false };
export function StudentCaseTimeline({ view, studentId, revision }: { view: CaseView; studentId?: string; revision: string }) {
  const [snapshot, setSnapshot] = useState<{ data: StudentCaseData | null; error: string; loading: boolean; pendingId?: string }>({ data: null, error: "", loading: true });
  const [filters, setFilters] = useState(initialFilters);
  const request = useRef<{ version: number; active: boolean; committedId?: string; controller?: AbortController }>({ version: 0, active: true });
  const load = useCallback(async (selectedId?: string) => {
    if (view !== "teaching" && !studentId) { setSnapshot({ data: null, error: "", loading: false }); return; }
    const tracking = request.current; const version = ++tracking.version; tracking.controller?.abort(); tracking.controller = new AbortController();
    const target = view === "teaching" ? selectedId : studentId;
    setSnapshot((previous) => ({ ...previous, error: "", loading: true, pendingId: target }));
    try {
      const response = await fetch(`/api/v1/student-cases?view=${view}${target ? `&studentId=${encodeURIComponent(target)}` : ""}`, { cache: "no-store", signal: tracking.controller.signal });
      // 网关可能返回 HTML 拒绝页；权限状态不能依赖 JSON 能否解析。
      if ([401, 403, 404].includes(response.status)) throw new Error("案例读取被拒绝。", { cause: response.status });
      const data = await response.json() as StudentCaseData & { error?: string };
      if (!response.ok) throw new Error(data.error === "password_change_required" ? "请先修改初始密码。" : "案例暂时无法读取。", { cause: response.status });
      if (target && data.student?.id !== target) throw new Error("案例与所选学生不一致，请重新读取。", { cause: 404 });
      if (!tracking.active || version !== tracking.version) return;
      if (!tracking.committedId || tracking.committedId !== data.student?.id) setFilters({ ...initialFilters, goalId: data.objectives[0]?.id ?? unknownGoal });
      tracking.committedId = data.student?.id; setSnapshot({ data, error: "", loading: false });
    } catch (error) {
      if (!tracking.active || version !== tracking.version) return;
      const denied = error instanceof Error && [401, 403, 404].includes(Number(error.cause));
      setSnapshot((previous) => ({ data: denied ? null : previous.data, loading: false, pendingId: target, error: denied ? "当前无权读取该案例，请核对身份或重新选择授权学生。 / Review your access to this learner." : "读取失败，已保留上次案例与筛选，请重试。 / Could not refresh; your previous view is retained." }));
    }
  }, [view, studentId]);
  useEffect(() => { const tracking = request.current; tracking.active = true; void load(tracking.committedId); return () => { tracking.active = false; tracking.version++; tracking.controller?.abort(); }; }, [load, revision]);
  const data = snapshot.data;
  const goalId = filters.goalId || data?.objectives[0]?.id || unknownGoal;
  const inGoal = (goals: Array<{ id: string }>) => goalId === unknownGoal ? !goals.length : goals.some((goal) => goal.id === goalId);
  const scoped = data?.events.filter((event) => inGoal(event.goals)) ?? [];
  const entries = scoped.filter((event) => !filters.kind || event.kind === filters.kind); const ordered = filters.newest ? entries.slice().reverse() : entries;
  const works = scoped.filter((event) => event.kind === "work");
  const tasks = data?.tasks.filter((task) => inGoal(task.goal ? [task.goal] : [])) ?? [];
  const goal = data?.objectives.find((item) => item.id === goalId);
  return <section className={`panel ${styles.section}`} aria-label="学生案例时间线" aria-busy={snapshot.loading}>
    <div className={styles.heading}><h3>学生案例时间线 / Learner case timeline</h3><button type="button" className="soft-button" disabled={snapshot.loading} onClick={() => void load(request.current.committedId)}>刷新案例</button></div>
    <p>按学生与目标串起诊断、支持、作品、教师判断及迁移复测。这里回看原记录，不自动判定能力提升。 / Trace the evidence for one learner and goal.</p>
    {snapshot.loading && <p role="status">{data ? `正在读取${snapshot.pendingId && snapshot.pendingId !== data.student?.id ? "另一个学生；当前仍显示" : "最新记录；保留"} ${data.student?.displayName ?? "原"} 的上次案例与筛选。` : "正在读取授权学生与完整案例…"}</p>}
    {snapshot.error && <div role="alert"><p>{snapshot.error}</p><button type="button" className="soft-button" onClick={() => void load(snapshot.pendingId)}>重试读取案例</button>{view === "teaching" && <button type="button" className="soft-button" onClick={() => void load()}>重新选择授权学生</button>}</div>}
    {!data && !snapshot.loading && !snapshot.error && <p className="empty-state">请先选择孩子。 / Please select a learner.</p>}
    {data && <>
      {view === "teaching" && <label className={styles.selector}>案例学生<select value={data.student?.id ?? ""} onChange={(event) => void load(event.target.value)}><option value="" disabled>请选择授权学生</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.id.slice(0, 8)}</option>)}</select></label>}
      {!data.student ? <p className="empty-state">当前授权范围没有学生案例。</p> : <>
        <h4>{data.student.displayName} · {goalId === unknownGoal ? "原目标未留存" : goal?.title ?? "先前目标当前无记录"}</h4>
        <div className={styles.filters}><label>案例学习目标 / Learning goal<select value={goalId} onChange={(event) => setFilters({ ...filters, goalId: event.target.value, visible: 10 })}>{filters.goalId && filters.goalId !== unknownGoal && !goal && <option value={goalId}>先前目标当前无记录</option>}{data.objectives.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.id.slice(0, 8)}</option>)}<option value={unknownGoal}>原目标未留存 / Original goal unavailable</option></select></label>
          <label>记录类型 / Record type<select value={filters.kind} onChange={(event) => setFilters({ ...filters, kind: event.target.value, visible: 10 })}><option value="">全部记录 / All</option>{Object.entries(CASE_EVENT_LABELS).filter(([kind]) => view !== "student" || !["feedback", "support", "withdrawal"].includes(kind)).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <label>时间顺序 / Order<select value={filters.newest ? "newest" : "oldest"} onChange={(event) => setFilters({ ...filters, newest: event.target.value === "newest", visible: 10 })}><option value="oldest">从早到晚 / Oldest first</option><option value="newest">从晚到早 / Newest first</option></select></label></div>
        <p>本目标 {works.length} 份作品，其中 {works.filter((event) => event.kind === "work" && event.work.objectives.some((item) => item.id === goalId)).length} 份有目标评价；{scoped.length} 条事件，类型筛选显示 {entries.length} 条。作品与评价分别列出，事件数不等于作品数。</p>
        <p className={styles.meta}>读取于 {sequenceTime(data.generatedAt)}。作品卡保留本次读取时的评价和确认状态；原目标或量规缺失时不补造。家庭反馈和处理仅在家长与教师授权范围展示。</p>
        {data.legacyChoiceCount > 0 && <p>另有 {data.legacyChoiceCount} 条旧诊断答案缺少题面快照，无法归入具体目标。</p>}
        <details className={styles.current}><summary>当前支持与家庭任务 / Current tasks（{tasks.length}）</summary><p>以下为读取时的当前内容，未完整保存的历史修改不作为时间线事件。</p>{tasks.map((task) => <article key={task.id}><h4>{task.title}</h4><p>{task.kind === "family" ? `家庭任务 · ${task.revision ? `v${task.revision}` : "版本未留存"}` : "教师支持 · 原班级未留存"} · {({ pending: "待完成", completed: "已完成", archived: "已归档" } as Record<string, string>)[task.status] ?? task.status} · {task.authorName}</p><p className={styles.copy}>{task.detail}</p><p className={styles.meta}>最近保存：{sequenceTime(task.updatedAt)} · {task.id}</p></article>)}{!tasks.length && <p>本目标当前没有可读的支持或家庭任务。</p>}</details>
        {!scoped.length ? <p className="empty-state">本目标当前没有可追溯事件；缺少证据不表示能力低。</p> : !entries.length ? <p className="empty-state">当前类型没有匹配记录，可切换“全部记录”。</p> : <div className={styles.timeline} key={goalId}>{ordered.slice(0, filters.visible).map((event) => <TimelineEvent key={event.id} event={event} goalId={goalId === unknownGoal ? undefined : goalId}/>)}</div>}
        {entries.length > filters.visible && <button type="button" className="soft-button" onClick={() => setFilters({ ...filters, visible: filters.visible + 10 })}>查看更多事件（还有 {entries.length - filters.visible} 条）</button>}
        <p className={styles.meta}>当前可读范围{works.some((event) => event.kind === "work" && event.stage === "迁移任务") ? "已有迁移作品" : "尚无迁移作品"}、{works.some((event) => event.kind === "work" && event.stage === "延后复测") ? "已有复测作品" : "尚无复测作品"}；独立程度、提示次数、新情境与目标表现需结合原始评价判断。</p>
      </>}
    </>}
  </section>;
}
