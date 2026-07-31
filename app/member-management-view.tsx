"use client";

import { useMemo, useState } from "react";
import type { Act, MemberRow, Notify, WorkspaceData } from "./lib/platform-types";
import { stringValue } from "./lib/platform-types";

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

  const memberById = useMemo(() => new Map(data.members.map((member) => [String(member.id), member])), [data.members]);
  const uniqueGuardianLinks = useMemo(() => [...new Map(data.guardianLinks.map((link) => [
    `${link.guardianUserId}-${link.studentUserId}`,
    link,
  ])).values()], [data.guardianLinks]);
  const guardians = data.members.filter((member) => stringValue(member.roles, "").split(",").includes("guardian"));
  const students = data.members.filter((member) => stringValue(member.roles, "").split(",").includes("student"));

  async function createMember(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("create-member");
    try {
      await act("create_member", { email: memberEmail, displayName: memberDisplayName, role: memberRole, temporaryPassword });
      setMemberEmail("");
      setMemberDisplayName("");
      setTemporaryPassword("");
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

  return <section>
    <section className="welcome-row">
      <div><span className="eyebrow">租户成员与监护关系</span><h1>成员管理</h1><p>成员账号、临时密码和监护人绑定均会写入审计记录。</p></div>
    </section>

    <section className="admin-grid member-management-actions">
      <form className="panel form-card" onSubmit={createMember}>
        <div className="panel-heading"><div><span className="eyebrow">账号与角色</span><h3>创建成员</h3></div></div>
        <label>邮箱<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="member@example.com" required/></label>
        <label>显示名称<input value={memberDisplayName} onChange={(event) => setMemberDisplayName(event.target.value)} placeholder="例如：林老师" required/></label>
        <label>角色<select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option value="teacher">教师</option><option value="guardian">家长</option><option value="student">学生</option><option value="admin">管理员</option></select></label>
        <label>临时密码<input type="password" minLength={10} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="至少 10 个字符" required/></label>
        <button className="primary-button" disabled={busyAction === "create-member"}>{busyAction === "create-member" ? "创建中…" : "创建成员"}</button>
      </form>

      <form className="panel form-card" onSubmit={saveGuardianLinks}>
        <div className="panel-heading"><div><span className="eyebrow">家庭数据权限</span><h3>监护人绑定</h3></div></div>
        <label>监护人<select value={guardianUserId} onChange={(event) => setGuardianUserId(event.target.value)} required><option value="">请选择监护人</option>{guardians.map((member) => <option key={String(member.id)} value={String(member.id)}>{stringValue(member.displayName)} · {stringValue(member.email)}</option>)}</select></label>
        <fieldset className="student-checklist"><legend>选择关联学生</legend>{students.length ? students.map((member) => {
          const id = String(member.id);
          return <label className="student-check" key={id}><input type="checkbox" checked={studentUserIds.includes(id)} onChange={(event) => setStudentUserIds(event.target.checked ? [...studentUserIds, id] : studentUserIds.filter((studentId) => studentId !== id))}/><span className="member-avatar small">{memberInitial(member)}</span><span><strong>{stringValue(member.displayName)}</strong><small>{stringValue(member.email)}</small></span></label>;
        }) : <p className="empty-state">请先创建学生账号。</p>}</fieldset>
        <button className="primary-button" disabled={busyAction === "guardian-links" || !guardianUserId}>{busyAction === "guardian-links" ? "保存中…" : "保存监护人绑定"}</button>
      </form>
    </section>

    <article className="panel member-table-panel">
      <div className="member-table-heading"><div><span className="eyebrow">账号与访问权限</span><h3>成员列表</h3><p>{data.members.length} 名成员，集中管理角色、登录状态和账号安全。</p></div></div>
      <div className="member-table-scroll">
        <table className="member-directory-table">
          <colgroup><col className="member-column"/><col className="roles-column"/><col className="status-column"/><col className="password-column"/><col className="actions-column"/></colgroup>
          <thead><tr><th>成员</th><th>角色</th><th>状态</th><th>首次登录</th><th className="actions-heading">操作</th></tr></thead>
          <tbody>{data.members.map((member) => {
            const id = String(member.id);
            const disabled = member.status === "disabled";
            const currentMember = data.user.id === id;
            const roles = stringValue(member.roles, "").split(",").filter(Boolean);
            return <tr key={id}>
              <td><div className="member-identity"><span className="member-avatar">{memberInitial(member)}</span><span><strong>{stringValue(member.displayName)}{currentMember && <span className="current-member-badge">当前账号</span>}</strong><small>{stringValue(member.email)}</small></span></div></td>
              <td><div className="role-badges">{roles.map((role) => <span className="role-badge" key={role}>{ROLE_LABELS[role] ?? role}</span>)}</div></td>
              <td><span className={`member-state ${disabled ? "disabled" : "active"}`}><i/>{disabled ? "已停用" : "正常"}</span></td>
              <td><span className={`first-login-state ${member.mustChangePassword ? "required" : "complete"}`}>{member.mustChangePassword ? "需要改密" : "已完成"}</span></td>
              <td><div className="member-actions"><button type="button" className="soft-button" disabled={busyAction === `reset:${id}`} onClick={() => { setResetMember(member); setResetPassword(""); }}>重置密码</button>{currentMember ? <button type="button" className="soft-button member-disabled-action" disabled title="为防止账号自锁，当前账号不能停用">不可停用</button> : <button type="button" className={disabled ? "soft-button" : "soft-button member-danger-action"} disabled={busyAction === `status:${id}`} onClick={() => changeMemberStatus(member)}>{busyAction === `status:${id}` ? "处理中…" : disabled ? "启用" : "停用"}</button>}</div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </article>

    <article className="panel guardian-relations-panel">
      <div className="member-table-heading"><div><span className="eyebrow">可核验家庭关系</span><h3>当前监护关系</h3><p>展示成员名称和邮箱，便于核对绑定对象。</p></div><span className="relation-count">{uniqueGuardianLinks.length} 组</span></div>
      <div className="guardian-relations">{uniqueGuardianLinks.length ? uniqueGuardianLinks.map((link) => {
        const guardian = memberById.get(String(link.guardianUserId));
        const student = memberById.get(String(link.studentUserId));
        return <div className="guardian-relation-card" key={`${link.guardianUserId}-${link.studentUserId}`}>
          <div className="relation-person"><span className="member-avatar small">{guardian ? memberInitial(guardian) : "家"}</span><span><strong>{guardian ? stringValue(guardian.displayName) : "未知监护人"}</strong><small>{guardian ? stringValue(guardian.email) : "账号不存在"}</small></span></div>
          <span className="relation-arrow" aria-hidden="true">→</span>
          <div className="relation-person"><span className="member-avatar small">{student ? memberInitial(student) : "生"}</span><span><strong>{student ? stringValue(student.displayName) : "未知学生"}</strong><small>{student ? stringValue(student.email) : "账号不存在"}</small></span></div>
        </div>;
      }) : <p className="empty-state">尚未建立监护人绑定。</p>}</div>
    </article>

    {resetMember && <div className="modal-backdrop"><form className="modal-card member-reset-modal" onSubmit={resetMemberPassword}>
      <span className="eyebrow">账号安全</span><h2>重置成员密码</h2><p>正在为 <strong>{stringValue(resetMember.displayName)}</strong>（{stringValue(resetMember.email)}）设置新的临时密码。该成员下次登录时必须修改密码。</p>
      <label className="member-reset-field">新临时密码<input type="password" minLength={10} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="至少 10 个字符" autoFocus required/></label>
      <div className="form-actions"><button type="button" className="soft-button" disabled={busyAction.startsWith("reset:")} onClick={() => { setResetMember(null); setResetPassword(""); }}>取消</button><button className="primary-button" disabled={busyAction.startsWith("reset:")}>{busyAction.startsWith("reset:") ? "重置中…" : "确认重置"}</button></div>
    </form></div>}
  </section>;
}
