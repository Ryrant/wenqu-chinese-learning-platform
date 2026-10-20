import { createOpenAiProvider } from "./openai-provider";
import { createTemplateProvider } from "./template-provider";
import type { RetrievedChunk } from "../retrieval";

export type AiPurpose = "tutor" | "lesson" | "review";
export type AiGenerationInput = {
  purpose: AiPurpose;
  prompt: string;
  level?: string;
  role: "student" | "teacher" | "guardian" | "admin";
  contextChunks: RetrievedChunk[];
};
export type AiGenerationResult = {
  text: string;
  provider: string;
  model: string;
  status: "completed" | "template" | "review_required";
  inputTokens: number;
  outputTokens: number;
  citations: Array<{ id: string; title: string; excerpt: string }>;
};
export type AiProvider = {
  name: string;
  model: string;
  generateText(input: AiGenerationInput): Promise<AiGenerationResult>;
};

export function createAiProvider(config: { apiKey?: string; model?: string }): AiProvider {
  return createOpenAiProvider(config) ?? createTemplateProvider();
}
