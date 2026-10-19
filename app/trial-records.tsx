"use client";

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
  return <>{!editing ? <button type="button" className="soft-button" onClick={() => setEditing(true)}>撤销记录</button> : <form onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      await act("void_trial_record", { id: entry.id, reason }); setEditing(false);
      notify("记录已撤销", "原记录与撤销原因保留，不再计入有效记录。");
    } catch (error) { notify("撤销失败", trialError(error), "error"); }
    finally { setBusy(false); }
  }}><fieldset disabled={busy} className={styles.fields}><label>撤销原因<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
    <div className={styles.actions}><button className="soft-button" disabled={busy}>{busy ? "撤销中…" : "保存撤销原因"}</button><button type="button" className="soft-button" onClick={() => setEditing(false)}>取消</button></div>
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
  return <section className={styles.overview}><h4>真实试用记录</h4>
    <p>耗时为教师自记。教师查看本人耗时及本班观察，管理员查看本机构记录。记录数不等于学生人数；撤销记录不计入汇总。</p>
    <div className={styles.table}><table><thead><tr><th>工作内容</th><th>工作方式</th><th>有效记录数</th><th>合计用时</th></tr></thead><tbody>
      {summary.workload.map((item) => <tr key={`${item.kind}-${item.method}`}><th>{TRIAL_KIND_LABELS[item.kind]}</th><td>{TRIAL_METHOD_LABELS[item.method]}</td><td>{item.count}</td><td>{item.minutes === null ? "未记录" : `${item.minutes} 分钟`}</td></tr>)}
    </tbody></table></div>
    <p>两种工作方式的任务范围和难度需另行核对，以上合计不能直接证明节省时间。</p>
    <p>{summary.observations.map((item) => `${TRIAL_KIND_LABELS[item.kind]}：${item.count} 条`).join("；")}。</p>
    <p>已评价作品的提示次数：{summary.prompts.known} 份已记录，{summary.prompts.missing} 份未记录。同一作品重复关联只计一次。</p>
    <p>小规模试用用于发现问题；前后分数变化不能直接归因于平台。</p>
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
    <button type="button" className="soft-button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "收起记录表单" : "新增试用记录"}</button>
    {editing && <form className="form-card" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try {
        await act("create_trial_record", { id: requestId, sequenceId: sequence.id, kind, method: isWorkload(kind) ? method : null, minutes: isWorkload(kind) ? Number(minutes) : null, note, referenceSubmissionId: referenceId || null });
        setEditing(false); setKind(""); setMethod(""); setMinutes(""); setNote(""); setReferenceId(""); setRequestId(crypto.randomUUID());
        notify("试用记录已保存", "记录已关联本任务组，不会生成成绩或改变任务状态。");
      } catch (error) { notify("保存失败", trialError(error), "error"); }
      finally { setBusy(false); }
    }}><fieldset className={styles.fields} disabled={busy}>
      <label>记录类型<select required value={kind} onChange={(event) => setKind(event.target.value as TrialKind)}><option value="">请选择</option>{Object.entries(TRIAL_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {isWorkload(kind) && <><label>工作方式<select required value={method} onChange={(event) => setMethod(event.target.value as TrialMethod)}><option value="">请选择</option>{Object.entries(TRIAL_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>实际耗时（分钟）<input required type="number" min="0" max="1440" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)}/></label>
        <p>填写实际工作用时及范围；共用备课只记录一次，不按学生重复计时。页面打开时长不会计入耗时。</p></>}
      <label>关联作品（可选）<select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}><option value="">不关联单份作品</option>{works.map((work) => <option key={work.id} value={work.id}>{work.title} · {sequenceTime(work.submittedAt)} · {work.id.slice(0, 8)}</option>)}</select></label>
      <label>{isWorkload(kind) ? "工作范围与记录依据" : "观察情况与原因"}<textarea required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={isWorkload(kind) ? "说明本次完成哪些工作，何时、怎样记录用时。" : "描述实际发生的情况与依据；未改善只代表本次观察。"}/></label>
      <button className="primary-button" disabled={busy}>{busy ? "保存中…" : "保存试用记录"}</button>
    </fieldset></form>}
    <RecordList entries={records} controls={{ act, notify }}/>
  </section>;
}
