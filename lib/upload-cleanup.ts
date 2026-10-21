import type { PlatformStorage } from "./platform-runtime";

/** 数据库拒绝上传后移除本次独立对象；清理失败与原始故障一起保留，不能伪称保存成功。 */
export async function discardFailedUpload(storage: PlatformStorage, key: string, originalError: unknown) {
  try {
    await storage.delete(key);
  } catch (cleanupError) {
    console.error("upload_cleanup_failed", { key,
      originalError: originalError instanceof Error ? originalError.message : "unexpected_error",
      cleanupError: cleanupError instanceof Error ? cleanupError.message : "unexpected_error" });
    throw new AggregateError([originalError, cleanupError], "upload_cleanup_failed");
  }
}
