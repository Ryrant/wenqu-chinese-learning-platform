export type Role = "student" | "teacher" | "guardian" | "admin";
export type Row = Record<string, unknown>;
export type MemberRow = Row & { id: string; email: string; displayName: string; status: string; roles: string };
export type GuardianLinkRow = Row & { guardianUserId: string; studentUserId: string; status: string };
export type WorkspaceData = {
  workspace: { tenantId: string; name: string; region: string; sampleData: boolean };
  user: { id: string; email: string; displayName: string; roles: Role[] };
  classes: Row[]; assignments: Row[]; submissions: Row[]; mastery: Row[]; documents: Row[];
  lessonPlans: Row[]; notifications: Row[]; consents: Row[]; audits: Row[]; invitations: Row[]; members: Row[]; guardianLinks: Row[];
  services: Record<string, { status: string; label: string }>;
  generatedAt: string;
};
export type Notify = (title: string, detail: string, tone?: "success" | "error") => void;
export type Act = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export const stringValue = (value: unknown, fallback = "—") => typeof value === "string" && value ? value : fallback;
export const numberValue = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
