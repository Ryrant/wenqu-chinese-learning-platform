import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { SectionHeading, EmptyState } from "../workspace/workspace-ui";

import { useEffect, useRef, useState } from "react";
import type { FollowupAction } from "../../lib/teaching-followup-types";
import type { Act, Notify, WorkspaceData } from "../../lib/platform-types";
import { HELP_LEVEL_LABELS, TEACHING_DECISION_LABELS, sameRubric, SEQUENCE_STAGE_LABELS, sequenceTaskId, sequenceStages, sequenceStageReady, nextSequenceStage, sequencePrompt, sequenceTime, evidenceStatus, type LearningSequence, type SequenceEvidence, type SequenceSource } from "../../lib/learning-sequence-types";
import { DiagnosticStimulus } from "../diagnostic-evidence";
import { TeachingNextStepPlanner } from "../teacher/teaching-next-step";
import { TrialRecorder } from "../trial/trial-records";
import { UnitReportLink } from "./unit-report-links";
import type { TrialEntry } from "../../lib/trial-types";
import styles from "./learning-sequences.module.css";
import { RetainedFeature } from "../workspace/retained-feature";

function openSequenceReport(id: string, container: ParentNode | null) {
  const report = Array.from(container?.querySelectorAll("details[id]") ?? []).find((item) => item.id === `learning-sequence-${id}`);
  if (report instanceof HTMLDetailsElement) { report.open = true; report.scrollIntoView({ block: "start" }); }
}

export function WorkEvidence({ work, objectiveId }: { work: SequenceEvidence; objectiveId?: string }) {
  const goal = work.objectives.find((item) => item.id === objectiveId);
  return <div className={styles.work}><strong>{work.title}</strong><p>提交：{sequenceTime(work.submittedAt)} · {work.reviewed ? `评价：${work.reviewedAt ? sequenceTime(work.reviewedAt) : "时间未记录"}` : "待教师评价"}</p>
    {work.prompt && <p className={styles.copy}>要求：{work.prompt}</p>}
    {work.mediaId && <DiagnosticStimulus id={work.mediaId} kind="image"/>}
    {work.hasAudio ? <audio controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(work.id)}/audio`} aria-label={`${work.title}原始录音`}/> : <p className={styles.copy}>{work.textAnswer}</p>}
    {objectiveId ? <p>目标评价：{goal ? `${goal.score}/100` : "未评价"} · 总分：{work.score === null ? "未评价" : work.score}</p> : <><p>已有目标分项：{work.objectives.length ? work.objectives.map((item) => `${item.title} ${item.score}/100`).join("；") : "未评价"}</p><p>总分：{work.score === null ? "未评价" : work.score}</p></>}
    <ul>{(work.rubric ?? work.dimensions).map((item) => <li key={item.name}>{item.name}：{work.dimensions.find((dimension) => dimension.name === item.name)?.score ?? "未评价"}</li>)}</ul>
    <p>帮助程度：{HELP_LEVEL_LABELS[work.helpLevel]} · 提示次数：{work.promptCount ?? "未记录"}</p>{work.feedback && <p className={styles.copy}>教师反馈：{work.feedback}</p>}
    {!work.rubric && <small>历史评分量规未保留。</small>}
  </div>;
}

function ScoreComparison({ before, after, labels, sequence }: { before?: SequenceEvidence; after?: SequenceEvidence; labels: [string, string]; sequence: LearningSequence }) {
  const comparable = !!before?.reviewed && !!after?.reviewed && sameRubric(before.rubric, after.rubric);
  return <><h4>{labels[0]}与{labels[1]}的量规评价</h4>
    <p className={styles.meta}>{comparable ? "两份作品使用相同量规，差值反映本次作品表现。" : "评分量规不同、缺失或作品尚未评价，暂不计算差值。"}</p>
    <div className={styles.table}><Table><TableHeader><TableRow><TableHead>维度</TableHead><TableHead>{labels[0]}</TableHead><TableHead>{labels[1]}</TableHead><TableHead>差值</TableHead></TableRow></TableHeader><TableBody>{[...new Set([...sequence.rubric.map((item) => item.name), ...(before?.dimensions ?? []).map((item) => item.name)])].map((name) => {
      const left = before?.dimensions.find((item) => item.name === name)?.score;
      const right = after?.dimensions.find((item) => item.name === name)?.score;
      const difference = comparable && left !== undefined && right !== undefined ? Number((right - left).toFixed(2)) : null;
      return <TableRow key={name}><TableHead>{name}</TableHead><TableCell>{left ?? "未评价"}</TableCell><TableCell>{right ?? "未评价"}</TableCell><TableCell>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference}`}</TableCell></TableRow>;
    })}</TableBody></Table></div></>;
}

function RetestScheduler({ sequence, act, notify }: { sequence: LearningSequence; act: Act; notify: Notify }) {
  const [editing, setEditing] = useState(false);
  const [selectedReferenceId, setReferenceId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [availableAt, setAvailableAt] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = sequence.transfer.filter((work) => work.reviewed);
  const referenceId = selectedReferenceId || candidates[0]?.id || "";
  if (!candidates.length || sequence.retestAvailableAt) return null;
  return <div className={styles.scheduler}><Button variant="outline" type="button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "收起复测安排" : "安排延后复测"}</Button>
    {editing && <form className="form-card" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true);
      try {
        await act("schedule_delayed_retest", { sequenceId: sequence.id, referenceSubmissionId: referenceId, prompt, context, availableAt: new Date(`${availableAt}+08:00`).toISOString() });
        setEditing(false); notify("复测已安排", "开放时间与参照作品已固定，学生到时可提交。请在复测时记录实际帮助程度。");
      } catch (reason) { notify("安排失败", reason instanceof Error ? reason.message : "请重试，输入已保留。", "error"); }
      finally { setBusy(false); }
    }}><fieldset className={styles.fields} disabled={busy}>
      <label>参照迁移作品<NativeSelect className="w-full" required value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>{candidates.map((work) => <option key={work.id} value={work.id}>{work.title} · {sequenceTime(work.submittedAt)} · {work.id.slice(0, 8)}</option>)}</NativeSelect></label>
      <label>开放时间（北京时间）<Input type="datetime-local" required value={availableAt} onChange={(event) => setAvailableAt(event.target.value)}/></label>
      <label>复测任务要求<Textarea required maxLength={2000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="间隔一段时间后，在另一个对象或情境中完成新任务。"/></label>
      <label>相对参照迁移作品，情境怎样改变<Textarea required maxLength={1000} value={context} onChange={(event) => setContext(event.target.value)}/></label>
      <p>沿用“{sequence.objectiveTitle}”及本组量规，提交方式为{sequence.medium === "audio" ? "录音" : "文字"}。每组安排一次；保存后开放时间和参照作品固定。</p>
      <Button type="submit" disabled={busy}>{busy ? "保存中…" : "保存复测安排"}</Button>
    </fieldset></form>}
  </div>;
}

export function SequenceReports({ sequences, onStartTask, scheduling, trialEntries = [] }: { sequences: LearningSequence[]; onStartTask?: (id: string) => void; scheduling?: { act: Act; notify: Notify }; trialEntries?: TrialEntry[] }) {
  return <section className={styles.reports} data-sequence-reports><SectionHeading title="练习与迁移" description="对照初次作品、针对性练习与新情境中的表现。"/>
    {!sequences.length && <EmptyState title="还没有练习与迁移任务" description="教师发布任务后，可在这里查看各阶段作品。"/>}
    {sequences.map((sequence) => {
      const transfer = sequence.transfer[0];
      const reference = sequence.transfer.find((work) => work.id === sequence.retestReferenceId);
      return <details id={`learning-sequence-${sequence.id}`} className={styles.report} key={sequence.id}><summary>{sequence.title} · {sequence.studentName} · {sequence.objectiveTitle}</summary>
        <UnitReportLink sequenceId={sequence.id}/>
        {sequence.origin && <p>本组来自教师的“{TEACHING_DECISION_LABELS[sequence.origin.kind]}”安排：<a href={`#learning-sequence-${sequence.origin.sequenceId}`} onClick={(event) => { event.preventDefault(); openSequenceReport(sequence.origin!.sequenceId, event.currentTarget.closest("[data-sequence-reports]")); }}>{sequence.origin.title}</a>。初次作品采用该安排的依据作品。</p>}
        <p role="status">{evidenceStatus(transfer, sequence.objectiveId, "迁移")}</p><p className={styles.copy}>迁移情境变化：{sequence.transferContext}</p>
        {sequence.retestAvailableAt && <><p>复测开放：{sequenceTime(sequence.retestAvailableAt)} · {sequence.retestOpen ? "已开放" : "尚未开放"}</p><p className={styles.copy}>复测情境变化：{sequence.retestContext}</p><p role="status">{evidenceStatus(sequence.retest[0], sequence.objectiveId, "复测")}</p></>}
        <div className={`${styles.stages} ${sequence.retestAvailableAt ? styles.withRetest : ""}`}><section><h4>初次任务</h4><WorkEvidence work={sequence.baseline} objectiveId={sequence.objectiveId}/></section>
          {sequenceStages(sequence).map((stage) => {
            const works = sequence[stage];
            const ready = sequenceStageReady(sequence, stage);
            return <section key={stage}><h4>{SEQUENCE_STAGE_LABELS[stage]}</h4>{!works[0] && <p className={styles.copy}>{sequencePrompt(sequence, stage)}</p>}
              {works[0] ? <WorkEvidence work={works[0]} objectiveId={sequence.objectiveId}/> : <p>{ready ? "尚未提交作品" : stage === "retest" ? "到开放时间后可提交复测作品" : "练习经教师评价后开放迁移提交"}</p>}
              {works.length > 1 && <details><summary>查看其余 {works.length - 1} 次记录</summary>{works.slice(1).map((work) => <WorkEvidence key={work.id} work={work} objectiveId={sequence.objectiveId}/>)}</details>}
              {onStartTask && ready && !works.some((work) => !work.reviewed) && <Button variant="outline" type="button" onClick={() => onStartTask(sequenceTaskId(sequence.id, stage))}>{works.length ? "再次提交" : "进入任务"}</Button>}
            </section>;
          })}</div>
        <ScoreComparison sequence={sequence} before={sequence.baseline} after={transfer} labels={["初次", "迁移"]}/>
        {sequence.retestAvailableAt && <section><h4>复测的固定参照作品</h4>{reference ? <details><summary>{reference.title} · {sequenceTime(reference.submittedAt)} · {reference.id.slice(0, 8)}</summary><WorkEvidence work={reference} objectiveId={sequence.objectiveId}/></details> : <p>参照作品不可用，暂不计算差值。</p>}
          <ScoreComparison sequence={sequence} before={reference} after={sequence.retest[0]} labels={["参照迁移", "复测"]}/></section>}
        {scheduling && sequence.canScheduleRetest && <RetestScheduler sequence={sequence} {...scheduling}/>}
        <section className={styles.decisions}><h4>教师后续安排</h4>
          {!sequence.decisions.length && <p>尚未发布后续安排。</p>}
          {sequence.decisions.map((decision) => {
            const next = sequences.find((item) => item.id === decision.nextSequenceId);
            const stage = next ? nextSequenceStage(next) : null;
            return <article className={styles.decision} key={decision.id}><strong>{TEACHING_DECISION_LABELS[decision.kind]} · {decision.nextTitle}</strong>
              <p>{decision.teacherName} · {sequenceTime(decision.createdAt)}</p><p className={styles.copy}>判断理由：{decision.rationale}</p><p className={styles.copy}>仍待观察：{decision.remaining}</p>
              <details><summary>查看判断依据 · {decision.reference.title} · {decision.reference.id.slice(0, 8)}</summary><WorkEvidence work={decision.reference} objectiveId={sequence.objectiveId}/></details>
              {next ? <p><a href={`#learning-sequence-${next.id}`} onClick={(event) => { event.preventDefault(); openSequenceReport(next.id, event.currentTarget.closest("[data-sequence-reports]")); }}>查看下一轮作品与进度</a></p> : <p>下一轮任务暂不可用，请刷新后查看。</p>}
              {onStartTask && next && stage && !next[stage].some((work) => !work.reviewed) && <Button variant="outline" type="button" onClick={() => onStartTask(sequenceTaskId(next.id, stage))}>进入下一轮{SEQUENCE_STAGE_LABELS[stage]}</Button>}
              {stage && next?.[stage].some((work) => !work.reviewed) && <p>下一轮作品待教师评价。</p>}
            </article>;
          })}
          {scheduling && sequence.canPlanNext && <TeachingNextStepPlanner sequence={sequence} {...scheduling}/>}
        </section>
        {scheduling && sequence.canPlanNext && <TrialRecorder sequence={sequence} entries={trialEntries} {...scheduling}/>}
      </details>;
    })}
  </section>;
}

function SequenceCreator({ source, act, notify, onSaved, initialObjectiveId }: { source: SequenceSource; act: Act; notify: Notify; onSaved: () => void; initialObjectiveId?: string }) {
  const [objectiveId, setObjectiveId] = useState(initialObjectiveId ?? source.work.objectives[0]?.id ?? "");
  const [title, setTitle] = useState(`${source.work.title}的迁移验证`.slice(0, 120));
  const [practicePrompt, setPracticePrompt] = useState("");
  const [transferPrompt, setTransferPrompt] = useState("");
  const [transferContext, setTransferContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  return <form className="form-card" onSubmit={async (event) => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      await act("create_learning_sequence", { id: requestId, baselineSubmissionId: source.work.id, objectiveId, title, practicePrompt, transferPrompt, transferContext });
      onSaved(); notify("练习与迁移任务已发布", `${source.studentName}的“${title}”已保存；练习经教师评价后开放迁移提交。`);
    } catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试，输入已保留。", "error"); }
    finally { setBusy(false); }
  }}><fieldset className={styles.fields} disabled={busy}>
    <label>学习目标<NativeSelect className="w-full" required value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)}>{objectiveId && !source.work.objectives.some((item) => item.id === objectiveId) && <option value={objectiveId} disabled>所选目标已不可用，请重新选择</option>}{source.work.objectives.map((item) => <option key={item.id} value={item.id}>{item.title} · 初次 {item.score}/100</option>)}</NativeSelect></label>
    <label>任务组名称<Input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
    <label>针对性练习要求<Textarea required maxLength={2000} value={practicePrompt} onChange={(event) => setPracticePrompt(event.target.value)} placeholder="结合初次作品的困难，说明练什么、可以使用哪些支持。"/></label>
    <label>迁移任务要求<Textarea required maxLength={2000} value={transferPrompt} onChange={(event) => setTransferPrompt(event.target.value)} placeholder="安排不同对象或新情境中的任务，避免原题重做。"/></label>
    <label>对象或情境怎样改变<Textarea required maxLength={1000} value={transferContext} onChange={(event) => setTransferContext(event.target.value)} placeholder="例如：从向家人介绍喜欢的菜，改为向同伴推荐另一道菜并回答新问题。"/></label>
    <p>沿用同一目标及以下量规；后续作品与初次保持相同提交方式（{source.work.hasAudio ? "录音" : "文字"}）。</p>
    <ul>{source.referenceRubric.map((item) => <li key={item.name}>{item.name} · {item.weight}%</li>)}</ul>
    {!source.work.rubric && <p>初次作品未保留历史量规。后续任务固定当前所列量规，报告不会推算初次与迁移的分数差。</p>}
    <Button type="submit" disabled={busy || !source.work.objectives.some((item) => item.id === objectiveId)}>{busy ? "发布中…" : "发布练习与迁移任务"}</Button>
  </fieldset></form>;
}

function TeacherSequenceSources({ studentUserId, data, act, notify, focus, focusRequest }: { studentUserId: string; data: WorkspaceData; act: Act; notify: Notify; focus?: Extract<FollowupAction, { kind: "source" }>; focusRequest: number }) {
  const [sourceId, setSourceId] = useState(focus?.studentId === studentUserId ? focus.sourceId : "");
  const [appliedFocus, setAppliedFocus] = useState(focusRequest);
  const [visited, setVisited] = useState<string[]>([]);
  if (focus?.studentId === studentUserId && appliedFocus !== focusRequest) {
    setAppliedFocus(focusRequest); setSourceId(focus.sourceId);
  }
  const sources = (data.sequenceSources ?? []).filter((item) => item.studentUserId === studentUserId);
  const source = sources.find((item) => item.work.id === sourceId);
  if (source && !visited.includes(sourceId)) setVisited([...visited, sourceId]);
  return <><label className={styles.selector}>初次作品<NativeSelect className="w-full" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">请选择已评价目标的作品</option>{sourceId && !source && <option value={sourceId}>指定作品已不可用，请重新选择</option>}{sources.map((item) => <option key={item.work.id} value={item.work.id}>{item.work.title} · {item.work.submittedAt} · {item.work.id.slice(0, 8)}</option>)}</NativeSelect></label>
    {!sources.length && <p>当前学生还没有可关联的作品。先在原批阅面板确认至少一个目标的评价。</p>}
    {visited.map((id) => {
      const savedSource = sources.find((item) => item.work.id === id);
      return savedSource && <RetainedFeature key={id} active={sourceId === id}>
        <SequenceCreator source={savedSource} initialObjectiveId={focus?.sourceId === id ? focus.objectiveId : undefined} act={act} notify={notify} onSaved={() => {
          setSourceId((current) => current === id ? "" : current);
          setVisited((current) => current.filter((value) => value !== id));
        }}/>
      </RetainedFeature>;
    })}
  </>;
}

export function TeacherLearningSequences({ data, act, notify, focus, focusRequest = 0 }: { data: WorkspaceData; act: Act; notify: Notify; focus?: Extract<FollowupAction, { kind: "source" | "sequence" }>; focusRequest?: number }) {
  const container = useRef<HTMLElement>(null);
  const students = [...new Map([...data.enrollments.filter((item) => item.status === "active").map((item) => [String(item.studentUserId), String(item.studentName)] as const), ...(data.learningSequences ?? []).filter((item) => item.canPlanNext).map((item) => [item.studentUserId, item.studentName] as const)]).entries()];
  const [studentId, setStudentId] = useState(focus?.studentId ?? students[0]?.[0] ?? "");
  const [creating, setCreating] = useState(focus?.kind === "source");
  const [appliedFocus, setAppliedFocus] = useState(focusRequest);
  const [visited, setVisited] = useState<string[]>([]);
  if (focus && appliedFocus !== focusRequest) {
    setAppliedFocus(focusRequest); setStudentId(focus.studentId);
    if (focus.kind === "source") setCreating(true);
  }
  if (studentId && !visited.includes(studentId)) setVisited([...visited, studentId]);
  const sequenceId = focus?.kind === "sequence" ? focus.sequenceId : "";
  useEffect(() => {
    if (sequenceId) openSequenceReport(sequenceId, container.current);
    else if (focus?.kind === "source") container.current?.querySelector("#teacher-sequence-creator")?.scrollIntoView({ block: "start" });
  }, [sequenceId, focus?.kind, focusRequest, studentId]);
  return <section className={styles.section} ref={container}><Card className={`gap-0 p-6 ${styles.creator}`} id="teacher-sequence-creator"><SectionHeading title="练习与迁移安排" action={<Button variant="outline" type="button" onClick={() => setCreating(!creating)}>{creating ? "收起创建" : "新建任务"}</Button>}/>
    {sequenceId && !data.learningSequences.some((item) => item.id === sequenceId) && <p role="alert">指定任务组已不在当前任教范围，请返回待办刷新。</p>}
    <label className={styles.selector}>查看学生<NativeSelect className="w-full" value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">请选择学生</option>{studentId && !students.some(([id]) => id === studentId) && <option value={studentId}>指定学生已不可用</option>}{students.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</NativeSelect></label>
    {visited.map((id) => <RetainedFeature key={id} active={creating && studentId === id}>
      <TeacherSequenceSources studentUserId={id} data={data} act={act} notify={notify} focusRequest={focusRequest} focus={focus?.kind === "source" && focus.studentId === id ? focus : undefined}/>
    </RetainedFeature>)}
  </Card>{visited.map((id) => <RetainedFeature key={id} active={studentId === id}>
    <SequenceReports sequences={(data.learningSequences ?? []).filter((item) => item.studentUserId === id)} scheduling={{ act, notify }} trialEntries={data.trialEntries}/>
  </RetainedFeature>)}</section>;
}
