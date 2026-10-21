import { ApiError } from "./api";

/** 对象权限错误保留当前会话；只有身份或整个账号的访问资格失效才清空工作区。 */
export function workspaceAccessFailure(reason: unknown) {
  if (!(reason instanceof ApiError)) return null;
  if (reason.code === "password_change_required") return "password-change" as const;
  if (reason.code === "account_access_denied") return "account-denied" as const;
  if (reason.status === 401 || reason.code === "session_changed") return "signed-out" as const;
  return null;
}

export function errorMessage(reason: unknown) {
  if (reason instanceof ApiError) {
    if (reason.code === "session_changed") return "登录账号或所属机构已改变，请重新登录后进入工作区。";
    if (reason.status === 401) return "请先登录";
    if (reason.code === "account_access_denied") return "当前账号未获授权，请联系管理员分配角色。";
    if (reason.code === "forbidden") return "当前账号没有执行此操作的权限。";
    if (reason.code === "password_change_required") return "请先修改临时密码";
    if (reason.code === "enrollment_conflict") return "班级名单已被其他会话修改，请读取最新名单后重新编班。";
    if (reason.code === "member_account_external") return "该邮箱已用于其他机构账号，不能直接添加为本机构成员。";
    if (reason.code === "shared_account_password_reset") return "该账号关联了多个机构，请由账号本人修改密码。";
    if (reason.code === "member_email_conflict") return "该邮箱与已有账号标识冲突，请核对账号信息。";
    if (reason.code === "document_version_conflict") return "资料已被其他会话更新，请刷新后重试。";
    if (reason.code === "invalid_guardian_id") return "所选家长账号已不可用，请刷新成员列表。";
    if (reason.code === "invalid_student_ids") return "所选学生账号已不可用，请刷新成员列表。";
  }
  return reason instanceof Error ? reason.message : "请求失败，请稍后重试。";
}
