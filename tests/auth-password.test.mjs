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

test("password hashes verify the original password and reject another password", async () => {
  const hash = await hashPassword("TempPass-1234", new Uint8Array(16).fill(7));
  assert.match(hash, /^pbkdf2-sha256\$150000\$/);
  assert.equal(await verifyPassword("TempPass-1234", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("TempPass-1234", "not-a-valid-hash"), false);
  assert.equal(await verifyPassword("TempPass-1234", "pbkdf2-sha256$150000$bad$bad"), false);
});
