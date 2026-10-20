import { ensurePlatformRuntime } from "./platform-runtime";
import type { PlatformContext } from "./platform-store";

export const diagnosticMediaKey = (tenantId: string, id: string) => `${tenantId}/diagnostic-media/${id}`;

export async function assertDiagnosticMedia(context: PlatformContext, id: string, kind: "image" | "audio") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_diagnostic_media");
  const object = await (await ensurePlatformRuntime()).storage?.get(diagnosticMediaKey(context.tenantId, id));
  if (!object || object.customMetadata.tenantId !== context.tenantId || object.customMetadata.kind !== kind
    || (!context.roles.includes("admin") && object.customMetadata.createdBy !== context.userId)) throw new Error("invalid_diagnostic_media");
}
