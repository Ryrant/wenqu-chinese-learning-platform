export type PlatformResultMeta = { changes?: number; [key: string]: unknown };

export type PlatformRunResult<T = unknown> = {
  results?: T[];
  success?: boolean;
  meta: PlatformResultMeta;
};

export type PlatformAllResult<T = unknown> = {
  results: T[];
  success?: boolean;
  meta?: PlatformResultMeta;
};

export interface PlatformPreparedStatement {
  bind(...values: unknown[]): PlatformPreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<PlatformAllResult<T>>;
  run<T = unknown>(): Promise<PlatformRunResult<T>>;
}

export interface PlatformDatabase {
  prepare(query: string): PlatformPreparedStatement;
  batch<T = unknown>(statements: PlatformPreparedStatement[]): Promise<Array<PlatformRunResult<T>>>;
}

export type StoragePutOptions = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

export type PlatformStoredObject = {
  body: ReadableStream | null;
  httpMetadata: { contentType?: string };
  customMetadata: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

export interface PlatformStorage {
  put(key: string, body: ReadableStream, options?: StoragePutOptions): Promise<unknown>;
  get(key: string): Promise<PlatformStoredObject | null>;
}

export type PlatformRuntime = {
  kind?: "cloudflare" | "node";
  database: PlatformDatabase | null;
  storage: PlatformStorage | null;
};

let currentRuntime: PlatformRuntime | null = null;
let runtimePromise: Promise<PlatformRuntime> | null = null;

export function setPlatformRuntime(runtime: PlatformRuntime) {
  currentRuntime = runtime;
}

export function getPlatformRuntime() {
  if (currentRuntime) return currentRuntime;
  throw new Error("runtime_unavailable");
}

export async function ensurePlatformRuntime() {
  if (currentRuntime) return currentRuntime;
  if (runtimePromise) return runtimePromise;
  if (typeof process !== "undefined" && process.versions?.node && process.env.HUAWEN_ZHIXING_RUNTIME === "node") {
    const moduleName = "./platform-runtime-node";
    runtimePromise = import(moduleName)
      .then((module: typeof import("./platform-runtime-node")) => module.createNodeRuntime())
      .then((runtime) => {
        currentRuntime = runtime;
        return runtime;
      })
      .catch((error) => {
        runtimePromise = null;
        throw error;
      });
    return runtimePromise;
  }
  throw new Error("runtime_unavailable");
}
