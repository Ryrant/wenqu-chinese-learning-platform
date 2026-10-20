import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  PlatformDatabase,
  PlatformPreparedStatement,
  PlatformRuntime,
  PlatformStorage,
  PlatformStoredObject,
  StoragePutOptions,
} from "./platform-runtime";
import { setPlatformRuntime } from "./platform-runtime";

type SqliteStatement = {
  all(...values: unknown[]): Record<string, unknown>[];
  get(...values: unknown[]): Record<string, unknown> | undefined;
  run(...values: unknown[]): { changes: number; lastInsertRowid: number | bigint };
};

export type NodeRuntimeInput = {
  databaseUrl?: string;
  uploadDir?: string;
};

function databasePathFromUrl(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) throw new Error("invalid_database_url");
  const databasePath = databaseUrl.slice("file:".length);
  if (!databasePath) throw new Error("invalid_database_url");
  return databasePath;
}

function rowToPlainObject(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row));
}

export class NodeSqlitePreparedStatement implements PlatformPreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = rowToPlainObject((this.database.prepare(this.query) as unknown as SqliteStatement).get(...this.values));
    if (!row) return null;
    if (column) return (row[column] ?? null) as T | null;
    return row as T;
  }

  async all<T = Record<string, unknown>>() {
    return {
      results: (this.database.prepare(this.query) as unknown as SqliteStatement).all(...this.values).map((row) => Object.fromEntries(Object.entries(row))) as T[],
      success: true,
      meta: { changes: 0 },
    };
  }

  async run<T = unknown>() {
    return this.runSynchronously<T>();
  }

  static batchRunner<T>(statement: PlatformPreparedStatement, database: DatabaseSync) {
    if (!(statement instanceof NodeSqlitePreparedStatement)
      || statement.database !== database
      || statement.run !== NodeSqlitePreparedStatement.prototype.run) {
      throw new Error("invalid_batch_statement");
    }
    return () => statement.runSynchronously<T>();
  }

  private runSynchronously<T>() {
    const result = (this.database.prepare(this.query) as unknown as SqliteStatement).run(...this.values);
    return {
      results: [] as T[],
      success: true,
      meta: { changes: result.changes, last_row_id: String(result.lastInsertRowid) },
    };
  }
}

export class NodeSqliteDatabase implements PlatformDatabase {
  private readonly database: DatabaseSync;

  constructor(databaseUrl: string) {
    const databasePath = databasePathFromUrl(databaseUrl);
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA journal_mode = WAL");
  }

  prepare(query: string) {
    return new NodeSqlitePreparedStatement(this.database, query);
  }

  async batch<T = unknown>(statements: PlatformPreparedStatement[]) {
    // 先校验来源；事务内只执行同步 SQLite 调用，避免让并发请求进入同一连接。
    const runners = statements.map((statement) => NodeSqlitePreparedStatement.batchRunner<T>(statement, this.database));
    this.database.exec("BEGIN");
    try {
      const results = runners.map((run) => run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch (rollbackError) {
        // OR ROLLBACK 等语句可能已结束事务，保留原始 SQL 错误供调用方处理。
        if (!(rollbackError instanceof Error && rollbackError.message === "cannot rollback - no transaction is active")) {
          throw new AggregateError([error, rollbackError], "sqlite_batch_rollback_failed", { cause: error });
        }
      }
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

function assertStoragePath(root: string, key: string) {
  if (!key || key.includes("\0") || key.includes("\\")) throw new Error("invalid_storage_key");
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, key);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) throw new Error("invalid_storage_key");
  return target;
}

async function streamToBuffer(body: ReadableStream) {
  return Buffer.from(await new Response(body).arrayBuffer());
}

export class LocalFileStorage implements PlatformStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, body: ReadableStream, options: StoragePutOptions = {}) {
    const target = assertStoragePath(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await streamToBuffer(body));
    await writeFile(`${target}.meta.json`, JSON.stringify({
      httpMetadata: options.httpMetadata ?? {},
      customMetadata: options.customMetadata ?? {},
    }), "utf8");
  }

  async get(key: string): Promise<PlatformStoredObject | null> {
    const target = assertStoragePath(this.root, key);
    let data: Buffer<ArrayBuffer>;
    try {
      data = await readFile(target);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }

    let metadata: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } = {};
    try {
      metadata = JSON.parse(await readFile(`${target}.meta.json`, "utf8"));
    } catch {
      metadata = {};
    }

    return {
      body: new Blob([data]).stream(),
      httpMetadata: metadata.httpMetadata ?? {},
      customMetadata: metadata.customMetadata ?? {},
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => data.toString("utf8"),
    };
  }
}

export async function createNodeRuntime(input: NodeRuntimeInput = {}): Promise<PlatformRuntime> {
  const databaseUrl = input.databaseUrl ?? process.env.DATABASE_URL ?? "file:./data/huawen-zhixing.db";
  const uploadDir = input.uploadDir ?? process.env.UPLOAD_DIR ?? "./data/uploads";
  const databasePath = databasePathFromUrl(databaseUrl);
  await mkdir(dirname(resolve(databasePath)), { recursive: true });
  await mkdir(uploadDir, { recursive: true });
  return {
    kind: "node",
    database: new NodeSqliteDatabase(databaseUrl),
    storage: new LocalFileStorage(uploadDir),
  };
}

export async function installNodeRuntime(input: NodeRuntimeInput = {}) {
  const runtime = await createNodeRuntime(input);
  setPlatformRuntime(runtime);
  return runtime;
}
