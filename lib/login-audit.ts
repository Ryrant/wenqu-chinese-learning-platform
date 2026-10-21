import { isIP } from "node:net";
import { auditStatement } from "./audit";
import type { PlatformDatabase, PlatformRuntime } from "./platform-runtime";

export function loginClientIp(request: Request, kind: PlatformRuntime["kind"], remoteAddress?: string) {
  // Workers 的来源头由平台提供；Node 默认使用套接字地址，转发头须显式信任代理后启用。
  const address = kind === "cloudflare"
    ? request.headers.get("CF-Connecting-IP")
    : kind === "node" && process.env.HUAWEN_ZHIXING_TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",")[0] ?? remoteAddress
      : remoteAddress;
  const ip = address?.trim();
  return ip && isIP(ip) ? ip : null;
}

export type LoginAuditDetail = { email: string; ip: string | null; userAgent: string | null };

export async function recordFailedLoginAudit(db: PlatformDatabase, detail: LoginAuditDetail, reason: string) {
  // 未知邮箱没有可证明的机构归属，不能将匿名尝试写入任意机构。
  const account = await db.prepare(`SELECT u.id,rm.tenant_id AS tenantId
    FROM users u JOIN role_memberships rm ON rm.user_id=u.id JOIN tenants t ON t.id=rm.tenant_id
    WHERE lower(u.email)=? AND rm.role IN ('student','teacher','guardian','admin')
    ORDER BY CASE WHEN rm.status='active' AND t.status='active' THEN 0 ELSE 1 END,rm.created_at ASC,rm.id ASC LIMIT 1`)
    .bind(detail.email).first<{ id: string; tenantId: string }>();
  if (!account) return;
  await auditStatement(db, account.tenantId, account.id, "auth.login_failed", "user", account.id, {
    ...detail, result: "failure", reason,
  }).run();
}
