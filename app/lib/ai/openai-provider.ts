import type { AiGenerationInput, AiGenerationResult, AiProvider } from "./provider";

export function createOpenAiProvider(config: { apiKey?: string; model?: string }): AiProvider | null {
  // apiKey is supplied from the server-only OPENAI_API_KEY environment variable.
  if (!config.apiKey) return null;
  const model = config.model?.trim() || "gpt-5.6-luna";
  return {
    name: "openai",
    model,
    async generateText(input: AiGenerationInput): Promise<AiGenerationResult> {
      const context = input.contextChunks.map((chunk, index) => `[${index + 1}] ${chunk.title}\n${chunk.content}`).join("\n\n");
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: "你是华文教学助手。只能依据给定来源回答。输出必须包含可追溯引用编号。找不到依据时说明无法回答。" },
            { role: "user", content: `用途：${input.purpose}\n水平：${input.level ?? "A2"}\n问题：${input.prompt}\n\n来源：\n${context}` },
          ],
        }),
      });
      if (!response.ok) throw new Error("openai_generation_failed");
      const data = await response.json() as { output_text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = data.output_text?.trim();
      if (!text) throw new Error("openai_empty_output");
      return {
        text,
        provider: "openai",
        model,
        status: "completed",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        citations: input.contextChunks.map((chunk) => ({ id: chunk.id, title: chunk.title, excerpt: chunk.excerpt })),
      };
    },
  };
}
