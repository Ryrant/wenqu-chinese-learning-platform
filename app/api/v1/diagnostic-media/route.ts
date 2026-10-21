import { diagnosticMediaKey } from "../../../../lib/diagnostic-media";
import { ensurePlatformRuntime } from "../../../../lib/platform-runtime";
import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { discardFailedUpload } from "../../../../lib/upload-cleanup";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    if (!context.roles.some((role) => role === "admin" || role === "teacher")) throw new Error("forbidden");
    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024
      || (kind !== "audio" && kind !== "image")) throw new Error("invalid_diagnostic_media");
    const validType = kind === "image" ? /^(image\/png|image\/jpeg|image\/webp)$/ : /^(audio\/mpeg|audio\/mp3|audio\/wav|audio\/x-wav|audio\/webm|audio\/ogg|audio\/mp4)$/;
    if (!validType.test(file.type)) throw new Error("invalid_diagnostic_media");
    if (kind === "image") {
      const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const signature = Array.from(bytes).map((byte) => String.fromCharCode(byte)).join("");
      const validImage = file.type === "image/png" ? bytes[0] === 137 && signature.slice(1, 4) === "PNG"
        : file.type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP";
      if (!validImage) throw new Error("invalid_diagnostic_media");
    }
    const storage = (await ensurePlatformRuntime()).storage;
    if (!storage) return Response.json({ error: "storage_unavailable" }, { status: 503 });
    const id = crypto.randomUUID();
    const key = diagnosticMediaKey(context.tenantId, id);
    try {
      await storage.put(key, file.stream(), {
        httpMetadata: { contentType: file.type }, customMetadata: { tenantId: context.tenantId, createdBy: context.userId, kind },
      });
      await context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), context.tenantId, context.userId, "diagnostic_media.created", "diagnostic_media", id, JSON.stringify({ kind })).run();
    } catch (error) {
      await discardFailedUpload(storage, key, error);
      throw error;
    }
    return Response.json({ id }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
