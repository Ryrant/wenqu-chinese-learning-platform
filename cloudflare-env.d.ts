type D1Database = {
  prepare(query: string): unknown;
  batch<T = unknown>(statements: unknown[]): Promise<T[]>;
};
type R2Bucket = {
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: unknown): Promise<unknown>;
  get(key: string): Promise<unknown>;
};
type Fetcher = { fetch(request: Request): Promise<Response> };

declare module "cloudflare:workers" {
  export const env: { DB: D1Database; CONTENT: R2Bucket };
}