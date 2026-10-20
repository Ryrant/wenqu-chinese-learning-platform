import { readCommandSources, readRoleSources } from "./helpers/source-files.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ai provider modules use Responses API and keep template fallback", async () => {
  const [provider, openai, template, grounding, envExample] = await Promise.all([
    read("lib/ai/provider.ts"),
    read("lib/ai/openai-provider.ts"),
    read("lib/ai/template-provider.ts"),
    read("lib/ai/grounding.ts"),
    read(".env.example"),
  ]);
  assert.match(provider, /export type AiProvider/);
  assert.match(openai, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(openai, /gpt-5\.6-luna/);
  assert.doesNotMatch(openai, /OPENAI_API_KEY|AI_API_KEY/);
  assert.match(template, /source-grounded-template/);
  assert.match(grounding, /no_reviewed_sources/);
  assert.doesNotMatch(envExample, /OPENAI_API_KEY=|AI_API_KEY=|AI_MODEL=/);
});

test("knowledge search route delegates to retrieval service", async () => {
  const [retrieval, route] = await Promise.all([
    read("lib/retrieval.ts"),
    read("app/api/v1/knowledge/search/route.ts"),
  ]);
  assert.match(retrieval, /export async function searchPublishedKnowledge/);
  assert.match(retrieval, /processing_status='published'/);
  assert.match(retrieval, /matchReason/);
  assert.match(retrieval, /cjkWindows/);
  assert.match(route, /searchPublishedKnowledge/);
});

test("student and teacher generation use grounded provider chain", async () => {
  const [generate, actions, student, staff] = await Promise.all([
    read("app/api/v1/ai/generate/route.ts"),
    readCommandSources(),
    readRoleSources("student"),
    readRoleSources("teacher", "guardian", "admin"),
  ]);
  assert.match(generate, /searchPublishedKnowledge/);
  assert.match(generate, /generateGroundedText/);
  assert.match(generate, /loadPlatformSettings/);
  assert.match(generate, /aiProviderSettings/);
  assert.doesNotMatch(generate, /OPENAI_API_KEY|AI_API_KEY|AI_MODEL/);
  assert.match(generate, /status: result\.status/);
  assert.match(actions, /generateGroundedText/);
  assert.match(actions, /loadPlatformSettings/);
  assert.match(actions, /aiProviderSettings/);
  assert.doesNotMatch(actions, /OPENAI_API_KEY|AI_API_KEY|AI_MODEL/);
  assert.match(actions, /input_tokens,output_tokens/);
  assert.match(student, /no_reviewed_sources/);
  assert.match(student, /sources\.map\(/);
  assert.match(student, /source\.title/);
  assert.match(student, /source\.excerpt/);
  assert.match(staff, /generated\.citations/);
  assert.match(staff, /act\("generate_lesson"/);
});
