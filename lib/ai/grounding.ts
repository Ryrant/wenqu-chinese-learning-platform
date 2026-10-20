import { createOpenAiProvider } from "./openai-provider";
import type { AiGenerationInput, AiGenerationResult } from "./provider";
import { createTemplateProvider } from "./template-provider";

export async function generateGroundedText(input: AiGenerationInput, config: { openAiKey?: string; model?: string }): Promise<AiGenerationResult> {
  if (!input.contextChunks.length) throw new Error("no_reviewed_sources");
  const provider = createOpenAiProvider({ apiKey: config.openAiKey, model: config.model });
  if (provider) {
    try {
      return await provider.generateText(input);
    } catch {
      return createTemplateProvider().generateText(input);
    }
  }
  return createTemplateProvider().generateText(input);
}
