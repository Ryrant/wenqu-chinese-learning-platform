export type VocabularyReviewQuestion = { vocabularyId: string; kind: "meaning" | "cloze"; prompt: string; options: string[] };
export type VocabularyReviewFeedback = { requestId: string; word: string; selected: string; answer: string; meaning: string; example: string; correct: boolean; repeated: boolean; nextDueAt: string | null };
export type VocabularyReviewSession = { id: string; mode: "due" | "free"; revision: number; total: number; remaining: number; attemptCount: number; firstCorrect: number; complete: boolean; question: VocabularyReviewQuestion | null; feedback: VocabularyReviewFeedback | null; createdAt: string };
export type VocabularyReviewCatalog = { totalWords: number; dueCount: number; nextDueAt: string | null; active: VocabularyReviewSession | null; recent: VocabularyReviewSession[] };
export function vocabularyReviewError(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "vocabulary_review_changed") return "本轮记录已更新，正在重新读取；本次选择尚未提交。";
  if (code === "vocabulary_review_empty") return "当前没有可安排的词语，可以收藏新词或选择自由练习。";
  if (code === "vocabulary_review_conflict") return "请求与已有记录不一致，请重新读取本轮后继续。";
  return "本次结果尚未确认，请重新读取或用相同选择重试。";
}
