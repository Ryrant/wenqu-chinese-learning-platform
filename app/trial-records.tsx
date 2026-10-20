"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

import { useState } from "react";
import type { Act, Notify } from "./lib/platform-types";
import { sequenceTime, type LearningSequence } from "./lib/learning-sequence-types";
import { isWorkload, trialSummary, TRIAL_KIND_LABELS, TRIAL_METHOD_LABELS, type TrialEntry, type TrialKind, type TrialMethod } from "./lib/trial-types";
import styles from "./trial-records.module.css";

type Controls = { act: Act; notify: Notify };
function trialError(error: unknown) {
  const messages: Record<string, string> = {
    forbidden: "当前没有此班级或记录的操作权限，请刷新后查看。",
    invalid_trial_minutes: "请填写 0 到 1440 之间的整数分钟数。",
    invalid_trial_note: "请填写工作范围或实际观察情况。",
    invalid_trial_reference: "所选作品不属于本任务组，请重新选择；其他输入已保留。",
    trial_record_id_conflict: "此请求已有保存结果，请先查看记录；输入已保留。",
    trial_record_already_voided: "此记录已被撤销，请刷新查看原撤销原因。",
    invalid_trial_void_reason: "请填写撤销原因。",
  };
  return error instanceof Error && messages[error.message] ? messages[error.message] : "操作未完成，请重试；输入已保留。";
}

function VoidRecord({ entry, act, notify }: { entry: TrialEntry } & Controls) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <>{!editing ? <Button type="button" variant="outline" onClick={() => setEditing(true)}>撤销记录</Button> : <form onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      await act("void_trial_record", { id: entry.id, reason }); setEditing(false);
      notify("记录已撤销", "原记录与撤销原因保留，不再计入有效记录。");
    } catch (error) { notify("撤销失败", trialError(error), "error"); }
    finally { setBusy(false); }
  }}><fieldset disabled={busy} className={styles.fields}><label>撤销原因<Textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
    <div className={styles.actions}><Button type="submit" variant="outline" disabled={busy}>{busy ? "撤销中…" : "保存撤销原因"}</Button><Button type="button" variant="outline" onClick={() => setEditing(false)}>取消</Button></div>
  </fieldset></form>}</>;
}

function RecordList({ entries, controls }: { entries: TrialEntry[]; controls: Controls }) {
  const render = (entry: TrialEntry) => <article className={styles.record} key={entry.id}>
    <strong>{TRIAL_KIND_LABELS[entry.kind]}{entry.voidedAt ? " · 已撤销" : ""}</strong>
    <p>{entry.className} · {entry.studentName} · {entry.sequenceTitle}</p>
    <p>{entry.teacherName} · 记录于 {sequenceTime(entry.createdAt)} · {entry.id.slice(0, 8)}</p>
    {entry.method && <p>{TRIAL_METHOD_LABELS[entry.method]} · {entry.minutes === null ? "耗时未记录" : `${entry.minutes} 分钟`}</p>}
    {entry.referenceSubmissionId && <p>关联作品：{entry.referenceTitle} · {entry.referenceSubmissionId.slice(0, 8)}</p>}
    <p className={styles.copy}>{entry.note}</p>
    {entry.voidedAt ? <p className={styles.copy}>撤销于 {sequenceTime(entry.voidedAt)}：{entry.voidReason}</p> : entry.canVoid && <VoidRecord entry={entry} {...controls}/>}
  </article>;
  return <div>{!entries.length && <p>尚无试用记录。</p>}{entries.slice(0, 8).map(render)}
    {entries.length > 8 && <details><summary>查看其余 {entries.length - 8} 条记录</summary>{entries.slice(8).map(render)}</details>}
  </div>;
}

export function TrialOverview({ entries, sequences, controls, sequenceId }: { entries: TrialEntry[]; sequences: LearningSequence[]; controls?: Controls; sequenceId?: string }) {
  const summary = trialSummary(entries, sequences.filter((item) => item.canPlanNext));
  return <section className={styles.overview}><h4>试用记录</h4>
    <p>教师记录的工作用时与教学观察。</p>
    <div className={styles.table}><Table><TableHeader><TableRow><TableHead>工作内容</TableHead><TableHead>工作方式</TableHead><TableHead>有效记录数</TableHead><TableHead>合计用时</TableHead></TableRow></TableHeader><TableBody>
      {summary.workload.map((item) => <TableRow key={`${item.kind}-${item.method}`}><TableHead>{TRIAL_KIND_LABELS[item.kind]}</TableHead><TableCell>{TRIAL_METHOD_LABELS[item.method]}</TableCell><TableCell>{item.count}</TableCell><TableCell>{item.minutes === null ? "未记录" : `${item.minutes} 分钟`}</TableCell></TableRow>)}
    </TableBody></Table></div>

    <p>{summary.observations.map((item) => `${TRIAL_KIND_LABELS[item.kind]}：${item.count} 条`).join("；")}。</p>
    <p>已评价作品的提示次数：{summary.prompts.known} 份已记录，{summary.prompts.missing} 份未记录。同一作品重复关联只计一次。</p>
    <details><summary>统计口径</summary><p>耗时为教师自记，撤销记录不计入汇总，记录数不等于学生人数。两种工作方式的范围和难度需另行核对，用时与前后分数变化不能直接归因于平台。</p></details>
    <p><a href={`/api/v1/trial-records/report${sequenceId ? `?sequenceId=${encodeURIComponent(sequenceId)}` : ""}`} target="_blank" rel="noopener">查看内部试用报告 / 打印</a></p>
    {controls && <details><summary>查看试用明细与撤销记录</summary><RecordList entries={entries} controls={controls}/></details>}
  </section>;
}

export function TrialRecorder({ sequence, entries, act, notify }: { sequence: LearningSequence; entries: TrialEntry[] } & Controls) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<TrialKind | "">("");
  const [method, setMethod] = useState<TrialMethod | "">("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const works = [...new Map([sequence.baseline, ...sequence.practice, ...sequence.transfer, ...sequence.retest].map((work) => [work.id, work])).values()];
  const records = entries.filter((item) => item.sequenceId === sequence.id);
  return <section className={styles.section}><TrialOverview entries={records} sequences={[sequence]} sequenceId={sequence.id}/>
    <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "收起记录表单" : "新增试用记录"}</Button>
    {editing && <form className="form-card" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try {
        await act("create_trial_record", { id: requestId, sequenceId: sequence.id, kind, method: isWorkload(kind) ? method : null, minutes: isWorkload(kind) ? Number(minutes) : null, note, referenceSubmissionId: referenceId || null });
        setEditing(false); setKind(""); setMethod(""); setMinutes(""); setNote(""); setReferenceId(""); setRequestId(crypto.randomUUID());
        notify("试用记录已保存", "已关联当前任务组。");
      } catch (error) { notify("保存失败", trialError(error), "error"); }
      finally { setBusy(false); }
    }}><fieldset className={styles.fields} disabled={busy}>
      <label>记录类型<NativeSelect className="w-full" required value={kind} onChange={(event) => setKind(event.target.value as TrialKind)}><option value="">请选择</option>{Object.entries(TRIAL_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
      {isWorkload(kind) && <><label>工作方式<NativeSelect className="w-full" required value={method} onChange={(event) => setMethod(event.target.value as TrialMethod)}><option value="">请选择</option>{Object.entries(TRIAL_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
        <label>实际耗时（分钟）<Input required type="number" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)}/></label>
        <p>填写实际工作用时及范围；共用备课只记录一次，不按学生重复计时。页面打开时长不会计入耗时。</p></>}
      <label>关联作品（可选）<NativeSelect className="w-full" value={referenceId} onChange={(event) => setReferenceId(event.target.value)}><option value="">不关联单份作品</option>{works.map((work) => <option key={work.id} value={work.id}>{work.title} · {sequenceTime(work.submittedAt)} · {work.id.slice(0, 8)}</option>)}</NativeSelect></label>
      <label>{isWorkload(kind) ? "工作范围与记录依据" : "观察情况与原因"}<Textarea required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={isWorkload(kind) ? "说明本次完成哪些工作，何时、怎样记录用时。" : "描述实际发生的情况与依据；未改善只代表本次观察。"}/></label>
      <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存试用记录"}</Button>
    </fieldset></form>}
    <RecordList entries={records} controls={{ act, notify }}/>
  </section>;
}
