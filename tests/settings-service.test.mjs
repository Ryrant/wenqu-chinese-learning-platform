import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function loadSettingsModule() {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-settings-"));
  const source = await readFile(new URL("app/lib/platform-settings.ts", root), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "app/lib/platform-settings.ts",
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, "platform-settings.js"), transpiled.outputText, "utf8");
  return {
    module: await import(`${pathToFileURL(join(directory, "platform-settings.js")).href}?${Date.now()}`),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function fakeDb(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    prepare(query) {
      return {
        query,
        bound: [],
        bind(...bound) { this.bound = bound; return this; },
        async all() {
          return { success: true, meta: { changes: 0 }, results: Array.from(values, ([key, value]) => ({ key, value })) };
        },
        async run() {
          if (/INSERT INTO app_settings/.test(query)) values.set(String(this.bound[0]), String(this.bound[1]));
          if (/UPDATE app_settings/.test(query)) values.set(String(this.bound[1]), String(this.bound[0]));
          return { success: true, meta: { changes: 1 }, results: [] };
        },
      };
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
      return [];
    },
  };
}

test("platform settings load safe defaults without deployment variables", async () => {
  const { module, cleanup } = await loadSettingsModule();
  try {
    const settings = await module.loadPlatformSettings(fakeDb());
    assert.equal(settings.jwtTtlSeconds, 604800);
    assert.equal(settings.aiModel, "gpt-5.6-luna");
    assert.equal(settings.openAiKey, "");
    assert.equal(settings.aiKey, "");
    assert.equal(settings.speechKey, "");
    assert.equal(settings.moderationKey, "");
  } finally { await cleanup(); }
});

test("public platform settings mask secrets and expose only suffixes", async () => {
  const { module, cleanup } = await loadSettingsModule();
  try {
    const settings = await module.loadPlatformSettings(fakeDb({ openai_api_key: "sk-test-secret-123456", speech_api_key: "speech-secret-7890", moderation_api_key: "mod-key" }));
    assert.deepEqual(module.publicPlatformSettings(settings).openAiKey, { configured: true, suffix: "3456" });
    assert.deepEqual(module.publicPlatformSettings(settings).speechKey, { configured: true, suffix: "7890" });
    assert.deepEqual(module.publicPlatformSettings(settings).moderationKey, { configured: true, suffix: "-key" });
  } finally { await cleanup(); }
});

test("saving settings preserves existing secrets when input is empty", async () => {
  const { module, cleanup } = await loadSettingsModule();
  try {
    const db = fakeDb({ openai_api_key: "sk-existing-secret", ai_model: "old-model" });
    const publicSettings = await module.savePlatformSettings(db, { openAiKey: "", aiModel: "new-model", speechKey: "speech-new" });
    assert.equal(db.values.get("openai_api_key"), "sk-existing-secret");
    assert.equal(db.values.get("ai_model"), "new-model");
    assert.equal(db.values.get("speech_api_key"), "speech-new");
    assert.deepEqual(publicSettings.openAiKey, { configured: true, suffix: "cret" });
  } finally { await cleanup(); }
});

test("saving settings validates jwt ttl and trims model names", async () => {
  const { module, cleanup } = await loadSettingsModule();
  try {
    const db = fakeDb();
    await assert.rejects(module.savePlatformSettings(db, { jwtTtlSeconds: 30 }), /invalid_jwt_ttl_seconds/);
    await module.savePlatformSettings(db, { jwtTtlSeconds: 3600, aiModel: "  gpt-test  " });
    assert.equal(db.values.get("jwt_ttl_seconds"), "3600");
    assert.equal(db.values.get("ai_model"), "gpt-test");
  } finally { await cleanup(); }
});
