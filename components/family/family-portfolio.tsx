import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading, EmptyState } from "../workspace/workspace-ui";

import { useEffect, useRef, useState } from "react";
import { FamilyWorkEvidence } from "./family-task-guide";
import { WorkEvidence } from "../learning/learning-sequences";
import { UnitReportLink } from "../learning/unit-report-links";
import { familyConfirmationLabel, type FamilyPortfolioData, type FamilyPortfolioEntry } from "../../lib/family-portfolio-types";
import { HELP_LEVEL_LABELS, sequenceTime } from "../../lib/learning-sequence-types";
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
      </section>
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
    <label className={styles.selector}>作品集学习目标<NativeSelect className="w-full" value={goal} onChange={(event) => { setGoal(event.target.value); setVisibleCount(6); }}><option value="">全部目标</option>{goal && !objectives.has(goal) && <option value={goal}>先前选择的目标在当前范围无作品</option>}{[...objectives].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</NativeSelect></label>
    <div className="flex flex-wrap gap-2"><Badge variant="secondary">{entries.length} 份作品</Badge><Badge variant="outline">{entries.filter((entry) => !!entry.confirmedAt).length} 份已确认交流</Badge><Badge variant="outline">{entries.filter((entry) => entry.work.reviewed).length} 份已评价</Badge></div>
    {!data.entries.length ? <EmptyState title="还没有交流作品" description="提交文字或录音后，可在这里回看作品和教师反馈。"/> : !entries.length ? <EmptyState title="当前目标没有作品" action={<Button variant="outline" onClick={() => setGoal("")}>查看全部目标</Button>}/> : <div className={styles.list}>{entries.slice(0, visibleCount).map((entry) => <PortfolioWork key={entry.work.id} entry={entry}/>)}</div>}
    {entries.length > visibleCount && <Button type="button" variant="outline" onClick={() => setVisibleCount(visibleCount + 6)}>查看更多作品（还有 {entries.length - visibleCount} 份）</Button>}
  </>;
}

const portfolioKey = (studentId: string, revision: string, retry: number) => JSON.stringify([studentId, revision, retry]);

export function FamilyPortfolio({ studentId, revision }: { studentId?: string; revision: string }) {
  const [selectedId, setSelectedId] = useState("");
  const automaticStudent = useRef("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{ key: string; data: FamilyPortfolioData | null; error: string }>({ key: "", data: null, error: "" });
  const requestedId = studentId ?? selectedId;
  const requestKey = portfolioKey(requestedId, revision, retry);
  useEffect(() => {
    if (studentId === "") return;
    // Activity 隐藏时清理 Effect，恢复后重新读取，但保留筛选及已展开作品。
    // 首次由服务端选择的学生保留为读取目标，避免自动选择引发第二次请求。
    const targetId = requestedId || automaticStudent.current;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    fetch(`/api/v1/family-portfolio${targetId ? `?studentId=${encodeURIComponent(targetId)}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as FamilyPortfolioData & { error?: string };
        if (!response.ok) throw new Error(payload.error === "password_change_required" ? "请返回工作区完成初始密码修改后再读取作品集。" : [401, 403, 404].includes(response.status) ? "当前无法读取所选学生的作品集，请核对账号及授权范围。" : "作品集暂时无法读取，请重试。", { cause: response.status });
        if (targetId && payload.student?.id !== targetId) throw new Error("返回的作品与当前选择不一致，请重试。", { cause: 404 });
        return payload;
      }).then((data) => {
        if (!active) return;
        if (studentId === undefined && !requestedId) automaticStudent.current = data.student?.id || "";
        setResult({ key: requestKey, data, error: "" });
        setLoading(false);
      }).catch((reason) => {
        if (!active) return;
        const denied = reason instanceof Error && [401, 403, 404].includes(Number(reason.cause));
        setResult((previous) => ({ key: requestKey, data: denied ? null : previous.data, error: reason instanceof Error && typeof reason.cause === "number" ? reason.message : "作品集暂时无法读取，请重试。" }));
        setLoading(false);
      });
    return () => { active = false; controller.abort(); };
  }, [requestedId, studentId, requestKey]);
  const current = result.key === requestKey && !loading;
  const shownData = result.data && (!requestedId || result.data.student?.id === requestedId) ? result.data : null;
  return <Card className={`gap-0 p-6 ${styles.section}`} aria-label="家庭交流作品集" aria-busy={!current && studentId !== ""}>
    <SectionHeading title={`家庭交流作品集${shownData?.student ? ` · ${shownData.student.displayName}` : ""}`} description="回看交流作品、帮助记录与教师反馈。"/>
    {studentId === "" ? <p className="empty-state">请先选择孩子，再查看作品集。</p> : <>
      {studentId === undefined && <label className={styles.selector}>作品集学生<NativeSelect className="w-full" value={requestedId || shownData?.student?.id || ""} onChange={(event) => setSelectedId(event.target.value)}><option value="" disabled>请选择学生</option>{requestedId && !result.data?.students.some((item) => item.id === requestedId) && <option value={requestedId}>当前选择暂不可读取</option>}{result.data?.students.map((student) => <option key={student.id} value={student.id}>{student.displayName} · {student.id.slice(0, 8)}</option>)}</NativeSelect></label>}
      {!current && <p role="status">{shownData ? "正在刷新，以下保留上次读取的作品。" : "正在读取所选学生的作品…"}</p>}
      {current && result.error && <div role="alert"><p>{result.error}{shownData ? " 已保留上次读取的作品及筛选。" : ""}</p><div className={styles.actions}><Button type="button" variant="outline" onClick={() => setRetry(retry + 1)}>重试读取作品集</Button>{studentId === undefined && (requestedId || automaticStudent.current) && <Button type="button" variant="outline" onClick={() => { automaticStudent.current = ""; setSelectedId(""); setRetry(retry + 1); }}>重新读取学生列表</Button>}</div></div>}
      {shownData && <><p className={styles.timestamp}>读取于 {sequenceTime(shownData.generatedAt)}</p>{shownData.student ? <PortfolioEntries key={shownData.student.id} data={shownData}/> : <p className="empty-state">当前没有可读学生，请先完成学生入班或家庭绑定。</p>}</>}
    </>}
  </Card>;
}
