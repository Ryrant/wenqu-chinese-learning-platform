import type { AiGenerationInput, AiGenerationResult, AiProvider } from "./provider";
import { buildTemplateAnswer } from "./template-answer.mjs";

export function createTemplateProvider(): AiProvider {
  return {
    name: "local",
    model: "source-grounded-template",
    async generateText(input: AiGenerationInput): Promise<AiGenerationResult> {
      const citations = input.contextChunks.map((chunk) => ({ id: chunk.id, title: chunk.title, excerpt: chunk.excerpt }));
      return {
        text: buildTemplateAnswer(input.prompt, input.contextChunks.map((chunk) => chunk.excerpt)),
        provider: "local",
        model: "source-grounded-template",
        status: "template",
        inputTokens: 0,
        outputTokens: 0,
        citations,
      };
    },
  };
}
