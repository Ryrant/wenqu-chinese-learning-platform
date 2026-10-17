import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../app/lib/auth-password.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
  reportDiagnostics: true,
});
const errors = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
assert.deepEqual(errors, []);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { hashPassword, verifyPassword } = await import(moduleUrl);

test("password hashing stays within Cloudflare Workers PBKDF2 iteration limit", () => {
  const match = source.match(/const iterations = ([\d_]+);/);
  assert.ok(match, "iterations constant should be explicit");
  const iterations = Number(match[1].replaceAll("_", ""));
  assert.ok(iterations <= 100000, "Cloudflare Workers rejects PBKDF2 iteration counts above 100000");
});

test("password hashes verify the original password and reject another password", async () => {
  const hash = await hashPassword("TempPass-1234", new Uint8Array(16).fill(7));
  assert.match(hash, /^pbkdf2-sha256\$100000\$/);
  assert.equal(await verifyPassword("TempPass-1234", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("password hashing uses only the salt view bytes with ordinary and shared backing buffers", async () => {
  const expected = await hashPassword("TempPass-1234", new Uint8Array(16).fill(7));
  for (const backing of [new ArrayBuffer(24), new SharedArrayBuffer(24)]) {
    new Uint8Array(backing).fill(99);
    const salt = new Uint8Array(backing, 4, 16).fill(7);
    const hash = await hashPassword("TempPass-1234", salt);
    assert.equal(hash, expected);
    assert.equal(await verifyPassword("TempPass-1234", hash), true);
  }
});

test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("TempPass-1234", "not-a-valid-hash"), false);
  assert.equal(await verifyPassword("TempPass-1234", "pbkdf2-sha256$100000$bad$bad"), false);
});
