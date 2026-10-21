import type { LearningSequence, SequenceSource } from "./learning-sequence-types";
import type { TrialEntry } from "./trial-types";
import type { EvidencePlanItem } from "./learning-plan-types";
import type { LearningAnalyticsState } from "./learning-analytics";

export type Role = "student" | "teacher" | "guardian" | "admin";
export type Row = Record<string, unknown>;
export const FAMILY_HELP_LABELS: Record<string, string> = { independent: "独立完成", prompted: "提供了提示", assisted: "共同完成或较多帮助" };
export type MemberRow = Row & { id: string; email: string; displayName: string; status: string; roles: string };
export type GuardianLinkRow = Row & { guardianUserId: string; studentUserId: string; status: string };
export type SecretStatus = { configured: boolean; suffix: string };
export type PublicPlatformSettings = {
  jwtTtlSeconds: number;
  aiModel: string;
  aiKey: SecretStatus;
  openAiKey: SecretStatus;
  speechKey: SecretStatus;
  moderationKey: SecretStatus;
};
export type QualityMetricDetail = { id: string; label: string; meta?: string };
export type QualityMetric = {
  label: string;
  value: number;
  numerator: number;
  denominator: number;
  unit: "percent" | "count";
  note: string;
  details: QualityMetricDetail[];
  trendAvailable: boolean;
  available?: boolean;
};
export type QualityMetrics = Record<string, QualityMetric>;
export type WorkspaceData = {
  workspace: { tenantId: string; name: string; region: string };
  user: { id: string; email: string; displayName: string; roles: Role[]; mustChangePassword?: boolean };
  classes: Row[]; assignments: Row[]; submissions: Row[]; submissionReviews: Row[]; mastery: Row[]; documents: Row[];
  lessonPlans: Row[]; notifications: Row[]; consents: Row[]; audits: Row[]; members: MemberRow[]; guardianLinks: GuardianLinkRow[];
  learningObjectives: Row[]; diagnosticItems: Row[]; diagnosticSummary: Row | null; recommendations: Row[]; learningPlan: EvidencePlanItem[];
  learningSequences: LearningSequence[]; sequenceSources: SequenceSource[];
  trialEntries: TrialEntry[];
  availableStudents: Array<{ id: string; displayName: string }>; selectedStudent: { id: string; displayName: string } | null;
  weeklyReport: { submittedCount: number | null; reviewedCount: number | null; averageScore: number | null; masteryAverage: number | null; pendingRecommendations: number | null } & Partial<LearningAnalyticsState>;
  masteryMatrix: Row[]; qualityMetrics: QualityMetrics | null; enrollments: Row[];
  services: Record<string, { status: string; label: string }>;
  platformSettings?: PublicPlatformSettings;
  generatedAt: string;
};
export const WORKSPACE_SECTIONS = ["teaching", "curriculum", "progress", "lessons", "content", "members", "notifications", "consents", "audits", "quality", "trials", "settings"] as const;
export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number];
export type WorkspaceBootstrap = Pick<WorkspaceData, "workspace" | "user" | "availableStudents" | "selectedStudent" | "generatedAt">;
export type WorkspacePatch = WorkspaceBootstrap & Partial<Omit<WorkspaceData, keyof WorkspaceBootstrap>>;

export type Notify = (title: string, detail: string, tone?: "success" | "error") => void;
export type Act = (action: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export const stringValue = (value: unknown, fallback = "—") => typeof value === "string" && value ? value : fallback;
export const numberValue = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
