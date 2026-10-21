import { ensurePlatformRuntime } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";

export const diagnosticMediaKey = (tenantId: string, id: string) => `${tenantId}/diagnostic-media/${id}`;

export async function isDiagnosticMediaCommitted(context: PlatformContext, id: string) {
  return !!await context.db.prepare("SELECT 1 FROM audit_logs WHERE tenant_id=? AND action='diagnostic_media.created' AND target_type='diagnostic_media' AND target_id=? LIMIT 1")
    .bind(context.tenantId, id).first();
}

export async function assertDiagnosticMedia(context: PlatformContext, id: string, kind: "image" | "audio") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_diagnostic_media");
  if (!await isDiagnosticMediaCommitted(context, id)) throw new Error("invalid_diagnostic_media");
  const object = await (await ensurePlatformRuntime()).storage?.get(diagnosticMediaKey(context.tenantId, id));
  if (!object || object.customMetadata.tenantId !== context.tenantId || object.customMetadata.kind !== kind
    || (!context.roles.includes("admin") && object.customMetadata.createdBy !== context.userId)) throw new Error("invalid_diagnostic_media");
}
