import type { PlatformDatabase } from "../platform-runtime";
import type { PlatformContext } from "../platform-store";
import type { WorkspaceActionName } from "../workspace-actions";

export type ActionBody = { action?: string; [key: string]: unknown };
export type WorkspaceActionHandler = (body: ActionBody, context: PlatformContext, action: WorkspaceActionName) => Promise<Response>;

export function text(value: unknown, max = 200) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
export function requireText(value: unknown, name: string, max = 200) { const result = text(value, max); if (!result) throw new Error(`invalid_${name}`); return result; }
export function number(value: unknown, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }

export async function audit(db: PlatformDatabase, tenantId: string, userId: string, action: string, targetType: string, targetId: string, detail: unknown = {}) {
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), tenantId, userId, action, targetType, targetId, JSON.stringify(detail)).run();
}
