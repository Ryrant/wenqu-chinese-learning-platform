import { useEffect, useRef, useState } from "react";
import { stringValue } from "@/lib/platform-types";
import { enrollmentDraftView, type EnrollmentDraft } from "@/lib/workspace/enrollment-draft";
import { errorMessage } from "@/lib/workspace/access-error";
import { ApiError } from "@/lib/workspace/api";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { LoopProps } from "@/lib/learning-display";

export function AdminEnrollmentEditor({ data, act, notify, refresh }: LoopProps & { refresh: () => Promise<void> }) {
  const students = data.members.filter((item) => stringValue(item.roles, "").split(",").includes("student"));
  const [selectedClassId, setClassId] = useState(String(data.classes[0]?.id ?? ""));
  const classId = data.classes.some((item) => String(item.id) === selectedClassId) ? selectedClassId : String(data.classes[0]?.id ?? "");
  const currentIds = data.enrollments.filter((item) => String(item.classId) === classId && item.status === "active").map((item) => String(item.studentUserId));
  const [draft, setDraft] = useState<EnrollmentDraft | null>(null);
  const [serverConflict, setServerConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const view = enrollmentDraftView(classId, currentIds, draft);
  const conflict = view.conflict || serverConflict;

  useEffect(() => {
    // 保存后的读取已确认同一份名单，才释放草稿；读取失败时仍保留用户的选择。
    if (draft?.classId === classId && !view.dirty) setDraft(null);
  }, [classId, draft, view.dirty]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || conflict || !classId) return;
    submitting.current = true; setSaving(true);
    try {
      await act("set_class_enrollments", { classId, studentUserIds: view.studentUserIds, expectedStudentUserIds: view.expectedStudentUserIds });
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
    <div><h3>班级编班</h3></div>
    <label>班级<NativeSelect className="w-full" value={classId} disabled={saving} onChange={(event) => { setClassId(event.target.value); setDraft(null); setServerConflict(false); }} required>{data.classes.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.name)}</option>)}</NativeSelect></label>
    <div className="check-list">{students.map((student) => {
      const id = String(student.id);
      return <label key={id}><input type="checkbox" checked={view.studentUserIds.includes(id)} disabled={saving} onChange={(event) => setDraft({ classId, baseIds: view.expectedStudentUserIds, studentUserIds: event.target.checked ? [...view.studentUserIds, id] : view.studentUserIds.filter((value) => value !== id) })}/><span>{student.displayName}<small>{student.email}</small></span></label>;
    })}</div>
    {!students.length && <p className="empty-state">请先创建学生成员。</p>}
    {conflict && <div className="form-error" role="alert"><p>班级名单已被其他会话修改。当前选择已保留，请读取最新名单后重新编班。</p><Button type="button" variant="outline" disabled={saving} onClick={adoptLatest}>{saving ? "正在读取…" : "采用最新名单"}</Button></div>}
    <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={!classId || saving || conflict}>{saving ? "正在保存…" : "保存班级名单"}</Button>
  </form>;
}

export default AdminEnrollmentEditor;
