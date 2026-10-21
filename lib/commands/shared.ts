import type { PlatformContext } from "../platform-store";
import type { WorkspaceActionName } from "../workspace-actions";

export { auditStatement } from "../audit";

export type ActionBody = { action?: string; [key: string]: unknown };
export type WorkspaceActionHandler = (body: ActionBody, context: PlatformContext, action: WorkspaceActionName) => Promise<Response>;

export function text(value: unknown, max = 200) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
export function requireText(value: unknown, name: string, max = 200) { const result = text(value, max); if (!result) throw new Error(`invalid_${name}`); return result; }
export function number(value: unknown, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
