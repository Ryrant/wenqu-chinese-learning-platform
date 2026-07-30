import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ai provider modules use Responses API and keep template fallback", async () => {
  const [provider, openai, template, grounding, envExample] = await Promise.all([
    read("app/lib/ai/provider.ts"),
    read("app/lib/ai/openai-provider.ts"),
    read("app/lib/ai/template-provider.ts"),
    read("app/lib/ai/grounding.ts"),
    read(".env.example"),
  ]);
  assert.match(provider, /export type AiProvider/);
  assert.match(openai, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(openai, /gpt-5\.6-luna/);
  assert.match(openai, /OPENAI_API_KEY/);
  assert.match(template, /source-grounded-template/);
  assert.match(grounding, /no_reviewed_sources/);
  assert.match(envExample, /OPENAI_API_KEY=/);
  assert.match(envExample, /AI_MODEL=gpt-5\.6-luna/);
});

test("knowledge search route delegates to retrieval service", async () => {
  const [retrieval, route] = await Promise.all([
    read("app/lib/retrieval.ts"),
    read("app/api/v1/knowledge/search/route.ts"),
  ]);
  assert.match(retrieval, /export async function searchPublishedKnowledge/);
  assert.match(retrieval, /processing_status='published'/);
  assert.match(retrieval, /matchReason/);
  assert.match(route, /searchPublishedKnowledge/);
});
