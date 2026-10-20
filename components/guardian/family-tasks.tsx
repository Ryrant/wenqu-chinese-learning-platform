import { useState } from "react";
import { numberValue, stringValue } from "@/lib/platform-types";
import { createFamilyPlan, EXCHANGE_PARTNERS, FAMILY_TASK_TEMPLATES, readFamilyPlan, type ExchangePartner } from "@/lib/family-task";
import { FamilyExchangeConfirmation, FamilyTaskGuide, FamilyWorkEvidence } from "@/components/family/family-task-guide";
import { FamilyFeedbackPanel } from "@/components/family/family-feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import type { LoopProps } from "@/lib/learning-display";
import { dueLabel, fullDateLabel } from "@/lib/learning-display";

export function GuardianFamilyTasks({ data, act, notify }: LoopProps) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [objectiveId, setObjectiveId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(createFamilyPlan);
  const [templateChanged, setTemplateChanged] = useState(false);
  const [editingRevision, setEditingRevision] = useState<number | undefined>(undefined);
  const tasks = data.recommendations.filter((item) => item.source_type === "family");
  const assignments = data.assignments.filter((item) => item.status === "published");
  const selectedAssignment = assignments.find((item) => item.id === assignmentId) ?? assignments[0];
  const objectiveIds = stringValue(selectedAssignment?.objectiveIds, "").split(",");
  const objectives = data.learningObjectives.filter((item) => objectiveIds.includes(String(item.id)));
  const selectedObjectiveId = objectives.some((item) => item.id === objectiveId) ? objectiveId : String(objectives[0]?.id ?? "");
  const targetLocked = !!editingId && data.submissions.some((item) => item.family_task_id === editingId);

  function resetForm() { setTitle(""); setDetail(""); setDueAt(""); setAssignmentId(""); setObjectiveId(""); setEditingId(""); setPlan(createFamilyPlan()); setTemplateChanged(false); setEditingRevision(undefined); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data.selectedStudent || !selectedAssignment || !selectedObjectiveId) return notify("无法创建任务", "请先选择孩子、已发布教学作业与练习目标。", "error");
    setBusy(true);
    try {
      await act(editingId ? "update_family_task" : "create_family_task", { id: editingId || undefined, studentUserId: data.selectedStudent.id, assignmentId: selectedAssignment.id, objectiveId: selectedObjectiveId, title, detail, dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        ...(!editingId || templateChanged ? { templateId: plan.template?.id ?? "" } : {}), partner: plan.partner, revision: editingRevision });
      resetForm();
      notify(editingId ? "亲子任务已更新" : "亲子任务已创建", "孩子可在学习任务中选择这项家庭任务并提交作品。");
    } catch (reason) { notify("任务保存失败", reason instanceof Error && reason.message === "family_task_changed" ? "任务已被更新，请重新进入编辑后核对；当前输入仍保留。" : reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  return <section className="loop-grid">
    <form className="panel form-card" onSubmit={submit}>
      <div><h3>{editingId ? "编辑家庭任务" : "安排家庭任务"}</h3><p className="form-context">任务对象：<strong>{data.selectedStudent?.displayName ?? "尚未选择孩子"}</strong></p></div>
      <label>交流模板 / Conversation template<NativeSelect className="w-full" value={plan.template?.id ?? ""} disabled={busy} onChange={(event) => {
        const next = createFamilyPlan(event.target.value, plan.partner); setPlan(next); setTemplateChanged(true);
        if (next.template) { setTitle(next.template.title.zh); setDetail(next.template.work.zh); }
      }}><option value="">自定义任务 / Custom task</option>{FAMILY_TASK_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.title.zh} / {item.title.en}</option>)}</NativeSelect></label>
      <label>关联教学作业 / Course assignment<NativeSelect className="w-full" value={selectedAssignment ? String(selectedAssignment.id) : ""} required disabled={busy || targetLocked} onChange={(event) => { setAssignmentId(event.target.value); setObjectiveId(""); }}><option value="">请选择作业 / Select an assignment</option>{assignments.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.title)}</option>)}</NativeSelect></label>
      <label>练习目标 / Learning goal<NativeSelect className="w-full" value={selectedObjectiveId} required disabled={busy || targetLocked} onChange={(event) => setObjectiveId(event.target.value)}><option value="">请选择目标 / Select a goal</option>{objectives.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.title)}</option>)}</NativeSelect></label>
      {targetLocked && <p>已有学生作品，教学作业与目标保持不变。</p>}
      <label>建议交流对象 / Suggested partner<NativeSelect className="w-full" value={plan.partner} disabled={busy} onChange={(event) => setPlan({ ...plan, partner: event.target.value as ExchangePartner })}>{Object.entries(EXCHANGE_PARTNERS).map(([value, label]) => <option key={value} value={value}>{label.zh} / {label.en}</option>)}</NativeSelect></label>
      <small>家人不便参与时，可由同伴或教师一起交流。</small>
      <label>任务名称 / Task title<Input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} required maxLength={120}/></label>
      <label>任务说明 / Instructions<Textarea value={detail} disabled={busy} onChange={(event) => setDetail(event.target.value)} required maxLength={1000}/></label>
      <label>截止时间 / Due date<Input type="datetime-local" value={dueAt} disabled={busy} onChange={(event) => setDueAt(event.target.value)}/></label>
      {plan.template && <FamilyTaskGuide plan={plan} title="模板步骤与提问卡 / Template guide"/>}
      <div className="form-actions">{editingId && <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={busy} onClick={resetForm}>取消编辑 / Cancel</Button>}<Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={busy || !data.selectedStudent || !selectedAssignment || !selectedObjectiveId}>{busy ? "保存中… / Saving…" : editingId ? "保存修改 / Save changes" : "发送给孩子 / Send to child"}</Button></div>
      {!assignments.length && <p>请先由教师向孩子所在班级发布关联目标的教学作业。</p>}
    </form>
    <Card className="panel">
      <h3>家庭任务与学生作品</h3>
      {tasks.length ? tasks.map((item) => {
        const works = data.submissions.filter((work) => work.family_task_id === item.id);
        return <section className="family-task-record" key={String(item.id)}>
          <strong>{stringValue(item.title)}</strong><p>{stringValue(item.detail, "暂无任务说明")}</p><small>{stringValue(item.objectiveTitle, "尚未关联目标")} · {dueLabel(item.due_at)} · {item.status === "completed" ? "已完成" : "待完成"} · 更新于 {fullDateLabel(item.updated_at ?? item.created_at)}</small>
          <FamilyTaskGuide plan={readFamilyPlan(item.family_plan_json)} objectiveTitle={stringValue(item.objectiveTitle, "")}/>
          <div className="row-actions"><Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" disabled={busy} onClick={() => {
            setEditingId(String(item.id)); setTitle(stringValue(item.title, "")); setDetail(stringValue(item.detail, "")); setAssignmentId(stringValue(item.assignment_id, "")); setObjectiveId(stringValue(item.objective_id, ""));
            const saved = readFamilyPlan(item.family_plan_json); setPlan(saved ?? createFamilyPlan()); setEditingRevision(saved?.revision ?? 0); setTemplateChanged(false);
            const date = typeof item.due_at === "string" ? new Date(item.due_at) : null;
            setDueAt(date && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
          }}>编辑</Button>{item.status === "completed" && <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" onClick={async () => {
            try { await act("update_recommendation_status", { id: item.id, status: "pending" }); notify("任务已重新打开", "孩子可以提交新作品，原有评价保留。"); }
            catch (reason) { notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error"); }
          }}>重新打开</Button>}<Button variant="ghost" className="h-auto min-h-10 whitespace-normal text-destructive" type="button" onClick={async () => {
            try { await act("archive_family_task", { id: item.id }); notify("任务已归档", "历史作品与评价仍保留。"); }
            catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); }
          }}>归档任务</Button></div>
          {!works.length && <p>{item.assignment_id ? "等待孩子提交作品。" : "请编辑任务，关联教学作业与目标。"}</p>}
          {works.map((work) => <div className="family-work" key={String(work.id)}>
            <FamilyWorkEvidence value={work.family_snapshot_json}/>
            {work.asset_key ? <audio controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(String(work.id))}/audio`} aria-label="孩子的家庭录音"/> : <p>{stringValue(work.text_answer)}</p>}
            <FamilyExchangeConfirmation work={work} actor="guardian" act={act} notify={notify}/>
            {work.review_status === "reviewed" ? <p>教师评价：{numberValue(work.score)} 分 · {stringValue(work.feedback)}</p> : !!work.family_confirmed_at && <span className="status draft">待教师评价 / Awaiting teacher review</span>}
          </div>)}
        </section>;
      }) : <p className="empty-state">还没有亲子任务。</p>}
    </Card>
    <FamilyFeedbackPanel key={data.selectedStudent?.id} view="guardian" studentId={data.selectedStudent?.id ?? ""} revision={data.generatedAt} notify={notify}/>
  </section>;
}

export default GuardianFamilyTasks;
