"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { SectionHeading, StatCard, EmptyState } from "./components/workspace-ui";

import { useCallback, useEffect, useRef, useState } from "react";
import { ALTERNATIVE_LABELS, FEEDBACK_RESPONSE_LABELS, FOLLOWUP_OUTCOME_LABELS, INSTRUCTION_LABELS, OPERATION_LABELS, PARTICIPATION_LABELS, type FamilyFeedbackEntry } from "./lib/family-feedback-types";
import { HELP_LEVEL_LABELS, sequenceTime, unitReportUrl } from "./lib/learning-sequence-types";
import type { Notify } from "./lib/platform-types";
import { batchFamilyVersion, batchSummary, type BatchCatalog, type BatchClass, type BatchEvidence, type BatchFamilyTask, type BatchReport, type BatchSequence, type TrialBatch } from "./lib/trial-batch-types";
import { trialSummary, TRIAL_KIND_LABELS, TRIAL_METHOD_LABELS } from "./lib/trial-types";
import styles from "./trial-batches.module.css";

const messages: Record<string, string> = {
  trial_batch_scope_changed: "班级名单或任务候选已变化，请刷新并核对候选；输入已保留。",
  trial_batch_changed: "批次关联已变化，请刷新批次后核对；输入已保留。",
  trial_batch_id_conflict: "本次请求已有不同范围的批次，请核对原记录；输入已保留。",
  trial_batch_already_voided: "批次已撤销，请刷新核对原记录；输入已保留。",
  invalid_trial_batch_selection: "所选任务须属于本批次班级、目标与名单，请核对版本或移除不可用项。",
};
const denied = (error: unknown) => error instanceof Error && [401, 403, 404].includes(Number(error.cause));
async function getData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal }); const value = await response.json();
  if (!response.ok) throw new Error(value.error === "password_change_required" ? "请先完成初始密码修改。" : "当前无法读取试用批次，请核对账号与授权范围。", { cause: response.status }); return value as T;
}
async function postData(body: Record<string, unknown>) {
  const response = await fetch("/api/v1/trial-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json() as { id: string; revision: number; error?: string };
  if (!response.ok) throw new Error(messages[value.error ?? ""] ?? "批次操作未完成，请重试；输入已保留。", { cause: response.status }); return value;
}
type Links = { sequenceIds: string[]; familyTasks: Array<{ id: string; revision: number }> };
const blankLinks: Links = { sequenceIds: [], familyTasks: [] };
const taskKey = (task: { id: string; revision: number }) => JSON.stringify([task.id, task.revision]);
function LinkChoices({ sequences, families, value, onChange, names }: { sequences: BatchSequence[]; families: BatchFamilyTask[]; value: Links; onChange: (value: Links) => void; names: Map<string, string> }) {
  const familyKeys = value.familyTasks.map(taskKey);
  return <div className={styles.choices}>
    <fieldset><legend>关联任务组（{sequences.length} 个候选）</legend><p>仅列出所选班级、目标与名单内的任务组，可稍后追加关联。</p>
      {sequences.map((group) => <label key={group.id}><input type="checkbox" checked={value.sequenceIds.includes(group.id)} onChange={(event) => onChange({ ...value, sequenceIds: event.target.checked ? [...value.sequenceIds, group.id] : value.sequenceIds.filter((id) => id !== group.id) })}/><span>{names.get(group.studentId)} · {group.title} · {group.medium === "audio" ? "录音" : "文字"} · {group.id.slice(0, 8)}</span></label>)}
      {value.sequenceIds.filter((id) => !sequences.some((group) => group.id === id)).map((id) => <label key={id}><input type="checkbox" checked onChange={() => onChange({ ...value, sequenceIds: value.sequenceIds.filter((item) => item !== id) })}/><span>已选任务组当前不在候选内 · {id.slice(0, 8)}，取消勾选可移除。</span></label>)}
      {!sequences.length && <p>当前没有匹配的任务组。</p>}
    </fieldset>
    <fieldset><legend>关联家庭任务版本（{families.length} 个候选）</legend>
      {families.map((task) => <label key={taskKey(task)}><input type="checkbox" checked={familyKeys.includes(taskKey(task))} onChange={(event) => onChange({ ...value, familyTasks: event.target.checked ? [...value.familyTasks, { id: task.id, revision: task.revision }] : value.familyTasks.filter((item) => taskKey(item) !== taskKey(task)) })}/><span>{names.get(task.studentId)} · {task.title} · {batchFamilyVersion(task.revision)}{task.historical ? " · 历史反馈版本" : ""} · {task.id.slice(0, 8)}</span></label>)}
      {value.familyTasks.filter((task) => !families.some((current) => taskKey(current) === taskKey(task))).map((task) => <label key={taskKey(task)}><input type="checkbox" checked onChange={() => onChange({ ...value, familyTasks: value.familyTasks.filter((item) => taskKey(item) !== taskKey(task)) })}/><span>已选家庭版本当前不在候选内 · {task.id.slice(0, 8)} {batchFamilyVersion(task.revision)}，取消勾选可移除。</span></label>)}
      {!families.length && <p>当前没有匹配的家庭任务版本。</p>}
    </fieldset>
  </div>;
}
function linksValid(value: Links, sequences: BatchSequence[], families: BatchFamilyTask[]) {
  return value.sequenceIds.every((id) => sequences.some((group) => group.id === id)) && value.familyTasks.every((task) => families.some((current) => taskKey(current) === taskKey(task)));
}
type Save = (body: Record<string, unknown>) => Promise<void>;
function CreateBatch({ catalog, save }: { catalog: BatchCatalog | null; save: Save }) {
  const [editing, setEditing] = useState(false); const [classId, setClassId] = useState(""); const [objectiveId, setObjectiveId] = useState(""); const [version, setVersion] = useState("");
  const [title, setTitle] = useState(""); const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const [workScope, setWorkScope] = useState("");
  const [people, setPeople] = useState<string[]>([]); const [links, setLinks] = useState<Links>(blankLinks);
  const [attempt, setAttempt] = useState<{ key: string; id: string } | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const classroom = catalog?.classes.find((item) => item.id === classId); const changed = !!classId && (!classroom || classroom.version !== version);
  const sequences = classroom?.sequences.filter((group) => group.objectiveId === objectiveId && people.includes(group.studentId)) ?? [];
  const families = classroom?.familyTasks.filter((task) => task.objectiveId === objectiveId && people.includes(task.studentId)) ?? [];
  if (!catalog) return null;
  return <div><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "收起新批次表单" : "新建试用批次"}</Button>{editing && <form className={styles.form} onSubmit={async (event) => {
    event.preventDefault(); if (busy || !classroom || changed || !people.length || !linksValid(links, sequences, families)) return;
    const payload = { action: "create", title: title.trim(), classId, objectiveId, participantIds: [...people].sort(), sequenceIds: [...links.sequenceIds].sort(), familyTasks: [...links.familyTasks].sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision), startDate, endDate, workScope: workScope.trim(), catalogVersion: version };
    const key = JSON.stringify(payload); const id = attempt?.key === key ? attempt.id : crypto.randomUUID(); setAttempt({ key, id }); setBusy(true); setError("");
    try { await save({ ...payload, id }); setEditing(false); setTitle(""); setWorkScope(""); setPeople([]); setLinks(blankLinks); setAttempt(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存尚未确认，请重试。"); } finally { setBusy(false); }
  }}><fieldset disabled={busy} className={styles.fields}>
    <label>批次名称<Input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
    <div className={styles.columns}><label>试用班级<NativeSelect className="w-full" required value={classId} onChange={(event) => { const current = catalog.classes.find((item) => item.id === event.target.value); setClassId(event.target.value); setVersion(current?.version ?? ""); setObjectiveId(""); setPeople([]); setLinks(blankLinks); }}><option value="">请选择班级</option>{classId && !classroom && <option value={classId}>原选择班级当前不可读取</option>}{catalog.classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(0, 8)}</option>)}</NativeSelect></label>
    <label>本批次学习目标<NativeSelect className="w-full" required value={objectiveId} onChange={(event) => { setObjectiveId(event.target.value); setLinks(blankLinks); }}><option value="">请选择目标</option>{classroom?.objectives.map((goal) => <option key={goal.id} value={goal.id}>{goal.title} · {goal.id.slice(0, 8)}</option>)}</NativeSelect></label></div>
    <div className={styles.columns}><label>观察开始日期（北京时间）<Input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)}/></label><label>观察结束日期（含当日）<Input required type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)}/></label></div>
    <label>单元工作范围与两种方式的可比条件<Textarea required maxLength={2000} value={workScope} onChange={(event) => setWorkScope(event.target.value)} placeholder="说明任务范围、难度、人数与实际计时方式；尚不具备可比条件时也请明确记录。"/></label>
    {classroom && <fieldset className={styles.people}><legend>固定参与名单（已选 {people.length} 人）</legend><Button type="button" variant="outline" onClick={() => setPeople(classroom.participants.filter((person) => person.status === "active").map((person) => person.id))}>选择当前在读学生</Button>
      {classroom.participants.map((person) => <label key={person.id}><input type="checkbox" checked={people.includes(person.id)} onChange={(event) => setPeople(event.target.checked ? [...people, person.id] : people.filter((id) => id !== person.id))}/><span>{person.name} · {person.status === "active" ? "在读" : "已离班"} · {person.id.slice(0, 8)}</span></label>)}
      {people.filter((id) => !classroom.participants.some((person) => person.id === id)).map((id) => <label key={id}><input type="checkbox" checked onChange={() => setPeople(people.filter((item) => item !== id))}/><span>原选择学生当前不可读取 · {id.slice(0, 8)}</span></label>)}
    </fieldset>}
    <LinkChoices sequences={sequences} families={families} value={links} onChange={setLinks} names={new Map(classroom?.participants.map((person) => [person.id, person.name]))}/>
    {changed && <div role="alert"><p>名单或候选已更新。输入保留，请核对当前显示的学生和任务。</p>{classroom && <Button type="button" variant="outline" onClick={() => setVersion(classroom.version)}>已核对当前候选</Button>}</div>}
    <p>创建后固定班级、目标、名单、周期与工作范围；新任务组或新家庭版本须明确追加。误建可带原因撤销，原记录保留。</p>
    {error && <p role="alert">{error}</p>}<Button type="submit" disabled={busy || changed || !people.length || !linksValid(links, sequences, families) || people.some((id) => !classroom?.participants.some((person) => person.id === id))}>{busy ? "保存并核对中…" : "保存试用批次"}</Button>
  </fieldset></form>}</div>;
}
type ActionDraft = Links & { version: string; reason: string; mode: "" | "link" | "void"; error: string };
const blankAction: ActionDraft = { ...blankLinks, version: "", reason: "", mode: "", error: "" };
function BatchActions({ batch, classroom, draft, update, busy, setBusy, save }: { batch: TrialBatch | null; classroom?: BatchClass; draft: ActionDraft; update: (value: Partial<ActionDraft>) => void; busy: boolean; setBusy: (value: boolean) => void; save: Save }) {
  if (!batch || batch.voidedAt) return null;
  const people = batch.scope.participants.map((person) => person.id);
  const sequences = [...(classroom?.sequences.filter((group) => group.objectiveId === batch.scope.objectiveId && people.includes(group.studentId) && !batch.scope.sequences.some((old) => old.id === group.id)) ?? []), ...batch.scope.sequences.filter((group) => draft.sequenceIds.includes(group.id))];
  const families = [...(classroom?.familyTasks.filter((task) => task.objectiveId === batch.scope.objectiveId && people.includes(task.studentId) && !batch.scope.familyTasks.some((old) => taskKey(old) === taskKey(task))) ?? []), ...batch.scope.familyTasks.filter((task) => draft.familyTasks.some((target) => taskKey(target) === taskKey(task)))];
  const alreadyLinked = (draft.sequenceIds.length > 0 || draft.familyTasks.length > 0) && draft.sequenceIds.every((id) => batch.scope.sequences.some((group) => group.id === id)) && draft.familyTasks.every((task) => batch.scope.familyTasks.some((old) => taskKey(old) === taskKey(task)));
  const changed = !alreadyLinked && (!classroom || draft.version !== classroom.version);
  return <div className={styles.actions}><Button type="button" variant="outline" disabled={busy} onClick={() => update({ mode: draft.mode === "link" ? "" : "link", version: draft.version || classroom?.version || "" })}>追加任务关联</Button>{batch.canVoid && <Button type="button" variant="outline" disabled={busy} onClick={() => update({ mode: draft.mode === "void" ? "" : "void" })}>撤销本批次</Button>}
    {draft.mode && <form className={styles.form} onSubmit={async (event) => {
      event.preventDefault(); if (busy || (draft.mode === "link" && (changed || !linksValid(draft, sequences, families)))) return;
      setBusy(true); update({ error: "" });
      try { await save(draft.mode === "void" ? { action: "void", id: batch.id, reason: draft.reason.trim() } : { action: "link", id: batch.id, revision: batch.revision, catalogVersion: draft.version, sequenceIds: draft.sequenceIds, familyTasks: draft.familyTasks }); update(blankAction); }
      catch (reason) { update({ error: reason instanceof Error ? reason.message : "操作尚未确认，请重试。" }); } finally { setBusy(false); }
    }}><fieldset className={styles.fields} disabled={busy}>{draft.mode === "void" ? <label>批次撤销原因<Textarea required maxLength={1000} value={draft.reason} onChange={(event) => update({ reason: event.target.value })}/></label> : <>
      <LinkChoices sequences={sequences} families={families} value={draft} onChange={(value) => update(value)} names={new Map(batch.scope.participants.map((person) => [person.id, person.name]))}/>
      {changed && <div role="alert"><p>任务候选有变化，请核对当前候选及所选版本。</p>{classroom && <Button type="button" variant="outline" onClick={() => update({ version: classroom.version })}>已核对追加候选</Button>}</div>}
      <p>{alreadyLinked ? "所选关联已存在，重试仅核对保存结果，不会重复追加。" : "追加后沿用原名单和观察周期。家庭任务按版本关联，后续教学安排生成的新任务组需另行追加。"}</p></>}
      {draft.error && <p role="alert">{draft.error}</p>}<Button type="submit" disabled={busy || (draft.mode === "link" && (changed || (!draft.sequenceIds.length && !draft.familyTasks.length) || !linksValid(draft, sequences, families)))}>{busy ? "保存并核对中…" : draft.mode === "void" ? "保存批次撤销原因" : "保存追加关联"}</Button>
    </fieldset></form>}
  </div>;
}
function EvidenceCell({ work }: { work?: BatchEvidence | null }) {
  return work ? <><strong>{work.goalScore === null ? "本期评价未核对" : `${work.goalScore}/100`}</strong><br/>{HELP_LEVEL_LABELS[work.helpLevel]} · 提示 {work.promptCount ?? "未记录"} 次<br/>{work.contextConfirmed ? "新情境已核对" : "新情境尚未确认"}<br/>{work.inPeriod ? "期内作品" : "期外初次参照"} · {work.rubricMatched ? "原量规一致" : "原量规不同或未保留"}</> : <>没有期内作品</>;
}
function BatchFeedbackSupport({ entry }: { entry: FamilyFeedbackEntry }) {
  return <>{entry.responseId && <p>后续反馈：{entry.followupOutcome ? FOLLOWUP_OUTCOME_LABELS[entry.followupOutcome][0] : "结果未保留"} · 处理记录 {entry.responseId}</p>}
    {entry.responses.map((response) => <div key={response.id}><h4>教师处理：{FEEDBACK_RESPONSE_LABELS[response.kind][0]}{response.voidedAt ? " · 已撤销" : ""}</h4><p>{response.authorName} · {sequenceTime(response.createdAt)} · {response.id}</p><p className={styles.copy}>{response.detail}</p>{response.voidedAt && <p className={styles.copy}>撤销原因：{response.voidReason}</p>}</div>)}</>;
}
function BatchResults({ report }: { report: BatchReport }) {
  const summary = batchSummary(report); const workload = trialSummary(report.entries, []); const scope = report.batch.scope;
  return <div className={styles.results}><h4>{report.batch.title}</h4><p>{scope.className} · {scope.objectiveTitle} · {scope.startDate} 至 {scope.endDate}（北京时间，含首尾日期）</p><p className={styles.copy}>{scope.workScope}</p>
    <div className="grid gap-4 sm:grid-cols-3"><StatCard label="参与学生" value={summary.participants} detail={`${summary.withoutGroups} 人未关联任务组`}/><StatCard label="独立迁移记录" value={summary.independentTransfer} detail={`${summary.missingTransfer} 人暂无期内迁移作品`}/><StatCard label="独立复测记录" value={summary.independentRetest} detail={`${summary.unavailableGroups} 组关联变更或不可读`}/></div>
    {report.batch.voidedAt && <p role="status" className={styles.copy}>本批次已撤销：{report.batch.voidReason}。以下仅保留原范围及历史供回看。</p>}
    <p><a target="_blank" rel="noopener" href={`/api/v1/trial-batches/${encodeURIComponent(report.batch.id)}/report`}>查看批次报告 / 打印</a></p>
    <h4>教师实际用时</h4><p className={styles.meta}>{report.workloadScope === "self" ? "仅统计本人耗时与本班观察。" : "统计本机构授权范围内的记录。"}</p>
    <div className={styles.table}><Table><TableHeader><TableRow><TableHead>工作内容</TableHead><TableHead>方式</TableHead><TableHead>记录数</TableHead><TableHead>实际用时</TableHead></TableRow></TableHeader><TableBody>{workload.workload.map((item) => <TableRow key={`${item.kind}-${item.method}`}><TableHead>{TRIAL_KIND_LABELS[item.kind]}</TableHead><TableCell>{TRIAL_METHOD_LABELS[item.method]}</TableCell><TableCell>{item.count}</TableCell><TableCell>{item.minutes === null ? "未记录" : `${item.minutes} 分钟`}</TableCell></TableRow>)}</TableBody></Table></div>
    <p>{workload.observations.map((item) => `${TRIAL_KIND_LABELS[item.kind]} ${item.count} 条`).join("；")}。撤销不计入有效汇总；记录数不等于学生人数。</p>
    <h4>固定名单与学习证据</h4>{report.participants.map((person) => <details className={styles.entry} key={person.id}><summary>{person.name} · {person.id.slice(0, 8)} · {person.currentStatus === "active" ? "当前在读" : person.currentStatus === null ? "当前编班不可核对" : "当前已离班"} · {person.groups.length} 个关联任务组</summary>
      <p>建批时{person.status === "active" ? "在读" : "已离班"}；当前离班不自动视为退出。没有关联或缺少作品时保留缺失。</p>
      {!person.groups.length && <p>未关联任务组，学习证据保持缺失。</p>}{person.groups.map((group) => <section key={group.source.id}><h4>{group.source.title} · {group.source.medium === "audio" ? "录音" : "文字"}</h4>{group.available ? <>
        <p>{group.transferStatus}；{group.retestStatus}</p><p><a target="_blank" rel="noopener" href={unitReportUrl(group.source.id)}>查看原始单元证据与全部历史</a></p>
        <div className={styles.table}><Table><TableHeader><TableRow><TableHead>初次参照</TableHead><TableHead>期内最近练习</TableHead><TableHead>期内最近迁移</TableHead><TableHead>期内最近复测</TableHead></TableRow></TableHeader><TableBody><TableRow>{[group.baseline, group.practice[0], group.transfer[0], group.retest[0]].map((work, index) => <TableCell key={index}><EvidenceCell work={work}/></TableCell>)}</TableRow></TableBody></Table></div>
        <p>期内练习 {group.practice.length} 份、迁移 {group.transfer.length} 份、复测 {group.retest.length} 份；最近提交待评价时保留该状态。{group.retestAvailableAt ? `复测开放：${sequenceTime(group.retestAvailableAt)}` : "尚未安排复测。"}</p>
        <details><summary>逐份查看期内作品与初次参照</summary>{[...(group.baseline ? [group.baseline] : []), ...group.practice, ...group.transfer, ...group.retest].map((work) => <p key={work.id}><a target="_blank" rel="noopener" href={`${unitReportUrl(group.source.id)}#work-${encodeURIComponent(work.id)}`}>{work.title} · {work.id.slice(0, 8)}</a> · {sequenceTime(work.submittedAt)} · {work.goalScore === null ? "本期评价未核对" : `${work.goalScore}/100`}</p>)}</details>
      </> : <p>{group.transferStatus}</p>}</section>)}
    </details>)}
    <h4>家庭可用性</h4><p>{summary.familyRecords} 条期内有效反馈，涉及 {summary.familyStudents} 人；{summary.missingFamilyTasks}/{scope.familyTasks.length} 份关联版本没有期内有效反馈。家庭反馈与语言成绩、交流确认及任务完成分别记录。</p>
    <details><summary>查看关联家庭版本、反馈与撤销历史</summary><p>仅展示期内反馈及其期内处理记录；后续反馈按自己的时间和任务版本纳入。缺少期外来源不表示困难已解决；保留当前撤销状态。</p>{!scope.familyTasks.length && <p>未关联家庭任务版本，家庭可用性仍待观察。</p>}{scope.familyTasks.map((task) => <p key={taskKey(task)}>{scope.participants.find((person) => person.id === task.studentId)?.name} · {task.title} · {batchFamilyVersion(task.revision)} · {task.id.slice(0, 8)}</p>)}
      {report.feedback.map((entry) => <article className={styles.entry} key={entry.id}><h4>{scope.participants.find((person) => person.id === entry.studentId)?.name} · {entry.snapshot.title} · {batchFamilyVersion(entry.revision)}{entry.voidedAt ? " · 已撤销" : ""}</h4><p>{PARTICIPATION_LABELS[entry.participation][0]}；说明：{INSTRUCTION_LABELS[entry.instructions][0]}；操作帮助：{OPERATION_LABELS[entry.operationHelp][0]}；替代交流：{ALTERNATIVE_LABELS[entry.alternative][0]}</p><p className={styles.copy}>{entry.note || "未补充说明"}</p><p className={styles.copy}>原说明：{entry.snapshot.detail}</p><BatchFeedbackSupport entry={entry}/><p>{entry.authorName} · {sequenceTime(entry.createdAt)} · {entry.id.slice(0, 8)}</p>{entry.voidedAt && <p className={styles.copy}>撤销原因：{entry.voidReason}</p>}</article>)}
    </details>
    <details><summary>查看用时、退出及未改善原记录（{report.entries.length} 条）</summary>{!report.entries.length && <p>当前授权范围没有期内记录，保持未记录。</p>}{report.entries.map((entry) => <article className={styles.entry} key={entry.id}><h4>{TRIAL_KIND_LABELS[entry.kind]}{entry.voidedAt ? " · 已撤销" : ""}</h4><p>{entry.teacherName} · {sequenceTime(entry.createdAt)} · {entry.id.slice(0, 8)}</p><p>{entry.method && `${TRIAL_METHOD_LABELS[entry.method]} · ${entry.minutes ?? "未记录"} 分钟`}</p><p className={styles.copy}>{entry.note}</p><a target="_blank" rel="noopener" href={unitReportUrl(entry.sequenceId)}>{entry.sequenceTitle}</a>{entry.voidedAt && <p className={styles.copy}>撤销原因：{entry.voidReason}</p>}</article>)}</details>
    <details className={styles.meta}><summary>汇总范围与统计口径</summary><p>名单、周期与工作范围按创建时保留。阶段作品按提交时间，用时和家庭反馈按记录创建时间纳入周期；评价截至观察期末或本次读取时间，撤销记录不计入有效汇总。原单元报告包含周期外历史。</p><p>独立迁移与复测记录需结合目标评价查看，不代表能力等级。工作方式的范围和难度需另行核对，用时和前后分数变化不能直接归因于平台。</p></details>
  </div>;
}
type Snapshot = { catalog: BatchCatalog | null; report: BatchReport | null; scopeId: string; error: string; loading: boolean; failedId?: string };
export function TrialBatches({ revision, notify }: { revision: string; notify: Notify }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ catalog: null, report: null, scopeId: "", error: "", loading: true });
  const [selectedId, setSelectedId] = useState(""); const selected = useRef(""); const [classFilter, setClassFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({}); const [busy, setBusy] = useState<Record<string, boolean>>({});
  const tracking = useRef<{ active: boolean; version: number; controller?: AbortController; committed?: Snapshot }>({ active: true, version: 0 });
  const load = useCallback(async (id = selected.current) => {
    const request = tracking.current; if (!request.active) return null; const version = ++request.version; request.controller?.abort(); request.controller = new AbortController();
    setSnapshot((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const guarded = async <T,>(path: string) => {
        try { return await getData<T>(path, request.controller!.signal); }
        catch (error) { if (denied(error) && request.active && request.version === version) { request.committed = undefined; request.controller?.abort();
          setSnapshot({ catalog: null, report: null, scopeId: id, error: "当前无权读取试用范围，请核对账号与授权后重试。", loading: false, failedId: id }); } throw error; }
      };
      const outcomes = await Promise.allSettled([guarded<BatchCatalog>("/api/v1/trial-batches"), id ? guarded<BatchReport>(`/api/v1/trial-batches/${encodeURIComponent(id)}`) : Promise.resolve(null)]);
      const failure = outcomes.find((item) => item.status === "rejected" && denied(item.reason)) ?? outcomes.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      const catalog = (outcomes[0] as PromiseFulfilledResult<BatchCatalog>).value; const report = (outcomes[1] as PromiseFulfilledResult<BatchReport | null>).value;
      if (!request.active || request.version !== version) return null;
      const next: Snapshot = { catalog, report, scopeId: id, error: "", loading: false }; request.committed = next; setSnapshot(next); return next;
    } catch (error) {
      if (!request.active || request.version !== version) return null;
      if (denied(error)) { request.committed = undefined; setSnapshot({ catalog: null, report: null, scopeId: id, error: "当前无权读取试用范围，请核对账号与授权后重试。", loading: false, failedId: id }); }
      else { const previous = request.committed; if (previous && previous.scopeId !== id) { selected.current = previous.scopeId; setSelectedId(previous.scopeId); }
        setSnapshot({ catalog: previous?.catalog ?? null, report: previous?.report ?? null, scopeId: previous?.scopeId ?? "", error: "试用批次暂时无法读取，已保留上次范围、筛选和输入。", loading: false, failedId: id }); }
      return null;
    }
  }, []);
  useEffect(() => { const request = tracking.current; request.active = true; void load(); return () => { request.active = false; request.version++; request.controller?.abort(); }; }, [load, revision]);
  const choose = (id: string) => { selected.current = id; setSelectedId(id); void load(id); };
  async function save(body: Record<string, unknown>) {
    const previousSelection = selected.current;
    try {
      const saved = await postData(body);
      const follow = body.action === "create" && selected.current === previousSelection;
      if (follow) { selected.current = saved.id; setSelectedId(saved.id); }
      const latest = await load(); const batch = latest?.catalog?.batches.find((item) => item.id === saved.id);
      if (!batch || batch.revision < saved.revision || (body.action === "void" && !batch.voidedAt)) throw new Error("保存结果尚未读取确认，请重试；相同内容重试不会重复创建或关联。");
      notify(body.action === "create" ? "试用批次已保存" : body.action === "void" ? "试用批次已撤销" : "关联已追加", `${batch.title}。名单和周期保留，语言成绩不受影响。`);
    } catch (error) {
      if (denied(error)) {
        if (selected.current !== previousSelection) { void load(); throw error; }
        const request = tracking.current; request.version++; request.controller?.abort(); request.committed = undefined;
        setSnapshot({ catalog: null, report: null, scopeId: selected.current, loading: false, error: "当前无法操作这项试用批次，请重新读取并核对授权。", failedId: selected.current });
      }
      throw error;
    }
  }
  const catalog = snapshot.catalog; const report = snapshot.scopeId === selectedId ? snapshot.report : null;
  const classes = new Map([...(catalog?.batches.map((item) => [item.scope.classId, item.scope.className] as const) ?? []), ...(catalog?.classes.map((item) => [item.id, item.name] as const) ?? [])]);
  const batches = catalog?.batches.filter((batch) => !classFilter || batch.scope.classId === classFilter) ?? [];
  const selectedBatch = catalog?.batches.find((batch) => batch.id === selectedId);
  return <Card className={`gap-0 p-6 ${styles.panel}`} aria-label="班级试用批次" aria-busy={snapshot.loading}><SectionHeading title="班级试用批次" description="汇总同一观察周期内的学习作品、教师用时与家庭反馈。" action={<Button type="button" variant="outline" disabled={snapshot.loading} onClick={() => void load()}>刷新批次</Button>}/>
    {snapshot.loading && <p role="status">正在读取{selectedId ? "所选批次" : "试用范围"}，上次数据与筛选保留。</p>}{snapshot.error && <div role="alert"><p>{snapshot.error}</p><Button type="button" variant="outline" onClick={() => { const id = snapshot.failedId ?? selected.current; selected.current = id; setSelectedId(id); void load(id); }}>重试读取批次</Button></div>}
    <CreateBatch catalog={catalog} save={save}/>
    {catalog && <><div className={styles.columns}><label>批次班级<NativeSelect className="w-full" value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="">全部可读班级</option>{classFilter && !classes.has(classFilter) && <option value={classFilter}>原班级当前无批次</option>}{[...classes].map(([id, name]) => <option key={id} value={id}>{name} · {id.slice(0, 8)}</option>)}</NativeSelect></label>
      <label>查看试用批次<NativeSelect className="w-full" value={selectedId} onChange={(event) => choose(event.target.value)}><option value="">请选择批次</option>{selectedBatch && !batches.some((batch) => batch.id === selectedId) && <option value={selectedId}>{selectedBatch.title} · 当前筛选外</option>}{selectedId && !selectedBatch && <option value={selectedId}>原批次当前不可读取</option>}{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.title} · {batch.scope.className} · {batch.id.slice(0, 8)}{batch.voidedAt ? " · 已撤销" : ""}</option>)}</NativeSelect></label></div>
      <p className={styles.meta}>当前筛选 {batches.length}/{catalog.batches.length} 个批次；读取于 {sequenceTime(catalog.generatedAt)}。</p>
      {!batches.length && <EmptyState title={catalog.batches.length ? "没有匹配的批次" : "还没有试用批次"} description={catalog.batches.length ? "调整班级筛选后重试。" : "创建批次，选择参与学生与观察周期。"} action={classFilter ? <Button type="button" variant="outline" onClick={() => setClassFilter("")}>清除筛选</Button> : undefined}/>}
    </>}
    {report && <BatchResults report={report}/>}
    {selectedId && <BatchActions batch={report?.batch ?? null} classroom={catalog?.classes.find((item) => item.id === report?.batch.scope.classId)} draft={drafts[selectedId] ?? blankAction} update={(patch) => setDrafts((previous) => ({ ...previous, [selectedId]: { ...(previous[selectedId] ?? blankAction), ...patch } }))} busy={busy[selectedId] ?? false} setBusy={(value) => setBusy((previous) => ({ ...previous, [selectedId]: value }))} save={save}/>}
  </Card>;
}
