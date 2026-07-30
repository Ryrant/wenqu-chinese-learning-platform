type D1Result<T = unknown> = { results: T[]; success: boolean; meta: { changes: number; [key: string]: unknown } };
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
};
type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};
type R2Bucket = {
  put(key: string, value: ReadableStream | ArrayBuffer | string, options?: unknown): Promise<unknown>;
  get(key: string): Promise<unknown>;
};
type Fetcher = { fetch(request: Request): Promise<Response> };

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    CONTENT: R2Bucket;
    [key: string]: unknown;
  };
}
