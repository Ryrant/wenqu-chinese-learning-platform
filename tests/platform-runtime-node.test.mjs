import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function importRuntimeNode() {
  const [runtimeSource, nodeSource] = await Promise.all([
    readFile(new URL("app/lib/platform-runtime.ts", root), "utf8"),
    readFile(new URL("app/lib/platform-runtime-node.ts", root), "utf8"),
  ]);
  const runtimeJs = ts.transpileModule(runtimeSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "platform-runtime.ts",
  }).outputText;
  const nodeJs = ts.transpileModule(nodeSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "platform-runtime-node.ts",
  }).outputText.replace(
    'import { setPlatformRuntime } from "./platform-runtime";',
    runtimeJs,
  );
  return import(`data:text/javascript;base64,${Buffer.from(nodeJs).toString("base64")}`);
}

test("NodeSqliteDatabase implements D1-like prepare bind first all run and batch", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "huawen-zhixing-sqlite-"));
  try {
    const { NodeSqliteDatabase } = await importRuntimeNode();
    const db = new NodeSqliteDatabase(`file:${path.join(dir, "huawen-zhixing.db")}`);
    await db.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)").run();
    const insert = await db.prepare("INSERT INTO users (id,name) VALUES (?,?)").bind("u1", "测试用户").run();
    assert.equal(insert.meta.changes, 1);
    assert.deepEqual(await db.prepare("SELECT id,name FROM users WHERE id=?").bind("u1").first(), { id: "u1", name: "测试用户" });
    assert.deepEqual((await db.prepare("SELECT id,name FROM users ORDER BY id").all()).results, [{ id: "u1", name: "测试用户" }]);
    const batch = await db.batch([
      db.prepare("INSERT INTO users (id,name) VALUES (?,?)").bind("u2", "教师"),
      db.prepare("UPDATE users SET name=? WHERE id=?").bind("教师甲", "u2"),
    ]);
    assert.equal(batch[0].meta.changes, 1);
    assert.equal(batch[1].meta.changes, 1);
    assert.deepEqual(await db.prepare("SELECT name FROM users WHERE id=?").bind("u2").first(), { name: "教师甲" });
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LocalFileStorage writes reads and rejects traversal keys", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "huawen-zhixing-storage-"));
  try {
    const { LocalFileStorage } = await importRuntimeNode();
    const storage = new LocalFileStorage(dir);
    await storage.put("tenant-a/sources/doc-1/story.txt", new Blob(["中秋故事"]).stream(), {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { tenantId: "tenant-a" },
    });
    const object = await storage.get("tenant-a/sources/doc-1/story.txt");
    assert.ok(object);
    assert.equal(await object.text(), "中秋故事");
    assert.equal(object.httpMetadata.contentType, "text/plain");
    const expected = new TextEncoder().encode("中秋故事");
    const bytes = await object.arrayBuffer();
    assert.ok(bytes instanceof ArrayBuffer);
    assert.deepEqual(new Uint8Array(bytes), expected);
    assert.deepEqual(new Uint8Array(await new Response(object.body).arrayBuffer()), expected);
    new Uint8Array(bytes).fill(0);
    assert.deepEqual(new Uint8Array(await object.arrayBuffer()), expected);
    await assert.rejects(() => storage.put("../escape.txt", new Blob(["bad"]).stream()), /invalid_storage_key/);
    await assert.rejects(() => storage.get("tenant-a/../../escape.txt"), /invalid_storage_key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
