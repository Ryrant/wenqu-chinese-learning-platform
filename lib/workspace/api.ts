import type { WorkspacePatch, WorkspaceSection } from "../platform-types";

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const text = await response.text();
  let body: unknown;
  try { body = text.trim() ? JSON.parse(text) : {}; }
  catch { throw new ApiError(response.status, `接口返回的不是有效 JSON（HTTP ${response.status}）`); }
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "请求失败";
    throw new ApiError(response.status, code);
  }
  return body as T;
}

export function readWorkspace(sections: readonly WorkspaceSection[], studentId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ include: sections.length ? sections.join(",") : "bootstrap" });
  if (studentId) query.set("studentId", studentId);
  return requestJson<WorkspacePatch>(`/api/v1/workspace?${query}`, { signal, cache: "no-store" });
}

export function postJson<T>(url: string, body: Record<string, unknown>) {
  return requestJson<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
