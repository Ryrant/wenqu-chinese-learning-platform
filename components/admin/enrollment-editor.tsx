import { useState } from "react";
import { stringValue } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { LoopProps } from "@/lib/learning-display";

export function AdminEnrollmentEditor({ data, act, notify }: LoopProps) {
  const students = data.members.filter((item) => stringValue(item.roles, "").split(",").includes("student"));
  const initialClassId = String(data.classes[0]?.id ?? "");
  const enrolledIds = (nextClassId: string) => data.enrollments.filter((item) => String(item.classId) === nextClassId && item.status === "active").map((item) => String(item.studentUserId));
  const [classId, setClassId] = useState(initialClassId);
  const [studentUserIds, setStudentUserIds] = useState<string[]>(() => enrolledIds(initialClassId));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await act("set_class_enrollments", { classId, studentUserIds });
      notify("班级名单已保存", "未勾选的学生已从该班停用。");
    } catch (reason) {
      notify("编班保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
  }

  return <form className="panel form-card enrollment-editor" onSubmit={submit}>
    <div><h3>班级编班</h3></div>
    <label>班级<NativeSelect className="w-full" value={classId} onChange={(event) => { const nextClassId = event.target.value; setClassId(nextClassId); setStudentUserIds(enrolledIds(nextClassId)); }} required>{data.classes.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.name)}</option>)}</NativeSelect></label>
    <div className="check-list">{students.map((student) => {
      const id = String(student.id);
      return <label key={id}><input type="checkbox" checked={studentUserIds.includes(id)} onChange={(event) => setStudentUserIds(event.target.checked ? [...studentUserIds, id] : studentUserIds.filter((value) => value !== id))}/><span>{student.displayName}<small>{student.email}</small></span></label>;
    })}</div>
    {!students.length && <p className="empty-state">请先创建学生成员。</p>}
    <Button type="submit" className="h-auto min-h-10 whitespace-normal" disabled={!classId}>保存班级名单</Button>
  </form>;
}

export default AdminEnrollmentEditor;
