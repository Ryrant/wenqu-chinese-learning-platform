import { useEffect, useRef, useState } from "react";
import { stringValue } from "@/lib/platform-types";
import { enrollmentDraftView, type EnrollmentDraft } from "@/lib/workspace/enrollment-draft";
import { errorMessage } from "@/lib/workspace/access-error";
import { ApiError } from "@/lib/workspace/api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { LoopProps } from "@/lib/learning-display";

export function AdminEnrollmentEditor({ data, act, notify, refresh }: LoopProps & { refresh: () => Promise<void> }) {
  const [selectedClassId, setClassId] = useState(String(data.classes[0]?.id ?? ""));
  const classId = data.classes.some((item) => String(item.id) === selectedClassId) ? selectedClassId : String(data.classes[0]?.id ?? "");
  const currentIds = data.enrollments.filter((item) => String(item.classId) === classId && item.status === "active").map((item) => String(item.studentUserId));
  const students = data.members.filter((item) => stringValue(item.roles, "").split(",").includes("student") || currentIds.includes(item.id));
  const selectableIds = students.filter((item) => item.status === "active" && stringValue(item.roles, "").split(",").includes("student")).map((item) => item.id);
  const unavailableIds = currentIds.filter((id) => !selectableIds.includes(id));
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [serverConflict, setServerConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const view = enrollmentDraftView(classId, currentIds, draft, selectableIds);
  const conflict = view.conflict || serverConflict;
  const locked = saving || view.pendingRead;

  useEffect(() => {
    // 保存后的读取已确认同一份名单，才释放草稿；读取失败时仍保留用户的选择。
    if (draft?.classId === classId && !view.dirty && !view.pendingRead) setDraft(null);
  }, [classId, draft, view.dirty, view.pendingRead]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || view.pendingRead || conflict || !classId) return;
    submitting.current = true; setSaving(true);
    try {
      await act("set_class_enrollments", { classId, studentUserIds: view.studentUserIds, expectedStudentUserIds: view.expectedStudentUserIds });
      // 写入已成功，旧缓存不再是编辑基线；读回确认前锁定这次名单，避免与自己的保存冲突。
      setDraft({ classId, baseIds: view.studentUserIds, studentUserIds: view.studentUserIds, awaitingRead: true });
      notify("班级名单已保存", "未勾选的学生已从该班停用。");
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "enrollment_conflict") setServerConflict(true);
      notify("编班保存失败", errorMessage(reason), "error");
    } finally { submitting.current = false; setSaving(false); }
  }

  async function adoptLatest() {
    if (submitting.current) return;
    submitting.current = true; setSaving(true);
    try {
      await refresh();
      setDraft(null); setServerConflict(false);
    } catch (reason) {
      notify("名单读取失败", errorMessage(reason), "error");
    } finally { submitting.current = false; setSaving(false); }
  }

  return <form className="panel form-card enrollment-editor" onSubmit={submit}>
    <div><h3>班级编班</h3><p>保存后以勾选的正常学生更新完整名单，未勾选及不可用学生将移出该班。</p></div>
    <label>班级<NativeSelect className="w-full" value={classId} disabled={locked} onChange={(event) => { setClassId(event.target.value); setDraft(null); setServerConflict(false); }} required>{data.classes.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.name)}</option>)}</NativeSelect></label>
    <div className="check-list">{students.map((student) => {
      const id = String(student.id);
      const available = selectableIds.includes(id);
      return <label key={id}><input type="checkbox" checked={view.studentUserIds.includes(id)} disabled={locked || !available} onChange={(event) => setDraft({ classId, baseIds: view.expectedStudentUserIds, studentUserIds: event.target.checked ? [...view.studentUserIds, id] : view.studentUserIds.filter((value) => value !== id) })}/><span>{student.displayName}<small>{student.email}{!available && (currentIds.includes(id) ? " · 已停用或无学生资格，当前仍在班，保存时移出" : " · 已停用，不能编班")}</small></span></label>;
    })}</div>
    {!students.length && <p className="empty-state">请先创建学生成员。</p>}
    {unavailableIds.some((id) => !students.some((student) => student.id === id)) && <p role="status">当前名单包含已不可用账号，保存时将移出：{unavailableIds.filter((id) => !students.some((student) => student.id === id)).join("、")}</p>}
    {view.pendingRead && <div className="form-error" role="alert"><p>名单已保存，尚未读取到保存后的名单。请先重新读取，再继续编班。</p><Button type="button" variant="outline" disabled={saving} onClick={adoptLatest}>{saving ? "正在读取…" : "重新读取名单"}</Button></div>}
    {conflict && <div className="form-error" role="alert"><p>班级名单已被其他会话修改。当前选择已保留，请读取最新名单后重新编班。</p><Button type="button" variant="outline" disabled={saving} onClick={adoptLatest}>{saving ? "正在读取…" : "采用最新名单"}</Button></div>}
    <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={!classId || locked || conflict}>{saving ? "正在保存…" : "保存班级名单"}</Button>
  </form>;
}

export default AdminEnrollmentEditor;
