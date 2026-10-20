import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Role, WorkspaceSection } from "../../lib/platform-types";
import { ApiError, postJson, requestJson } from "./api";
import { sectionsChangedByAction } from "./invalidation";
import { defaultWorkspaceRole, matchWorkspaceRoute, pageSections, workspacePath, type WorkspaceRoute } from "./navigation";
import { useWorkspace } from "./use-workspace";

type Session = {
  authenticated: boolean; authMode: "standard" | "local"; setupRequired?: boolean;
  user?: { mustChangePassword?: boolean }; error?: string;
};

export function errorMessage(reason: unknown) {
  if (reason instanceof ApiError) {
    if (reason.status === 401) return "请先登录";
    if (reason.code === "forbidden") return "当前账号未获授权，请联系管理员分配角色。";
    if (reason.code === "password_change_required") return "请先修改临时密码";
  }
  return reason instanceof Error ? reason.message : "请求失败，请稍后重试。";
}

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

  const handleAccessError = useCallback((reason: unknown) => {
    if (!(reason instanceof ApiError)) return;
    if (reason.status === 401 || reason.code === "forbidden" || reason.code === "password_change_required") {
      epoch.current++; store.reset(); setCommittedRoute(null);
      setAccessDenied(reason.code === "forbidden");
      setSession((value) => value ? { ...value, authenticated: reason.code === "password_change_required", user: { mustChangePassword: reason.code === "password_change_required" } } : value);
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
      if (reason instanceof ApiError && reason.code === "forbidden") {
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
    const studentId = desiredRoute.role === "student" ? userId : desiredRoute.role === "guardian" ? new URLSearchParams(location.search).get("studentId") ?? guardianStudent : undefined;
    const sections = [...pageSections(desiredRoute), "notifications" as const];
    setPageLoading(true); setPageError("");
    void (async () => {
      try {
        // 写入可能使在途的读取失效；只在所有页面分组都已接收时切换可见导航。
        for (let attempt = 0; attempt < 3; attempt++) {
          await store.load(sections, { studentId });
          if (!active || ticket !== epoch.current) return;
          if (store.ready(sections)) { setCommittedRoute(desiredRoute); return; }
        }
        throw new Error("数据正在更新，请重新读取页面。");
      } catch (reason) {
        if (active && ticket === epoch.current) { handleAccessError(reason); setPageError(errorMessage(reason)); }
      } finally { if (active && ticket === epoch.current) setPageLoading(false); }
    })();
    return () => { active = false; };
  }, [initializing, userId, rolesKey, studentsKey, session?.authenticated, session?.user?.mustChangePassword, desiredRoute, location.pathname, location.search, navigate, store, handleAccessError, retry]);

  const refresh = useCallback(async (studentId?: string) => {
    const route = committed.current;
    const sections: WorkspaceSection[] = route ? [...pageSections(route), "notifications"] : ["notifications"];
    try {
      // 独立上传、设置等入口可能改变其他已缓存分组；只读取当前页，其余留待访问时更新。
      store.invalidate(store.loaded());
      await store.load(sections, { force: true, studentId });
      setRefreshError("");
    } catch (reason) { handleAccessError(reason); throw reason; }
  }, [store, handleAccessError]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const ticket = epoch.current;
    let result: Record<string, unknown>;
    try { result = await postJson<Record<string, unknown>>("/api/v1/workspace/actions", { action, ...payload }); }
    catch (reason) { handleAccessError(reason); throw reason; }
    if (ticket !== epoch.current) return result;
    const changed = [...sectionsChangedByAction(action)];
    if (action !== "mark_notification" && action !== "suggest_intervention") changed.push("audits");
    store.invalidate(changed);
    const current = committed.current;
    const visible = current ? [...pageSections(current), "notifications" as const] : [];
    try {
      const affected = visible.filter((section) => changed.includes(section));
      if (affected.length) await store.load(affected);
      setRefreshError("");
    } catch (reason) {
      handleAccessError(reason);
      setRefreshError(`操作已保存，读取最新数据失败：${errorMessage(reason)}。无需重复提交。`);
    }
    return result;
  }, [store, handleAccessError]);

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
