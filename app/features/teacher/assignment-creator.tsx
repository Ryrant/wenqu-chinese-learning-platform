import { useEffect, useState } from "react";
import type { FollowupAction } from "@/app/lib/teaching-followup-types";
import { stringValue } from "@/app/lib/platform-types";
import { DiagnosticMediaInput, DiagnosticStimulus } from "@/app/diagnostic-evidence";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import type { LoopProps } from "@/app/features/shared/learning-display";

export function TeacherAssignmentCreator({ data, act, notify, focus, focusRequest = 0 }: LoopProps & { focus?: Extract<FollowupAction, { kind: "assignment" }>; focusRequest?: number }) {
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState(focus?.classId ?? String(data.classes[0]?.id ?? ""));
  const [objectiveId, setObjectiveId] = useState(focus?.objectiveId ?? String(data.learningObjectives.find((item) => item.status !== "inactive")?.id ?? ""));
  const [listing, setListing] = useState({ classId: focus?.classId ?? String(data.classes[0]?.id ?? ""), focusRequest });
  // 待办只定位右侧任务列表，不覆盖左侧正在编辑的班级、目标及诊断素材。
  if (focus && listing.focusRequest !== focusRequest) setListing({ classId: focus.classId, focusRequest });
  useEffect(() => { if (focus?.classId === listing.classId) document.getElementById(`teaching-assignment-${focus.assignmentId}`)?.scrollIntoView({ block: "center" }); }, [focus, focusRequest, listing.classId]);
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [diagnosticMode, setDiagnosticMode] = useState("");
  const [diagnosticPrompt, setDiagnosticPrompt] = useState("");
  const [diagnosticMediaId, setDiagnosticMediaId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [publishingId, setPublishingId] = useState("");
  const rubric = diagnosticMode ? [{ name: "任务完成", weight: 40 }, { name: "表达清晰", weight: 35 }, { name: "组织条理", weight: 25 }] : [
    { name: "内容准确性", weight: 40 },
    { name: "语言表达", weight: 35 },
    { name: "文化理解", weight: 25 },
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await act("create_assignment", {
        title,
        classId,
        activityType: "综合任务",
        objectiveIds: [objectiveId],
        rubric,
        dueAt: dueAt || null,
        diagnosticMode, diagnosticPrompt, diagnosticMediaId,
      });
      setTitle("");
      setDiagnosticPrompt(""); setDiagnosticMediaId("");
      notify("目标任务草稿已创建", "任务关联了学习目标和三维评分量规，可审核后发布。");
    } catch (reason) {
      notify("创建失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return <section className="loop-section"><form className="panel form-card" onSubmit={submit}>
    <div><h3>创建学习任务</h3></div>
    <fieldset className="diagnostic-form-fields" disabled={busy || uploading}>
    <label>任务名称<Input value={title} onChange={(event) => setTitle(event.target.value)} required/></label>
    <label>班级<NativeSelect className="w-full" value={classId} onChange={(event) => { setClassId(event.target.value); setListing({ ...listing, classId: event.target.value }); }} required>{classId && !data.classes.some((item) => item.id === classId) && <option value={classId} disabled>指定班级已不可用，请重新选择</option>}{data.classes.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.name)}</option>)}</NativeSelect></label>
    <label>学习目标<NativeSelect className="w-full" value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required>{objectiveId && !data.learningObjectives.some((item) => item.id === objectiveId && item.status !== "inactive") && <option value={objectiveId} disabled>指定目标已不可用，请重新选择</option>}{data.learningObjectives.filter((item) => item.status !== "inactive").map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.code)} · {stringValue(item.title)}</option>)}</NativeSelect></label>
    <label>任务用途<NativeSelect className="w-full" value={diagnosticMode} disabled={busy || uploading} onChange={(event) => { setDiagnosticMode(event.target.value); setDiagnosticMediaId(""); }}><option value="">普通学习任务</option><option value="speaking">图片口述诊断</option><option value="writing">短文表达诊断</option></NativeSelect></label>
    {diagnosticMode && <><label>诊断要求<Textarea value={diagnosticPrompt} disabled={busy} onChange={(event) => setDiagnosticPrompt(event.target.value)} required maxLength={2000} placeholder="说明观察什么、需要完成什么，以及可以使用的帮助。"/></label>
      <DiagnosticMediaInput kind="image" value={diagnosticMediaId} onChange={setDiagnosticMediaId} uploading={uploading} setUploading={setUploading} notify={notify} disabled={busy}/>
      <small>{diagnosticMode === "speaking" ? "图片口述必须提供图片，学生提交录音。" : "短文表达提交文字；图片可选。"}每个目标由教师独立评价。</small></>}
    <label>截止时间<Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
    <div className="rubric-list">{rubric.map((item) => <span key={item.name}><b>{item.name}</b>{item.weight}%</span>)}</div>
    </fieldset>
    <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={busy || uploading || !data.classes.some((item) => item.id === classId) || !data.learningObjectives.some((item) => item.id === objectiveId && item.status !== "inactive") || (diagnosticMode === "speaking" && !diagnosticMediaId)}>{busy ? "保存中…" : "保存任务草稿"}</Button>
  </form><Card className="panel"><h3>本班任务与发布</h3>
    <label>查看班级<NativeSelect className="w-full" value={listing.classId} onChange={(event) => setListing({ ...listing, classId: event.target.value })}>{listing.classId && !data.classes.some((item) => item.id === listing.classId) && <option value={listing.classId}>指定班级已不可用</option>}{data.classes.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.name)}</option>)}</NativeSelect></label>
    {focus && !data.assignments.some((item) => item.id === focus.assignmentId) && <p role="alert">指定任务已不在当前任教范围，请返回待办刷新。</p>}{data.assignments.filter((item) => item.class_id === listing.classId).map((item) => <div className="assignment-publish-row" id={`teaching-assignment-${item.id}`} key={String(item.id)}>
    <strong>{stringValue(item.title)}</strong>{!!item.diagnostic_prompt && <p>{String(item.diagnostic_prompt)}</p>}
    {!!item.diagnostic_media_id && <DiagnosticStimulus id={String(item.diagnostic_media_id)} kind="image"/>}
    {item.status === "published" ? <span className="status published">已发布</span> : item.status === "draft" || item.status === "review" ? <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" disabled={!!publishingId} onClick={async () => {
      setPublishingId(String(item.id));
      try { await act("publish_assignment", { id: item.id }); notify("任务已发布", "学生可以进入诊断并提交作品。"); }
      catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); }
      finally { setPublishingId(""); }
    }}>{publishingId === item.id ? "发布中…" : "审核并发布"}</Button> : <span>{stringValue(item.status)}</span>}
  </div>)}{!data.assignments.some((item) => item.class_id === listing.classId) && <p className="empty-state">当前班级还没有任务。</p>}</Card></section>;
}

export default TeacherAssignmentCreator;
