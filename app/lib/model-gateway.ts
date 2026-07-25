export type Citation = { id: string; title: string; source: string; excerpt: string };
export type GenerationRequest = { prompt: string; purpose: "lesson" | "tutor" | "report"; level: string; citations?: Citation[] };
export type GenerationResult = { text: string; citations: Citation[]; provider: string; model: string; safety: "pass" | "review" };
export type PronunciationResult = { score: number; confidence: number; phonemes: Array<{ text: string; score: number }>; feedback: string };

export interface AiProvider {
  generate(input: GenerationRequest): Promise<GenerationResult>;
  embed(texts: string[]): Promise<number[][]>;
  rerank(query: string, documents: string[]): Promise<number[]>;
  transcribe(audio: ArrayBuffer, locale: string): Promise<{ text: string; confidence: number }>;
  synthesize(text: string, voice: string): Promise<ArrayBuffer>;
  scorePronunciation(audio: ArrayBuffer, reference: string): Promise<PronunciationResult>;
  analyzeImage(image: ArrayBuffer, prompt: string): Promise<string>;
  moderate(content: string): Promise<{ safe: boolean; labels: string[] }>;
}

class DemonstrationProvider implements AiProvider {
  async generate(input: GenerationRequest): Promise<GenerationResult> {
    const sourceNote = input.citations?.length ? `参考了 ${input.citations.length} 条已审核知识来源。` : "未检索到可靠来源，结果仅作为草稿。";
    return { text: `《月饼里的团圆》教学草稿\n\n学习目标：学生能够用“我们一家人……”完成口语表达，并理解“团圆”的文化含义。\n\n活动一：看图找线索；活动二：角色对话；活动三：家庭味道小采访。\n\n${sourceNote}`, citations: input.citations ?? [], provider: "demonstration", model: "wenqu-local-template", safety: input.citations?.length ? "pass" : "review" };
  }
  async embed(texts: string[]) { return texts.map((text) => [text.length / 100, 0.42, 0.88]); }
  async rerank(query: string, documents: string[]) { return documents.map((doc) => doc.includes(query) ? 1 : 0.6); }
  async transcribe() { return { text: "一家人一起吃月饼。", confidence: 0.94 }; }
  async synthesize() { return new ArrayBuffer(0); }
  async scorePronunciation() { return { score: 92, confidence: 0.91, phonemes: [{ text: "月饼", score: 96 }, { text: "一起", score: 84 }], feedback: "“月饼”清楚准确；“一起”可以连读得更自然。" }; }
  async analyzeImage() { return "图片中是一家人围坐在桌旁分享月饼，适合练习家庭成员和节日词汇。"; }
  async moderate(content: string) { const blocked = /暴力|自残|色情/.test(content); return { safe: !blocked, labels: blocked ? ["review-required"] : [] }; }
}

export class ModelGateway {
  constructor(private primary: AiProvider, private fallback: AiProvider) {}
  private async withFallback<T>(operation: (provider: AiProvider) => Promise<T>): Promise<T> {
    try { return await operation(this.primary); } catch { return operation(this.fallback); }
  }
  generate(input: GenerationRequest) { return this.withFallback((p) => p.generate(input)); }
  embed(texts: string[]) { return this.withFallback((p) => p.embed(texts)); }
  rerank(query: string, documents: string[]) { return this.withFallback((p) => p.rerank(query, documents)); }
  transcribe(audio: ArrayBuffer, locale = "zh-CN") { return this.withFallback((p) => p.transcribe(audio, locale)); }
  synthesize(text: string, voice = "warm-teacher") { return this.withFallback((p) => p.synthesize(text, voice)); }
  scorePronunciation(audio: ArrayBuffer, reference: string) { return this.withFallback((p) => p.scorePronunciation(audio, reference)); }
  analyzeImage(image: ArrayBuffer, prompt: string) { return this.withFallback((p) => p.analyzeImage(image, prompt)); }
  moderate(content: string) { return this.withFallback((p) => p.moderate(content)); }
}

const demo = new DemonstrationProvider();
export const modelGateway = new ModelGateway(demo, demo);