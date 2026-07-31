"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminView, GuardianView, TeacherView } from "./staff-views";
import { StudentView } from "./student-view";
import type { Notify, Role, WorkspaceData } from "./lib/platform-types";

const roles: Array<{ id: Role; label: string }> = [
  { id: "student", label: "学生" }, { id: "teacher", label: "教师" }, { id: "guardian", label: "家长" }, { id: "admin", label: "机构" },
];
const navigation: Record<Role, string[]> = {
  student: ["学习总览", "AI 课堂", "学习任务", "成长档案"],
  teacher: ["教学总览", "来源化备课", "班级管理", "作业批阅"],
  guardian: ["孩子概览", "成长报告", "家庭任务", "授权管理"],
  admin: ["机构总览", "平台设置", "内容中心", "知识检索", "成员管理", "权限审计"],
};

type Toast = { title: string; detail: string; tone: "success" | "error" } | null;

async function readJson<T extends Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: `接口返回的不是有效 JSON（HTTP ${response.status}）` } as T;
  }
}

export function Dashboard() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [role, setRole] = useState<Role>("student");
  const [activeNav, setActiveNav] = useState(navigation.student[0]);
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"standard" | "local" | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  const notify: Notify = (title, detail, tone = "success") => {
    setToast({ title, detail, tone });
    window.setTimeout(() => setToast(null), 3600);
  };

  async function loadAuthMode() {
    const response = await fetch("/api/v1/auth/session", { cache: "no-store" });
    const payload = await readJson<{ authMode?: "standard" | "local"; setupRequired?: boolean; user?: { mustChangePassword?: boolean }; error?: string }>(response);
    if (!response.ok) throw new Error(payload.error ?? "会话状态加载失败");
    setAuthMode(payload.authMode ?? null);
    setSetupRequired(payload.setupRequired === true);
    setMustChangePassword(payload.user?.mustChangePassword === true);
    return { mode: payload.authMode ?? null, setupRequired: payload.setupRequired === true };
  }

  async function refresh(studentId?: string) {
    setError("");
    const selectedStudentId = studentId ?? data?.selectedStudent?.id;
    const workspaceUrl = selectedStudentId ? `/api/v1/workspace?studentId=${encodeURIComponent(selectedStudentId)}` : "/api/v1/workspace";
    const response = await fetch(workspaceUrl, { cache: "no-store" });
    const payload = await readJson<WorkspaceData | { error?: string }>(response);
    if (!response.ok) throw new Error(response.status === 401 ? "请先登录" : `工作区数据加载失败：${"error" in payload ? payload.error ?? response.status : response.status}`);
    const next = payload as WorkspaceData;
    setData(next);
    if (!next.user.roles.includes(role)) {
      const first = next.user.roles[0] ?? "student";
      setRole(first); setActiveNav(navigation[first][0]);
    }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/v1/workspace", { cache: "no-store" })
      .then(async (response) => {
        const payload = await readJson<WorkspaceData | { error?: string }>(response);
        if (!response.ok) throw new Error(response.status === 401 ? "请先登录" : `工作区数据加载失败：${"error" in payload ? payload.error ?? response.status : response.status}`);
        return payload as WorkspaceData;
      })
      .then((next) => {
        if (active) {
          setData(next);
          void loadAuthMode().catch(() => null);
        }
      })
      .catch(async (reason: Error) => {
        if (!active) return;
        const session = await loadAuthMode().catch(() => null);
        setError(session?.mode === "standard" ? (session.setupRequired ? "" : "请使用管理员账号登录") : reason.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function act(action: string, payload: Record<string, unknown> = {}) {
    const response = await fetch("/api/v1/workspace/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const result = await readJson<Record<string, unknown>>(response);
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "操作失败");
    await refresh();
    return result;
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "登录失败");
      setPassword("");
      setLoading(true);
      await loadAuthMode();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
      setLoginBusy(false);
    }
  }

  async function setup(event: React.FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const result = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "初始化失败");
      setPassword("");
      setSetupRequired(false);
      setLoading(true);
      await loadAuthMode();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "初始化失败");
    } finally {
      setLoading(false);
      setLoginBusy(false);
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("退出登录失败");
      setData(null);
      setMustChangePassword(false);
      setAuthMode("standard");
      setError("已退出登录");
    } catch (reason) {
      notify("退出失败", reason instanceof Error ? reason.message : "退出登录失败", "error");
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const result = await readJson<{ error?: string }>(response);
      if (!response.ok) {
        if (response.status < 500) { setCurrentPassword(""); setNewPassword(""); }
        throw new Error(result.error ?? "修改密码失败");
      }
      setCurrentPassword("");
      setNewPassword("");
      await loadAuthMode();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "修改密码失败");
    } finally {
      setLoginBusy(false);
    }
  }

  const unread = useMemo(() => data?.notifications.filter((item) => !item.read_at).length ?? 0, [data]);
  const visibleRoles = roles.filter((item) => data?.user.roles.includes(item.id));

  if (loading) return <main className="center-state"><div className="loader"/><h1>正在连接真实工作区…</h1><p>加载班级、任务、内容与审计记录</p></main>;
  if (authMode === "standard" && setupRequired) return <main className="center-state"><form className="login-card" onSubmit={setup}><span className="eyebrow">首次部署初始化</span><h1>初始化文趣工作区</h1><p>当前数据库还没有管理员。请在网页内创建首个管理员账号，D1/R2 和登录密钥会自动完成初始化。</p><label>管理员邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label><label>显示名称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} type="text" autoComplete="name" placeholder="文趣管理员" /></label><label>管理员密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={8} required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={loginBusy}>{loginBusy ? "初始化中…" : "创建管理员并进入工作区"}</button></form></main>;
  if (authMode === "standard" && (mustChangePassword || data?.user.mustChangePassword)) return <main className="center-state"><form className="login-card password-change-card" onSubmit={changePassword}><span className="eyebrow">首次登录安全设置</span><h1>请修改临时密码</h1><p>修改完成后才能进入工作区。</p><label>当前密码<input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" required /></label><label>新密码<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={loginBusy}>{loginBusy ? "修改中…" : "修改密码并进入工作区"}</button></form></main>;
  if ((error || !data) && authMode === "standard") return <main className="center-state"><form className="login-card" onSubmit={login}><span className="eyebrow">标准 Cloudflare 登录</span><h1>进入文趣工作区</h1><p>使用初始化时创建的管理员账号，或成员管理中创建的账号登录。</p><label>邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={loginBusy}>{loginBusy ? "登录中…" : "登录"}</button></form></main>;
  if (error || !data) return <main className="center-state"><h1>暂时无法进入工作区</h1><p>{error || "未知错误"}</p><button className="primary-button" onClick={() => { setLoading(true); refresh().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }}>重新加载</button></main>;

  function switchRole(next: Role) { setRole(next); setActiveNav(navigation[next][0]); }
  async function sendFeedback(event: React.FormEvent) {
    event.preventDefault();
    if (!feedback.trim()) return;
    const response = await fetch("/api/v1/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType: "platform", targetId: data!.workspace.tenantId, rating: 1, correction: feedback }) });
    if (!response.ok) return notify("反馈未提交", "请稍后重试。", "error");
    setFeedback(""); setFeedbackOpen(false); notify("反馈已保存", "内容已写入租户反馈记录。谢谢你的建议！");
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">文</span><div><strong>文趣</strong><small>华文教学助手</small></div></div>
      <nav className="side-nav" aria-label="主导航">{navigation[role].map((item, index) => <button type="button" key={item} className={activeNav === item ? "active" : ""} onClick={() => setActiveNav(item)}><span className="nav-mark">{["◉", "✦", "册", "◎"][index]}</span><span>{item}</span></button>)}</nav>
      <div className="culture-note"><span>春</span><div><strong>今日文化卡</strong><p>春风又绿江南岸</p><small>文化卡来源：自编审核内容</small></div></div>
      <div className="sidebar-footer"><button type="button" onClick={() => setFeedbackOpen(true)}>？ 帮助与反馈</button><span>盾 未成年人保护已开启</span></div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="mobile-brand"><span className="brand-mark">文</span><strong>文趣</strong></div>
        <div className="role-switcher" aria-label="已授权角色">{visibleRoles.map((item) => <button type="button" key={item.id} className={role === item.id ? "active" : ""} onClick={() => switchRole(item.id)}>{item.label}</button>)}</div>
        <div className="top-actions"><span className="mode-chip">试用工作区 · 真实保存</span><button type="button" className="notification" aria-label={`通知 ${unread} 条未读`} onClick={() => setNoticesOpen(!noticesOpen)}>◌{unread > 0 && <i/>}</button><div className="profile"><span className={`avatar ${role}`}>{data.user.displayName[0]?.toUpperCase()}</span><div><strong>{data.user.displayName}</strong><small>{data.user.email}</small></div></div>{authMode === "standard" && <button type="button" className="logout-button" onClick={logout}>退出</button>}</div>
        {noticesOpen && <div className="notice-drawer"><div className="panel-heading"><h3>通知</h3><button onClick={() => setNoticesOpen(false)}>关闭</button></div>{data.notifications.length ? data.notifications.map((item) => <button key={String(item.id)} className={item.read_at ? "read" : ""} onClick={async () => { await act("mark_notification", { id: item.id }); }}><strong>{String(item.title)}</strong><small>{String(item.detail)}</small></button>) : <p className="empty-state">暂无通知</p>}</div>}
      </header>
      <div className="content"><div className="truth-banner"><strong>✓ 已连接 D1 + R2</strong><span>所有数字来自当前租户数据；未配置的模型能力会明确标注，不展示伪造分数。</span></div>
        {role === "student" && <StudentView nav={activeNav} data={data} act={act} refresh={refresh} notify={notify}/>}
        {role === "teacher" && <TeacherView nav={activeNav} data={data} act={act} notify={notify}/>}
        {role === "guardian" && <GuardianView nav={activeNav} data={data} act={act} notify={notify} selectStudent={async (studentId) => refresh(studentId)}/>}
        {role === "admin" && <AdminView nav={activeNav} data={data} act={act} refresh={refresh} notify={notify}/>}
      </div>
    </section>
    {feedbackOpen && <div className="modal-backdrop"><form className="modal-card" onSubmit={sendFeedback}><span className="eyebrow">真实反馈记录</span><h2>告诉我们哪里需要改进</h2><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="写下遇到的问题或建议" maxLength={2000} required/><div className="form-actions"><button type="button" className="soft-button" onClick={() => setFeedbackOpen(false)}>取消</button><button className="primary-button">提交反馈</button></div></form></div>}
    {toast && <div className={`toast ${toast.tone}`} role="status"><span>{toast.tone === "success" ? "✓" : "!"}</span><div><strong>{toast.title}</strong><p>{toast.detail}</p></div></div>}
  </main>;
}
