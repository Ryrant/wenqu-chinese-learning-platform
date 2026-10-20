"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { SectionHeading, EmptyState } from "./components/workspace-ui";

import { useEffect, useState } from "react";
import { WorkEvidence } from "./learning-sequences";
import { sequenceTime } from "./lib/learning-sequence-types";
import { FOLLOWUP_LABELS, type FollowupAction, type TeachingFollowupData } from "./lib/teaching-followup-types";
import styles from "./teaching-followups.module.css";

import { initialFollowupView, type FollowupView } from "./features/teacher/followup-view";
export { initialFollowupView, type FollowupView } from "./features/teacher/followup-view";
const actionLabels = { review: "打开对应作品批阅", sequence: "查看任务组与教学安排", source: "安排练习与迁移", assignment: "查看本班目标任务" };

export function TeachingFollowups({ revision, view, onView, onOpen }: {
  revision: string; view: FollowupView; onView: (view: FollowupView) => void; onOpen: (action: FollowupAction) => Promise<void>;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: TeachingFollowupData | null; error: string }>({ key: "", data: null, error: "" });
  const [opening, setOpening] = useState("");
  const [actionError, setActionError] = useState("");
  const requestKey = JSON.stringify([revision, retry]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch("/api/v1/teaching-followups", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as TeachingFollowupData & { error?: string };
      if (!response.ok) throw new Error(payload.error === "password_change_required" ? "请返回工作区完成初始密码修改后再读取待办。"
        : [401, 403, 404].includes(response.status) ? "当前无法读取教学待办，请核对账号与任教范围。" : "教学待办暂时无法读取，请重试。", { cause: response.status });
      return payload;
    }).then((data) => { if (active) setResult({ key: requestKey, data, error: "" }); }).catch((reason) => {
      if (!active) return;
      const denied = reason instanceof Error && [401, 403, 404].includes(Number(reason.cause));
      setResult((previous) => ({ key: requestKey, data: denied ? null : previous.data,
        error: reason instanceof Error && typeof reason.cause === "number" ? reason.message : "教学待办暂时无法读取，请重试。" }));
    });
    return () => { active = false; controller.abort(); };
  }, [requestKey]);
  const data = result.data;
  const refreshing = result.key !== requestKey;
  const students = data?.students.filter((item) => !view.classId || item.classIds.includes(view.classId)) ?? [];
  const objectives = data?.objectives.filter((item) => !view.classId || item.classIds.includes(view.classId)) ?? [];
  const items = data?.items.filter((item) => (!view.classId || item.classId === view.classId) && (!view.studentId || item.studentId === view.studentId)
    && (!view.kind || item.kind === view.kind) && (!view.goal || (view.goal === "null" ? !item.goals.length : item.goals.some((goal) => JSON.stringify(goal.id) === view.goal)))) ?? [];
  const shown = items.slice(0, view.visibleCount);
  const selected = shown.find((item) => item.id === view.selectedId);
  const change = (patch: Partial<FollowupView>) => { onView({ ...view, ...patch, selectedId: "", visibleCount: 12 }); setActionError(""); };
  return <Card className={`gap-0 p-6 ${styles.section}`} id="teacher-followups" aria-label="班级证据待办" aria-busy={refreshing}>
    <SectionHeading title="教学待办" description="跟进待评价作品与下一阶段任务。" action={<Button type="button" variant="outline" disabled={refreshing} onClick={() => setRetry(retry + 1)}>刷新待办</Button>}/>
    <div className={styles.filters}>
      <label>待办班级<NativeSelect className="w-full" value={view.classId} onChange={(event) => change({ classId: event.target.value, studentId: "", goal: "" })}><option value="">全部任教班级</option>{view.classId && !data?.classes.some((item) => item.id === view.classId) && <option value={view.classId}>{refreshing && !data ? "正在读取所选班级…" : "先前班级在当前范围不可读取"}</option>}{data?.classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(0, 8)}</option>)}</NativeSelect></label>
      <label>待办学生<NativeSelect className="w-full" value={view.studentId} onChange={(event) => change({ studentId: event.target.value })}><option value="">全部学生</option>{view.studentId && !students.some((item) => item.id === view.studentId) && <option value={view.studentId}>{refreshing && !data ? "正在读取所选学生…" : "先前学生在当前范围无记录"}</option>}{students.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(0, 8)}</option>)}</NativeSelect></label>
      <label>待办目标<NativeSelect className="w-full" value={view.goal} onChange={(event) => change({ goal: event.target.value })}><option value="">全部目标</option>{view.goal && view.goal !== "null" && !objectives.some((item) => JSON.stringify(item.id) === view.goal) && <option value={view.goal}>{refreshing && !data ? "正在读取所选目标…" : "先前目标在当前范围无记录"}</option>}{objectives.map((item) => <option key={item.id} value={JSON.stringify(item.id)}>{item.title} · {item.id.slice(0, 8)}</option>)}<option value="null">目标关联未留存</option></NativeSelect></label>
      <label>待办状态<NativeSelect className="w-full" value={view.kind} onChange={(event) => change({ kind: event.target.value })}><option value="">全部状态</option>{Object.entries(FOLLOWUP_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</NativeSelect></label>
    </div>
    {refreshing ? <p role="status">{data ? "正在刷新，以下保留上次读取的待办。" : "正在读取完整班级证据…"}</p> : result.error && <div role="alert"><p>{result.error}{data ? " 已保留上次读取的事项和筛选。" : ""}</p><Button type="button" variant="outline" onClick={() => setRetry(retry + 1)}>重试读取待办</Button></div>}
    {data && <><p className={styles.meta}>读取于 {sequenceTime(data.generatedAt)} · 共 {data.items.length} 条事项；当前筛选 {items.length} 条，涉及 {new Set(items.map((item) => item.studentId)).size} 名学生、{new Set(items.flatMap((item) => item.goals.map((goal) => goal.id))).size} 个目标。</p>
      {!data.items.length ? <EmptyState title="当前没有待办" description="新的待评价作品与阶段任务会显示在这里。"/>
        : !items.length ? <p className="empty-state">当前筛选没有匹配事项。<Button type="button" variant="outline" onClick={() => onView(initialFollowupView)}>清除筛选</Button></p>
        : <ul className={styles.list}>{shown.map((item) => <li key={item.id} className={styles.item}>
          <div className={styles.identity}><strong>{item.studentName} · {item.className}</strong><Badge variant="secondary">{FOLLOWUP_LABELS[item.kind]}</Badge></div>
          <p>{item.goals.length ? item.goals.map((goal) => goal.title).join("、") : "目标关联未留存"} · {item.title}</p>
          <div className={styles.row}><small>{item.time ? `${sequenceTime(item.time)} · ` : ""}{item.id.replace(/^(work|sequence|goal):/, "").slice(0, 8)}</small>
            <Button type="button" variant="outline" aria-expanded={selected?.id === item.id} onClick={() => { onView({ ...view, selectedId: selected?.id === item.id ? "" : item.id }); setActionError(""); }}>{selected?.id === item.id ? "收起依据" : "查看依据"}</Button></div>
          {selected?.id === item.id && <div className={styles.detail}><p>{item.detail}</p>{item.work && <WorkEvidence key={item.work.id} work={item.work} objectiveId={item.goals.length === 1 ? item.goals[0].id : undefined}/>}
            <Button type="button"  disabled={!!opening} onClick={async () => {
              if (opening) return; setOpening(item.id); setActionError("");
              try { await onOpen(item.action); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "暂时无法打开，请重试，筛选与依据已保留。"); }
              finally { setOpening(""); }
            }}>{opening === item.id ? "正在打开…" : actionLabels[item.action.kind]}</Button>
            {actionError && <p role="alert">{actionError}</p>}
          </div>}
        </li>)}</ul>}
      {items.length > view.visibleCount && <Button type="button" variant="outline" onClick={() => onView({ ...view, visibleCount: view.visibleCount + 12 })}>查看更多事项（还有 {items.length - view.visibleCount} 条）</Button>}
    </>}
  </Card>;
}
