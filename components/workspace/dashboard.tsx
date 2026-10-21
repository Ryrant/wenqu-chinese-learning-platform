import { useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, BookOpen, CalendarCheck, ChartNoAxesCombined, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList, FileText, FolderOpen, GraduationCap, LayoutDashboard, LoaderCircle, LogOut, Menu, MessageCircle, Search, Settings, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { Notify, Role } from "../../lib/platform-types";
import { postJson } from "../../lib/workspace/api";
import { errorMessage, useWorkspaceController } from "../../hooks/use-workspace-controller";
import { workspacePages } from "../../lib/workspace/navigation";
import { RetainedRole } from "./retained-role";


const roles: Array<{ id: Role; label: string }> = [
  { id: "student", label: "学生" }, { id: "teacher", label: "教师" }, { id: "guardian", label: "家长" }, { id: "admin", label: "机构" },
];
const navigation = Object.fromEntries(Object.entries(workspacePages).map(([role, pages]) => [role, pages.map(([, label]) => label)])) as Record<Role, string[]>;

type Toast = { title: string; detail: string; tone: "success" | "error" } | null;

const navigationIcons: Record<string, LucideIcon> = {
  学习总览: LayoutDashboard, "AI 课堂": MessageCircle, 学习任务: ClipboardList, 成长档案: ChartNoAxesCombined,
  教学总览: LayoutDashboard, 来源化备课: BookOpen, 班级管理: Users, 作业批阅: FileText,
  孩子概览: LayoutDashboard, 成长报告: ChartNoAxesCombined, 家庭任务: CalendarCheck, 授权管理: ShieldCheck,
  机构总览: LayoutDashboard, 平台设置: Settings, 内容中心: FolderOpen, 知识检索: Search, 成员管理: Users, 权限审计: ClipboardList,
};

function Brand() {
  return <div className="app-brand"><span className="brand-symbol">华</span><div><strong>华文知行</strong><small>CHINESE LEARNING</small></div></div>;
}

function AuthScreen({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <main className="auth-page"><aside className="auth-intro"><Brand/><div className="auth-intro-copy"><h2>让学习发生，<br/>让成长可见。</h2><p>连接课堂与家庭，<br/>陪伴每一次表达与进步。</p></div><span className="auth-intro-footer">华文知行 · 协同教学平台</span></aside><section className="auth-form-area"><Card className="auth-card"><CardHeader><CardTitle><h1>{title}</h1></CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent>{children}</CardContent></Card></section></main>;
}

export function Dashboard() {
  const workspace = useWorkspaceController();
  const { data, receivedAt: workspaceReceivedAt, session, initializing: loading, error, setError, accessDenied,
    committedRoute, desiredRoute, pageLoading, pageError, refreshError, setRefreshError, refresh, act, selectStudent } = workspace;
  const authMode = session?.authMode;
  const setupRequired = session?.setupRequired;
  const mustChangePassword = session?.user?.mustChangePassword;
  const role = committedRoute?.role ?? desiredRoute?.role ?? "student";
  const activeNav = committedRoute?.label ?? "";
  const [toast, setToast] = useState<Toast>(null);
  const [retryRefreshing, setRetryRefreshing] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavTrigger = useRef<HTMLButtonElement>(null);
  const noticeTrigger = useRef<HTMLButtonElement>(null);
  const notify: Notify = (title, detail, tone = "success") => {
    setToast({ title, detail, tone });
    window.setTimeout(() => setToast(null), 3600);
  };
  async function authenticate(event: React.FormEvent, setup: boolean) {
    event.preventDefault(); setLoginBusy(true); setError("");
    try {
      await postJson(setup ? "/api/v1/auth/setup" : "/api/v1/auth/login", setup ? { email, password, displayName, workspaceName } : { email, password });
      setPassword(""); await workspace.openSession();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoginBusy(false); }
  }
  const login = (event: React.FormEvent) => authenticate(event, false);
  const setup = (event: React.FormEvent) => authenticate(event, true);
  async function logout() {
    try { await workspace.logout(); }
    catch (reason) { notify("退出失败", errorMessage(reason), "error"); }
  }
  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setLoginBusy(true); setError("");
    try {
      await postJson("/api/v1/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); await workspace.openSession();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoginBusy(false); }
  }
  const unread = useMemo(() => data?.notifications.filter((item) => !item.read_at).length ?? 0, [data]);
  const visibleRoles = roles.filter((item) => data?.user.roles.includes(item.id));
  function switchRole(next: Role) {
    if (!data?.user.roles.includes(next)) return;
    workspace.switchRole(next); setMobileNavOpen(false);
  }
  function navigatePage(label: string) { workspace.goTo(label); setMobileNavOpen(false); }

  if (loading) return <main className="center-state"><div className="loading-mark"><LoaderCircle size={24}/></div><h1>正在加载工作区</h1></main>;
  if (accessDenied) return <AuthScreen title="当前账号无权访问" description={error || "请联系管理员为账号分配角色后重新登录。"}>{authMode === "standard" && <Button className="w-full" onClick={logout}>退出并切换账号</Button>}</AuthScreen>;
  if (authMode === "standard" && setupRequired) return <AuthScreen title="创建你的工作区" description="设置首个管理员账号，开始使用华文知行。"><form className="auth-fields" onSubmit={setup}><div className="auth-field"><Label htmlFor="setup-workspace">工作区名称</Label><Input id="setup-workspace" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={120} placeholder="学校或机构名称" required/></div><div className="auth-field"><Label htmlFor="setup-email">管理员邮箱</Label><Input id="setup-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" placeholder="name@school.com" required/></div><div className="auth-field"><Label htmlFor="setup-name">姓名</Label><Input id="setup-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" placeholder="如何称呼你"/></div><div className="auth-field"><Label htmlFor="setup-password">密码</Label><Input id="setup-password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="new-password" minLength={8} placeholder="至少 8 个字符" required/></div>{error && <p className="form-error" role="alert">{error}</p>}<Button className="w-full" type="submit" disabled={loginBusy}>{loginBusy ? <><LoaderCircle className="animate-spin"/>正在创建</> : "创建管理员并进入工作区"}</Button></form></AuthScreen>;
  if (authMode === "standard" && (mustChangePassword || data?.user.mustChangePassword)) return <AuthScreen title="设置新密码" description="请先修改临时密码，再进入工作区。"><form className="auth-fields password-change-card" onSubmit={changePassword}><div className="auth-field"><Label htmlFor="current-password">当前密码</Label><Input id="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" required/></div><div className="auth-field"><Label htmlFor="new-password">新密码</Label><Input id="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" autoComplete="new-password" minLength={10} required/></div>{error && error !== "请先修改临时密码" && <p className="form-error" role="alert">{error}</p>}<Button className="w-full" type="submit" disabled={loginBusy}>{loginBusy ? "正在保存…" : "修改密码并进入工作区"}</Button></form></AuthScreen>;
  if (!session?.authenticated && authMode === "standard") return <AuthScreen title="欢迎回来" description="登录你的账号，继续今天的学习与教学。"><form className="auth-fields" onSubmit={login}><div className="auth-field"><Label htmlFor="login-email">邮箱</Label><Input id="login-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" placeholder="name@school.com" required/></div><div className="auth-field"><Label htmlFor="login-password">密码</Label><Input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required/></div>{error && error !== "已退出登录" && error !== "请先登录" && <p className="form-error" role="alert">{error}</p>}<Button className="w-full" type="submit" disabled={loginBusy}>{loginBusy ? <><LoaderCircle className="animate-spin"/>正在登录</> : "登录"}</Button></form></AuthScreen>;
  if (!data) return <main className="center-state"><CircleAlert className="text-muted-foreground" size={32}/><h1>暂时无法进入工作区</h1><p>{error || "请重新加载页面。"}</p><Button onClick={() => { void workspace.openSession().catch(() => { /* 错误已在会话控制器显示。 */ }); }}>重新加载</Button></main>;

  if (!desiredRoute && window.location.pathname !== "/") return <AuthScreen title="页面不存在" description="请从工作台导航进入需要的页面。"><Button onClick={workspace.goHome}>返回工作台</Button></AuthScreen>;
  if (desiredRoute && !data.user.roles.includes(desiredRoute.role)) return <AuthScreen title="当前账号无权访问此页面" description="这个工作台需要相应角色授权。"><Button onClick={workspace.goHome}>返回已授权工作台</Button></AuthScreen>;
  if (!committedRoute) return <main className="center-state"><LoaderCircle className="animate-spin"/><h1>{pageError ? "页面读取失败" : "正在加载页面"}</h1>{pageError && <><p role="alert">{pageError}</p><Button onClick={workspace.retryPage}>重新读取页面</Button></>}</main>;

  const roleLabel = roles.find((item) => item.id === role)?.label;
  const workspaceNavigation = <nav className="workspace-nav" aria-label="主导航">{navigation[role].map((item) => {
    const Icon = navigationIcons[item] ?? BookOpen;
    return <Button type="button" variant="ghost" className="nav-button" aria-current={activeNav === item ? "page" : undefined} key={item} onClick={() => navigatePage(item)}><Icon/><span>{item}</span></Button>;
  })}</nav>;

  return <main className="app-shell">
    <aside className="app-sidebar"><Brand/><p className="nav-caption">{roleLabel}工作台</p>{workspaceNavigation}<div className="sidebar-bottom"><div className="sidebar-account"><GraduationCap size={22}/><div><strong>{data.workspace.name}</strong><small>{roleLabel}工作台</small></div></div></div></aside>
    <section className="workspace-main">
      <header className="workspace-topbar"><div className="workspace-location"><Button variant="ghost" size="icon" ref={mobileNavTrigger} className="mobile-menu-trigger" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu/></Button><span className="breadcrumb-role">{roleLabel}工作台</span><ChevronRight/><strong>{activeNav}</strong></div><div className="workspace-tools"><Button variant="ghost" size="icon" ref={noticeTrigger} className="notice-trigger" aria-label={unread ? `通知，${unread} 条未读` : "通知"} onClick={() => setNoticesOpen(true)}><Bell/>{unread > 0 && <span className="notice-count">{unread > 99 ? "99+" : unread}</span>}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="account-trigger" aria-label="账号菜单"><Avatar className="size-8"><AvatarFallback className="bg-secondary text-primary text-xs">{data.user.displayName[0]?.toUpperCase()}</AvatarFallback></Avatar><span className="account-trigger-name">{data.user.displayName}</span><ChevronDown/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60"><DropdownMenuLabel><div className="font-medium">{data.user.displayName}</div><div className="mt-1 break-all text-xs font-normal text-muted-foreground">{data.user.email}</div></DropdownMenuLabel>{visibleRoles.length > 1 && <><DropdownMenuSeparator/><DropdownMenuLabel className="text-xs text-muted-foreground">切换角色</DropdownMenuLabel><div aria-label="已授权角色">{visibleRoles.map((item) => <DropdownMenuItem key={item.id} onSelect={() => { void switchRole(item.id); }}><span className="flex-1">{item.label}工作台</span>{role === item.id && <Check/>}</DropdownMenuItem>)}</div></>}{authMode === "standard" && <><DropdownMenuSeparator/><DropdownMenuItem onSelect={() => { void logout(); }}><LogOut/>退出登录</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></div></header>
      <div className="workspace-content" aria-busy={pageLoading}>{pageLoading && <p className="text-sm text-muted-foreground" role="status">正在读取页面…</p>}{pageError && <Alert variant="destructive"><CircleAlert/><AlertTitle>页面未切换</AlertTitle><AlertDescription>{pageError}<Button variant="outline" size="sm" onClick={workspace.retryPage}>重新读取页面</Button></AlertDescription></Alert>}{refreshError && <Alert className="refresh-warning"><CircleAlert/><AlertTitle>工作区未刷新</AlertTitle><AlertDescription><p>{refreshError}</p><Button variant="outline" size="sm" disabled={retryRefreshing} onClick={async () => { setRetryRefreshing(true); try { await refresh(); } catch (reason) { setRefreshError(`工作区仍未刷新：${reason instanceof Error ? reason.message : "请稍后重试"}。之前成功保存的操作无需重复提交。`); } finally { setRetryRefreshing(false); } }}>{retryRefreshing ? "正在刷新…" : "重新读取工作区"}</Button></AlertDescription></Alert>}
        {visibleRoles.map((item) => <RetainedRole key={item.id} role={item.id} active={role === item.id} nav={activeNav} data={data} receivedAt={workspaceReceivedAt} act={act} refresh={refresh} notify={notify} navigate={navigatePage} selectStudent={async (studentId) => { try { await selectStudent(studentId); } catch (reason) { notify("切换失败", errorMessage(reason), "error"); } }}/>)}
      </div>
    </section>
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}><SheetContent side="left" className="mobile-navigation" onCloseAutoFocus={(event) => { event.preventDefault(); mobileNavTrigger.current?.focus(); }}><SheetHeader className="px-3 pb-6"><SheetTitle>华文知行</SheetTitle><SheetDescription className="text-sidebar-foreground/60">{roleLabel}工作台</SheetDescription></SheetHeader>{workspaceNavigation}<p className="mt-auto px-3 text-sm text-sidebar-foreground/60">{data.workspace.name}</p></SheetContent></Sheet>
    <Sheet open={noticesOpen} onOpenChange={setNoticesOpen}><SheetContent onCloseAutoFocus={(event) => { event.preventDefault(); noticeTrigger.current?.focus(); }}><SheetHeader><SheetTitle>通知</SheetTitle><SheetDescription>{unread ? `${unread} 条未读通知` : "暂无未读通知"}</SheetDescription></SheetHeader><div className="notification-list">{data.notifications.length ? data.notifications.map((item) => <button type="button" className={`notification-item ${item.read_at ? "" : "unread"}`} key={String(item.id)} onClick={async () => { try { await act("mark_notification", { id: item.id }); } catch (reason) { notify("无法更新通知", reason instanceof Error ? reason.message : "请稍后重试", "error"); } }}><strong>{String(item.title)}</strong><small>{String(item.detail)}</small></button>) : <p className="empty-state">还没有通知</p>}</div></SheetContent></Sheet>
    {toast && <div className="toast-region" role="status"><Alert variant={toast.tone === "error" ? "destructive" : "default"}>{toast.tone === "error" ? <CircleAlert/> : <CheckCircle2/>}<AlertTitle>{toast.title}</AlertTitle><AlertDescription>{toast.detail}</AlertDescription></Alert></div>}
  </main>;
}
