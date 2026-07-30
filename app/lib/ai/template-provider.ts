import type { AiGenerationInput, AiGenerationResult, AiProvider } from "./provider";

export function createTemplateProvider(): AiProvider {
  return {
    name: "local",
    model: "source-grounded-template",
    async generateText(input: AiGenerationInput): Promise<AiGenerationResult> {
      const citations = input.contextChunks.map((chunk) => ({ id: chunk.id, title: chunk.title, excerpt: chunk.excerpt }));
      const sources = input.contextChunks.map((chunk, index) => `[${index + 1}] ${chunk.excerpt}`).join("\n");
      return {
        text: `根据已审核来源，${input.prompt}\n\n可参考：\n${sources}`,
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
