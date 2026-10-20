import type { Act, Notify, WorkspaceData } from "@/lib/platform-types";
import { stringValue } from "@/lib/platform-types";

export type LoopProps = { data: WorkspaceData; act: Act; notify: Notify };

export function optionsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function dueLabel(value: unknown) {
  const raw = stringValue(value, "");
  if (!raw) return "无截止时间";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fullDateLabel(value: unknown) {
  const raw = stringValue(value, "");
  if (!raw) return "暂无更新时间";
  const date = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
