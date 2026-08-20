import type { PlatformRuntime, PlatformStorage, PlatformStoredObject } from "./platform-runtime";

export type CloudflareRuntimeEnv = {
  DB?: D1Database;
  CONTENT?: R2Bucket;
};

function wrapObject(object: Awaited<ReturnType<R2Bucket["get"]>>): PlatformStoredObject | null {
  if (!object) return null;
  return {
    body: object.body ?? null,
    httpMetadata: object.httpMetadata ?? {},
    customMetadata: object.customMetadata ?? {},
    arrayBuffer: () => object.arrayBuffer(),
    text: () => object.text(),
  };
}

function createStorage(bucket: R2Bucket): PlatformStorage {
  return {
    put: (key, body, options) => bucket.put(key, body, options),
    async get(key) {
      return wrapObject(await bucket.get(key));
    },
  };
}

export function createCloudflareRuntime(env: CloudflareRuntimeEnv): PlatformRuntime {
  return {
    database: env.DB ?? null,
    storage: env.CONTENT ? createStorage(env.CONTENT) : null,
  };
}
