import type { Role, WorkspaceSection } from "../platform-types";

export const workspacePages = {
  student: [
    ["overview", "学习总览"], ["tutor", "AI 课堂"], ["tasks", "学习任务"], ["practice", "教师练习"], ["journeys", "主题闯关"], ["writing", "汉字书写"], ["reading", "交互阅读"], ["vocabulary", "生词复习"], ["dictation", "听写实验室"], ["dialogue", "情境闯关"], ["portfolio", "成长档案"],
  ],
  teacher: [
    ["overview", "教学总览"], ["lessons", "来源化备课"], ["classes", "班级管理"], ["readings", "课文工作台"], ["scenarios", "情境任务"], ["practice", "班级练习"], ["reviews", "作业批阅"],
  ],
  guardian: [
    ["overview", "孩子概览"], ["reports", "成长报告"], ["tasks", "家庭任务"], ["consents", "授权管理"],
  ],
  admin: [
    ["overview", "机构总览"], ["settings", "平台设置"], ["content", "内容中心"], ["knowledge", "知识检索"], ["members", "成员管理"], ["audits", "权限审计"],
  ],
} as const;

export type WorkspaceRoute = { role: Role; page: string; label: string };
export function matchWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  const parts = pathname.replace(/\/+$/, "").split("/");
  if (parts.length !== 3 || !Object.hasOwn(workspacePages, parts[1])) return null;
  const role = parts[1] as Role;
  const page = workspacePages[role].find(([id]) => id === parts[2]);
  return page ? { role, page: page[0], label: page[1] } : null;
}
export function workspacePath(role: Role, label?: string) {
  const page = workspacePages[role].find(([, title]) => title === label) ?? workspacePages[role][0];
  return `/${role}/${page[0]}`;
}
export function defaultWorkspaceRole(roles: readonly Role[]): Role {
  const role = roles.includes("admin") ? "admin" : roles[0];
  if (!role) throw new Error("当前账号未获授权，请联系管理员为账号分配角色。");
  return role;
}

/** 分组属于页面数据契约，中文导航文案不参与缓存标识。 */
export function pageSections(route: WorkspaceRoute): WorkspaceSection[] {
  const { role, page } = route;
  if (role === "student") return ["teaching", "progress", ...(page === "tasks" ? ["curriculum" as const] : [])];
  if (role === "teacher") {
    const sections: WorkspaceSection[] = ["teaching", "progress"];
    if (page === "scenarios" || page === "readings" || page === "practice") return sections;
    if (page === "lessons") return [...sections, "lessons", "content"];
    if (page === "overview") return [...sections, "curriculum"];
    return [...sections, "curriculum", "trials"];
  }
  if (role === "guardian") return ["progress", ...(page === "tasks" ? ["teaching" as const, "curriculum" as const] : page === "consents" ? ["consents" as const] : [])];
  const sections: Record<string, WorkspaceSection[]> = {
    overview: ["teaching", "members", "content", "quality", "trials", "progress"],
    settings: ["settings"], content: ["content", "curriculum"], members: ["members", "teaching"],
    audits: ["audits", "members"], knowledge: [],
  };
  return sections[page] ?? [];
}
