import type { Act, Notify, WorkspaceData } from "@/lib/platform-types";
import { stringValue } from "@/lib/platform-types";

export type BaseProps = { nav: string; data: WorkspaceData; act: Act; notify: Notify };

export type GuardianProps = BaseProps & { selectStudent: (studentId: string) => Promise<void> };

export type AdminProps = BaseProps & { refresh: () => Promise<void> };

export function localDate(value: unknown) {
  const raw = stringValue(value, "");
  if (!raw) return "时间未记录";
  const date = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

export function textSummary(value: unknown, fallback: string, maxLength = 110) {
  const text = stringValue(value, fallback).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
