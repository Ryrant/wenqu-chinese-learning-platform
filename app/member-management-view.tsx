import { useMemo, useRef, useState } from "react";
import type { Act, MemberRow, Notify, WorkspaceData } from "./lib/platform-types";
import { stringValue } from "./lib/platform-types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatCard, EmptyState, SectionHeading } from "./components/workspace-ui";

type Props = { data: WorkspaceData; act: Act; notify: Notify };

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  teacher: "教师",
  guardian: "家长",
  student: "学生",
};

function memberInitial(member: MemberRow) {
  return stringValue(member.displayName, stringValue(member.email, "成")).slice(0, 1).toUpperCase();
}

function readableError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "请重试";
  return message === "cannot_disable_self" ? "不能停用当前登录账号" : message;
}

export function MemberManagementView({ data, act, notify }: Props) {
  const [memberEmail, setMemberEmail] = useState("");
  const [memberDisplayName, setMemberDisplayName] = useState("");
  const [memberRole, setMemberRole] = useState("teacher");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [guardianUserId, setGuardianUserId] = useState("");
  const [studentUserIds, setStudentUserIds] = useState<string[]>([]);
  const [resetMember, setResetMember] = useState<MemberRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [editor, setEditor] = useState<"create" | "guardian" | null>(null);
  const [query, setQuery] = useState("");
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const createMemberTrigger = useRef<HTMLButtonElement | null>(null);

  const memberById = useMemo(() => new Map(data.members.map((member) => [String(member.id), member])), [data.members]);
  const uniqueGuardianLinks = useMemo(() => [...new Map(data.guardianLinks.map((link) => [
    `${link.guardianUserId}-${link.studentUserId}`,
    link,
  ])).values()], [data.guardianLinks]);
  const guardians = data.members.filter((member) => stringValue(member.roles, "").split(",").includes("guardian"));
  const students = data.members.filter((member) => stringValue(member.roles, "").split(",").includes("student"));
  const filteredMembers = data.members.filter((member) => `${member.displayName} ${member.email}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  function selectGuardian(id: string) {
    setGuardianUserId(id);
    setStudentUserIds(uniqueGuardianLinks.filter((link) => String(link.guardianUserId) === id).map((link) => String(link.studentUserId)));
  }

  async function createMember(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("create-member");
    try {
      await act("create_member", { email: memberEmail, displayName: memberDisplayName, role: memberRole, temporaryPassword });
      setMemberEmail("");
      setMemberDisplayName("");
      setTemporaryPassword("");
      setEditor(null);
      notify("成员已创建", "首次登录时需要修改临时密码。");
    } catch (reason) {
      notify("创建失败", readableError(reason), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function saveGuardianLinks(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("guardian-links");
    try {
      await act("set_guardian_links", { guardianUserId, studentUserIds });
      setStudentUserIds([]);
      setGuardianUserId("");
      setEditor(null);
      notify("监护人绑定已更新", "已保存当前监护人与学生的关联。");
    } catch (reason) {
      notify("绑定失败", readableError(reason), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function resetMemberPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetMember) return;
    const id = String(resetMember.id);
    setBusyAction(`reset:${id}`);
    try {
      await act("reset_member_password", { userId: id, temporaryPassword: resetPassword });
      setResetMember(null);
      setResetPassword("");
      notify("临时密码已重置", "该成员下次登录时必须修改密码。");
    } catch (reason) {
      notify("重置失败", readableError(reason), "error");
    } finally {
      setBusyAction("");
    }
  }

  async function changeMemberStatus(member: MemberRow) {
    const id = String(member.id);
    const disabled = member.status === "disabled";
    setBusyAction(`status:${id}`);
    try {
      await act("set_member_status", { userId: id, status: disabled ? "active" : "disabled" });
      notify("成员状态已更新", disabled ? "成员已启用。" : "成员已停用。");
    } catch (reason) {
      notify("更新失败", readableError(reason), "error");
    } finally {
      setBusyAction("");
    }
  }

  return <section className="space-y-6">
    <PageHeader title="成员管理" description="管理机构成员、账号权限与家庭关系。" actions={<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={(event) => { dialogTrigger.current = event.currentTarget; setEditor("guardian"); }}>绑定监护人</Button><Button ref={createMemberTrigger} type="button" onClick={(event) => { dialogTrigger.current = event.currentTarget; setEditor("create"); }}>创建成员</Button></div>}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="全部成员" value={data.members.length}/><StatCard label="教师" value={data.members.filter((member) => stringValue(member.roles, "").split(",").includes("teacher")).length}/><StatCard label="学生" value={students.length}/><StatCard label="监护关系" value={uniqueGuardianLinks.length}/></div>
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-col gap-4 border-b px-6 py-5 sm:flex-row sm:items-center sm:justify-between"><SectionHeading title="成员目录"/><Input aria-label="搜索成员" placeholder="搜索姓名或邮箱…" value={query} onChange={(event) => setQuery(event.target.value)} className="sm:max-w-xs"/></div>
      {filteredMembers.length ? <Table>
        <TableHeader><TableRow><TableHead className="pl-6">成员</TableHead><TableHead>角色</TableHead><TableHead>账号状态</TableHead><TableHead>密码</TableHead><TableHead className="pr-6 text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>{filteredMembers.map((member) => {
          const id = String(member.id);
          const disabled = member.status === "disabled";
          const currentMember = data.user.id === id;
          const roles = stringValue(member.roles, "").split(",").filter(Boolean);
          return <TableRow key={id}>
            <TableCell className="pl-6"><div className="flex items-center gap-3"><span className="member-avatar">{memberInitial(member)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium">{stringValue(member.displayName)}{currentMember && <Badge variant="outline">当前账号</Badge>}</div><p className="text-sm text-muted-foreground">{stringValue(member.email)}</p></div></div></TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{roles.map((role) => <Badge key={role} variant="secondary">{ROLE_LABELS[role] ?? role}</Badge>)}</div></TableCell>
            <TableCell><Badge variant={disabled ? "outline" : "secondary"}>{disabled ? "已停用" : "正常"}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{member.mustChangePassword ? "首次登录需修改" : "已设置"}</TableCell>
            <TableCell className="pr-6"><div className="flex justify-end gap-1"><Button type="button" size="sm" variant="ghost" disabled={busyAction === `reset:${id}`} onClick={(event) => { dialogTrigger.current = event.currentTarget; setResetMember(member); setResetPassword(""); }}>重置密码</Button><Button type="button" size="sm" variant="ghost" disabled={currentMember || busyAction === `status:${id}`} title={currentMember ? "当前登录账号不能停用" : undefined} className={disabled ? "" : "text-destructive"} onClick={() => changeMemberStatus(member)}>{busyAction === `status:${id}` ? "处理中…" : disabled ? "启用" : "停用"}</Button></div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table> : <EmptyState title={query ? "未找到成员" : "尚无成员"} description={query ? "尝试其他姓名或邮箱。" : "创建成员后，为其分配对应角色。"}/>}
    </Card>
    <Card><CardContent className="space-y-5"><SectionHeading title="监护关系" description="家长可访问已绑定学生的家庭任务和成长报告。" action={<Button type="button" variant="outline" size="sm" onClick={(event) => { dialogTrigger.current = event.currentTarget; setEditor("guardian"); }}>管理绑定</Button>}/>
      {uniqueGuardianLinks.length ? <div className="grid gap-3 xl:grid-cols-2">{uniqueGuardianLinks.map((link) => {
        const guardian = memberById.get(String(link.guardianUserId));
        const student = memberById.get(String(link.studentUserId));
        return <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4" key={`${link.guardianUserId}-${link.studentUserId}`}><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">监护人</p><p className="font-medium">{guardian ? stringValue(guardian.displayName) : "未知监护人"}</p><p className="break-all text-xs text-muted-foreground">{guardian ? stringValue(guardian.email) : "账号不存在"}</p></div><span className="text-muted-foreground" aria-hidden="true">→</span><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">学生</p><p className="font-medium">{student ? stringValue(student.displayName) : "未知学生"}</p><p className="break-all text-xs text-muted-foreground">{student ? stringValue(student.email) : "账号不存在"}</p></div></div>;
      })}</div> : <EmptyState title="尚未绑定监护人" description="先创建家长和学生账号，再建立家庭关系。"/>}
    </CardContent></Card>
    <Dialog open={editor === "create"} onOpenChange={(open) => { if (!open && !busyAction) setEditor(null); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (dialogTrigger.current?.isConnected ? dialogTrigger.current : createMemberTrigger.current)?.focus(); }} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"><form onSubmit={createMember} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle>创建成员</DialogTitle><DialogDescription>新成员首次登录时需要修改临时密码。</DialogDescription></DialogHeader>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-5"><label className="grid gap-2 text-sm font-medium">显示名称<Input autoComplete="name" value={memberDisplayName} onChange={(event) => setMemberDisplayName(event.target.value)} placeholder="例如：林老师" required/></label><label className="grid gap-2 text-sm font-medium">邮箱<Input type="email" autoComplete="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="member@example.com" required/></label><label className="grid gap-2 text-sm font-medium">角色<NativeSelect className="w-full" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option value="teacher">教师</option><option value="guardian">家长</option><option value="student">学生</option><option value="admin">管理员</option></NativeSelect></label><label className="grid gap-2 text-sm font-medium">临时密码<Input type="password" minLength={10} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="至少 10 个字符" required/></label></div>
      <DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" disabled={!!busyAction} onClick={() => setEditor(null)}>取消</Button><Button type="submit" disabled={busyAction === "create-member"}>{busyAction === "create-member" ? "创建中…" : "创建成员"}</Button></DialogFooter>
    </form></DialogContent></Dialog>
    <Dialog open={editor === "guardian"} onOpenChange={(open) => { if (!open && !busyAction) setEditor(null); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (dialogTrigger.current?.isConnected ? dialogTrigger.current : createMemberTrigger.current)?.focus(); }} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"><form onSubmit={saveGuardianLinks} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle>管理监护人绑定</DialogTitle><DialogDescription>保存后以本次所选学生更新该监护人的访问范围。</DialogDescription></DialogHeader>
      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5"><label className="grid gap-2 text-sm font-medium">监护人<NativeSelect className="w-full" value={guardianUserId} onChange={(event) => selectGuardian(event.target.value)} required><option value="">请选择监护人</option>{guardians.map((member) => <option key={String(member.id)} value={String(member.id)}>{stringValue(member.displayName)} · {stringValue(member.email)}</option>)}</NativeSelect></label><fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium">关联学生</legend>{students.length ? students.map((member) => {
        const id = String(member.id);
        return <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3" key={id}><input type="checkbox" className="size-4 accent-primary" disabled={!guardianUserId} checked={studentUserIds.includes(id)} onChange={(event) => setStudentUserIds(event.target.checked ? [...studentUserIds, id] : studentUserIds.filter((studentId) => studentId !== id))}/><span className="min-w-0"><span className="block text-sm font-medium">{stringValue(member.displayName)}</span><span className="block break-all text-xs text-muted-foreground">{stringValue(member.email)}</span></span></label>;
      }) : <EmptyState title="尚无学生账号" description="先创建学生，再建立监护关系。"/>}</fieldset></div>
      <DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" disabled={!!busyAction} onClick={() => setEditor(null)}>取消</Button><Button type="submit" disabled={busyAction === "guardian-links" || !guardianUserId}>{busyAction === "guardian-links" ? "保存中…" : "保存绑定"}</Button></DialogFooter>
    </form></DialogContent></Dialog>
    <Dialog open={!!resetMember} onOpenChange={(open) => { if (!open && !busyAction) { setResetMember(null); setResetPassword(""); } }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); (dialogTrigger.current?.isConnected ? dialogTrigger.current : createMemberTrigger.current)?.focus(); }} className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"><form onSubmit={resetMemberPassword} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DialogHeader className="shrink-0 border-b px-6 py-5"><DialogTitle>重置成员密码</DialogTitle><DialogDescription>{stringValue(resetMember?.displayName)} · {stringValue(resetMember?.email)}<br/>该成员下次登录时必须修改密码。</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><label className="grid gap-2 text-sm font-medium">新临时密码<Input type="password" minLength={10} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 10 个字符" required/></label></div>
      <DialogFooter className="mx-0 mb-0 shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" disabled={busyAction.startsWith("reset:")} onClick={() => { setResetMember(null); setResetPassword(""); }}>取消</Button><Button type="submit" disabled={busyAction.startsWith("reset:")}>{busyAction.startsWith("reset:") ? "重置中…" : "确认重置"}</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </section>;
}
