import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../app/lib/auth-token.ts", import.meta.url);
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
const { createSessionToken, verifySessionToken } = await import(moduleUrl);
const secret = "behavior-test-secret";
const session = {
  email: "admin@wenqu.test",
  displayName: "测试管理员",
  iat: 1_000,
  exp: 2_000,
};

test("createSessionToken creates a token that verifySessionToken accepts", async () => {
  const token = await createSessionToken(session, secret);
  assert.deepEqual(await verifySessionToken(token, secret, 1_500), session);
});

test("verifySessionToken rejects an expired token", async () => {
  const token = await createSessionToken(session, secret);
  assert.equal(await verifySessionToken(token, secret, session.exp), null);
});

test("verifySessionToken rejects malformed and incorrectly signed tokens", async () => {
  const token = await createSessionToken(session, secret);
  const [header, payload, signature] = token.split(".");
  const changedFirstByte = signature.startsWith("A") ? "B" : "A";
  const badSignature = `${header}.${payload}.${changedFirstByte}${signature.slice(1)}`;

  for (const candidate of ["not-a-token", `${token}.extra`, `${header}.${payload}.!!`, badSignature]) {
    assert.equal(await verifySessionToken(candidate, secret, 1_500), null);
  }
  assert.equal(await verifySessionToken(token, "wrong-secret", 1_500), null);
});

test("auth token helper has no JWT package dependency", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies }), /jose|jsonwebtoken/);
});
