import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Role, WorkspaceSection } from "../lib/platform-types";
import { ApiError, postJson, requestJson } from "../lib/workspace/api";
import { sectionsChangedByAction } from "../lib/workspace/invalidation";
import { defaultWorkspaceRole, matchWorkspaceRoute, pageSections, workspacePath, type WorkspaceRoute } from "../lib/workspace/navigation";
import { observePageResume } from "../lib/workspace/observe-page-resume";
import { errorMessage, workspaceAccessFailure } from "../lib/workspace/access-error";
import { useWorkspace } from "./use-workspace";

export { errorMessage } from "../lib/workspace/access-error";

type Session = {
  authenticated: boolean; authMode: "standard" | "local"; setupRequired?: boolean;
  user?: { mustChangePassword?: boolean }; error?: string;
};

/** 路由提交与数据提交分开：下一页读取期间，当前页面及其草稿继续存在。 */
export function useWorkspaceController() {
  const { data, receivedAt, store } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [committedRoute, setCommittedRoute] = useState<WorkspaceRoute | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const selectionIntent = useRef(0);
  const committed = useRef<WorkspaceRoute | null>(null);
  committed.current = committedRoute;
  const desiredRoute = useMemo(() => matchWorkspaceRoute(location.pathname), [location.pathname]);

  const loadWorkspace = useCallback(async (sections: readonly WorkspaceSection[], options: { force?: boolean; revalidate?: boolean; studentId?: string } = {}, recoverySections = sections) => {
    try { await store.load(sections, options); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 403 && reason.code === "forbidden" && await store.recoverStudent(recoverySections)) return;
      throw reason;
    }
  }, [store]);

  const handleAccessError = useCallback((reason: unknown) => {
    const failure = workspaceAccessFailure(reason);
    if (failure) {
      epoch.current++; store.reset(); setCommittedRoute(null);
      setAccessDenied(failure === "account-denied");
      setSession((value) => value ? { ...value, authenticated: failure === "password-change", user: { mustChangePassword: failure === "password-change" } } : value);
      setError(errorMessage(reason));
    }
  }, [store]);

  const openSession = useCallback(async () => {
    const ticket = ++epoch.current;
    store.reset(); setCommittedRoute(null); setInitializing(true); setError(""); setRefreshError(""); setAccessDenied(false);
    try {
      const next = await requestJson<Session>("/api/v1/auth/session", { cache: "no-store" });
      if (ticket !== epoch.current) return;
      setSession(next);
      if (next.error && next.error !== "authentication_required") throw new Error(next.error);
      if (next.authenticated && !next.user?.mustChangePassword) await store.load();
    } catch (reason) {
      if (ticket !== epoch.current) return;
      if (workspaceAccessFailure(reason) === "account-denied") {
        setSession({ authenticated: false, authMode: "standard" }); setAccessDenied(true);
      }
      setError(errorMessage(reason));
      throw reason;
    } finally { if (ticket === epoch.current) setInitializing(false); }
  }, [store]);

  useEffect(() => {
    void openSession().catch(() => { /* openSession 已记录可见错误。 */ });
    const activeEpoch = epoch;
    return () => { activeEpoch.current++; store.reset(); };
  }, [openSession, store]);

  const userId = data?.user.id;
  const rolesKey = data?.user.roles.join(",") ?? "";
  const studentsKey = data?.availableStudents.map((student) => student.id).join(",") ?? "";
  useEffect(() => {
    if (initializing || !userId || !session?.authenticated || session.user?.mustChangePassword) return;
    const authorized = rolesKey.split(",") as Role[];
    if (location.pathname === "/") {
      navigate(workspacePath(defaultWorkspaceRole(authorized)), { replace: true }); return;
    }
    if (!desiredRoute || !authorized.includes(desiredRoute.role)) { setPageLoading(false); setPageError(""); return; }
    let active = true;
    selectionIntent.current++;
    const ticket = epoch.current;
    const snapshot = store.getSnapshot().data;
    const guardianStudent = snapshot?.availableStudents.some((student) => student.id === snapshot.selectedStudent?.id)
      ? snapshot.selectedStudent?.id : snapshot?.availableStudents[0]?.id;
    const query = new URLSearchParams(location.search);
    const requestedStudent = query.get("studentId");
    const guardianTarget = requestedStudent && snapshot?.availableStudents.some((student) => student.id === requestedStudent) ? requestedStudent : guardianStudent;
    // 撤权恢复后移除 URL 中的旧孩子，避免下一次重访重新请求已撤权的对象。
    if (desiredRoute.role === "guardian" && requestedStudent && requestedStudent !== guardianTarget) {
      if (guardianTarget) query.set("studentId", guardianTarget); else query.delete("studentId");
      navigate(`${location.pathname}${query.size ? `?${query}` : ""}`, { replace: true });
      return;
    }
    const studentId = desiredRoute.role === "student" ? userId : desiredRoute.role === "guardian" ? guardianTarget : undefined;
    const sections = [...pageSections(desiredRoute), "notifications" as const];
    setPageLoading(true); setPageError("");
    void (async () => {
      try {
        // 写入可能使在途的读取失效；只在所有页面分组都已接收时切换可见导航。
        for (let attempt = 0; attempt < 3; attempt++) {
          await loadWorkspace(sections, { studentId, revalidate: attempt === 0 });
          if (!active || ticket !== epoch.current) return;
          if (store.ready(sections)) { setCommittedRoute(desiredRoute); setRefreshError(""); return; }
        }
        throw new Error("数据正在更新，请重新读取页面。");
      } catch (reason) {
        if (ticket !== epoch.current) return;
        // store 清空身份时会先卸载旧页面，失效通知仍须完成退出和可见提示。
        if (reason instanceof ApiError && reason.code === "session_changed") { handleAccessError(reason); return; }
        if (active) { handleAccessError(reason); setPageError(errorMessage(reason)); }
      } finally { if (active && ticket === epoch.current) setPageLoading(false); }
    })();
    return () => { active = false; };
  }, [initializing, userId, rolesKey, studentsKey, session?.authenticated, session?.user?.mustChangePassword, desiredRoute, location.pathname, location.search, navigate, store, loadWorkspace, handleAccessError, retry]);

  useEffect(() => {
    if (!session?.authenticated || session.user?.mustChangePassword || !committedRoute || !rolesKey.split(",").includes(committedRoute.role) ||
      desiredRoute?.role !== committedRoute.role || desiredRoute.page !== committedRoute.page) return;
    let active = true;
    const stop = observePageResume(() => {
      const ticket = epoch.current;
      // 会话失效后清空快照；迟到的窗口事件不得重新启动已退出的读取。
      if (!store.getSnapshot().data) return;
      void loadWorkspace([...pageSections(committedRoute), "notifications"], { revalidate: true }).then(() => {
        if (active && ticket === epoch.current) setRefreshError("");
      }).catch((reason) => {
        if (ticket !== epoch.current) return;
        if (reason instanceof ApiError && reason.code === "session_changed") { handleAccessError(reason); return; }
        if (!active) return;
        handleAccessError(reason);
        setRefreshError(`读取最新数据失败：${errorMessage(reason)}。已保留上次读取的内容。`);
      });
    });
    return () => { active = false; stop(); };
  }, [session?.authenticated, session?.user?.mustChangePassword, rolesKey, committedRoute, desiredRoute, store, loadWorkspace, handleAccessError]);

  const refresh = useCallback(async (studentId?: string) => {
    const route = committed.current;
    const sections: WorkspaceSection[] = route ? [...pageSections(route), "notifications"] : ["notifications"];
    try {
      // 独立上传、设置等入口可能改变其他已缓存分组；只读取当前页，其余留待访问时更新。
      store.invalidate(store.loaded());
      await loadWorkspace(sections, { force: true, studentId });
      if (!store.ready(sections)) throw new Error("数据正在更新，请重新读取页面。");
      setRefreshError("");
    } catch (reason) { handleAccessError(reason); throw reason; }
  }, [store, loadWorkspace, handleAccessError]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const ticket = epoch.current;
    let result: Record<string, unknown>;
    try { result = await postJson<Record<string, unknown>>("/api/v1/workspace/actions", { action, ...payload }); }
    catch (reason) { if (ticket === epoch.current) handleAccessError(reason); throw reason; }
    if (ticket !== epoch.current) return result;
    const changed = [...sectionsChangedByAction(action)];
    if (action !== "mark_notification" && action !== "suggest_intervention") changed.push("audits");
    store.invalidate(changed);
    const current = committed.current;
    const visible = current ? [...pageSections(current), "notifications" as const] : [];
    try {
      const affected = visible.filter((section) => changed.includes(section));
      if (affected.length) await loadWorkspace(affected, {}, visible);
      if (ticket === epoch.current) setRefreshError("");
    } catch (reason) {
      if (ticket === epoch.current) {
        handleAccessError(reason);
        setRefreshError(`操作已保存，读取最新数据失败：${errorMessage(reason)}。无需重复提交。`);
      }
    }
    return result;
  }, [store, loadWorkspace, handleAccessError]);

  const logout = useCallback(async () => {
    await postJson("/api/v1/auth/logout", {});
    epoch.current++; store.reset(); setCommittedRoute(null); setAccessDenied(false); setError(""); setRefreshError("");
    setSession({ authenticated: false, authMode: "standard" });
    navigate("/", { replace: true });
  }, [store, navigate]);

  const selectStudent = useCallback(async (studentId: string) => {
    const intent = ++selectionIntent.current;
    await refresh(studentId);
    if (intent !== selectionIntent.current || store.getSnapshot().data?.selectedStudent?.id !== studentId) return;
    const route = committed.current;
    if (route?.role === "guardian") navigate(`${workspacePath(route.role, route.label)}?${new URLSearchParams({ studentId })}`);
  }, [refresh, navigate, store]);

  const goTo = (label: string) => {
    const route = committed.current;
    if (!route) return;
    navigate(`${workspacePath(route.role, label)}${route.role === "guardian" ? location.search : ""}`);
  };

  return {
    data, receivedAt, session, initializing, error, setError, accessDenied, committedRoute, desiredRoute,
    pageLoading, pageError, refreshError, setRefreshError, openSession, refresh, act, logout, selectStudent,
    goTo, switchRole: (role: Role) => navigate(workspacePath(role)),
    goHome: () => data && navigate(workspacePath(defaultWorkspaceRole(data.user.roles))),
    retryPage: () => setRetry((value) => value + 1),
  };
}
