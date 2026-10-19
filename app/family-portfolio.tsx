"use client";

import { useEffect, useState } from "react";
import { FamilyWorkEvidence } from "./family-task-guide";
import { WorkEvidence } from "./learning-sequences";
import { UnitReportLink } from "./unit-report-links";
import { familyConfirmationLabel, type FamilyPortfolioData, type FamilyPortfolioEntry } from "./lib/family-portfolio-types";
import { HELP_LEVEL_LABELS, sequenceTime } from "./lib/learning-sequence-types";
import styles from "./family-portfolio.module.css";

function PortfolioWork({ entry }: { entry: FamilyPortfolioEntry }) {
  const [open, setOpen] = useState(false);
  return <details className={styles.work} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>
    <strong>{entry.work.title}</strong><span>{sequenceTime(entry.work.submittedAt)} · {entry.work.id.slice(0, 8)}</span>
    <span>{familyConfirmationLabel(entry)} · {entry.work.reviewed ? "教师已评价" : "待教师评价"}</span>
  </summary>{open && <div className={styles.detail}>
    <p>原班级：{entry.className} · 原交流目标：{entry.snapshot?.objectiveTitle || "未留存"}</p>
    <FamilyWorkEvidence value={entry.snapshot}/>
    <section><h4>交流确认记录</h4><p>{familyConfirmationLabel(entry)}{entry.confirmedAt ? ` · ${sequenceTime(entry.confirmedAt)}` : ""}{entry.confirmedByName ? ` · ${entry.confirmedByName}` : ""}</p>
      <p>已保存的交流帮助记录：{HELP_LEVEL_LABELS[entry.familyHelpLevel]}</p>
      <p>交流确认与语言评价分开保留；确认交流不会生成成绩。</p></section>
    <section><h4>学生作品与教师评价</h4><WorkEvidence work={entry.work} objectiveId={entry.snapshot?.objectiveId}/></section>
    <section><h4>从本次作品继续的练习与迁移</h4>{entry.sequences.length ? <ul>{entry.sequences.map((sequence) => <li key={sequence.id}><span>{sequence.direct ? "关联初次作品" : "后续教学安排"} · {sequence.objectiveTitle}</span><UnitReportLink sequenceId={sequence.id}>{sequence.title} · 查看单元证据</UnitReportLink></li>)}</ul> : <p>尚未关联后续任务组，迁移表现仍待验证。</p>}</section>
  </div>}</details>;
}

function PortfolioEntries({ data }: { data: FamilyPortfolioData }) {
  const [goal, setGoal] = useState("");
  const [visibleCount, setVisibleCount] = useState(6);
  const goalKey = (entry: FamilyPortfolioEntry) => JSON.stringify(entry.snapshot?.objectiveId ?? null);
  const objectives = new Map(data.entries.map((entry) => [goalKey(entry), entry.snapshot ? `${entry.snapshot.objectiveTitle} · ${entry.snapshot.objectiveId.slice(0, 8)}` : "原交流目标未留存"]));
  const entries = data.entries.filter((entry) => !goal || goalKey(entry) === goal);
  return <>
    <label className={styles.selector}>作品集学习目标<select value={goal} onChange={(event) => { setGoal(event.target.value); setVisibleCount(6); }}><option value="">全部目标</option>{goal && !objectives.has(goal) && <option value={goal}>先前选择的目标在当前范围无作品</option>}{[...objectives].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
    <p>{entries.length} 份作品 · {entries.filter((entry) => !!entry.confirmedAt).length} 份有交流确认 · {entries.filter((entry) => entry.work.reviewed).length} 份经教师评价。多次提交分别保留，作品数不等于实际交流次数。</p>
    {!data.entries.length ? <p className="empty-state">该学生还没有家庭交流作品。提交文字或录音后会显示在这里。</p> : !entries.length ? <p className="empty-state">当前目标没有匹配的作品，可切换为全部目标。</p> : <div className={styles.list}>{entries.slice(0, visibleCount).map((entry) => <PortfolioWork key={entry.work.id} entry={entry}/>)}</div>}
    {entries.length > visibleCount && <button type="button" className="soft-button" onClick={() => setVisibleCount(visibleCount + 6)}>查看更多作品（还有 {entries.length - visibleCount} 份）</button>}
  </>;
}

const portfolioKey = (studentId: string, revision: string, retry: number) => JSON.stringify([studentId, revision, retry]);

export function FamilyPortfolio({ studentId, revision }: { studentId?: string; revision: string }) {
  const [selectedId, setSelectedId] = useState("");
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: FamilyPortfolioData | null; error: string }>({ key: "", data: null, error: "" });
  const requestedId = studentId ?? selectedId;
  const requestKey = portfolioKey(requestedId, revision, retry);
  useEffect(() => {
    if (studentId === "" || result.key === requestKey) return;
    const controller = new AbortController();
    let active = true;
    fetch(`/api/v1/family-portfolio${requestedId ? `?studentId=${encodeURIComponent(requestedId)}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as FamilyPortfolioData & { error?: string };
        if (!response.ok) throw new Error(payload.error === "password_change_required" ? "请返回工作区完成初始密码修改后再读取作品集。" : [401, 403, 404].includes(response.status) ? "当前无法读取所选学生的作品集，请核对账号及授权范围。" : "作品集暂时无法读取，请重试。", { cause: response.status });
        if (requestedId && payload.student?.id !== requestedId) throw new Error("返回的作品与当前选择不一致，请重试。", { cause: 404 });
        return payload;
      }).then((data) => {
        if (!active) return;
        const committedId = requestedId || data.student?.id || "";
        if (studentId === undefined && !requestedId && committedId) setSelectedId(committedId);
        setResult({ key: portfolioKey(committedId, revision, retry), data, error: "" });
      }).catch((reason) => {
        if (!active) return;
        const denied = reason instanceof Error && [401, 403, 404].includes(Number(reason.cause));
        setResult((previous) => ({ key: requestKey, data: denied ? null : previous.data, error: reason instanceof Error && typeof reason.cause === "number" ? reason.message : "作品集暂时无法读取，请重试。" }));
      });
    return () => { active = false; controller.abort(); };
  }, [requestedId, revision, retry, studentId, requestKey, result.key]);
  const current = result.key === requestKey;
  const shownData = result.data && (!requestedId || result.data.student?.id === requestedId) ? result.data : null;
  return <section className={`panel ${styles.section}`} aria-label="家庭交流作品集" aria-busy={!current && studentId !== ""}>
    <h3>家庭交流作品集{shownData?.student ? ` · ${shownData.student.displayName}` : ""}</h3><p>按学习目标回看完整交流作品，保留实际对象、帮助及原始要求，并追溯后续迁移证据。交流确认与语言评价分别记录，不用完成情况推断能力提升。</p>
    {studentId === "" ? <p className="empty-state">请先选择孩子，再查看作品集。</p> : <>
      {studentId === undefined && <label className={styles.selector}>作品集学生<select value={requestedId} onChange={(event) => setSelectedId(event.target.value)}><option value="" disabled>请选择学生</option>{requestedId && !result.data?.students.some((item) => item.id === requestedId) && <option value={requestedId}>当前选择暂不可读取</option>}{result.data?.students.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.id.slice(0, 8)}</option>)}</select></label>}
      {!current && <p role="status">{shownData ? "正在刷新，以下保留上次读取的作品。" : "正在读取所选学生的作品…"}</p>}
      {current && result.error && <div role="alert"><p>{result.error}{shownData ? " 已保留上次读取的作品及筛选。" : ""}</p><div className={styles.actions}><button type="button" className="soft-button" onClick={() => setRetry(retry + 1)}>重试读取作品集</button>{studentId === undefined && requestedId && <button type="button" className="soft-button" onClick={() => { setSelectedId(""); setRetry(retry + 1); }}>重新读取学生列表</button>}</div></div>}
      {shownData && <><p className={styles.timestamp}>读取于 {sequenceTime(shownData.generatedAt)}</p>{shownData.student ? <PortfolioEntries key={shownData.student.id} data={shownData}/> : <p className="empty-state">当前没有可读学生，请先完成学生入班或家庭绑定。</p>}</>}
    </>}
  </section>;
}
