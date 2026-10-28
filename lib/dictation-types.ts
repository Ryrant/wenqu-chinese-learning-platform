import type { ReadingLesson } from "./reading-lessons";

export type DictationDifference = { kind: "same" | "missing" | "extra" | "different"; expected: string; actual: string };
export type DictationAnswer = { requestId: string; index: number; expected: string; actual: string; correct: boolean; differences: DictationDifference[]; playCount: number; usedReference: boolean; at: string };
export type DictationSession = { id: string; sourceTitle: string; kind: "vocabulary" | "words" | "sentences"; revision: number; total: number; retryCount: number; index: number; complete: boolean; available: boolean; question: { id: string; speechText: string; sourceTitle: string; referenceVisible: boolean; pinyin: string } | null; answers: DictationAnswer[]; createdAt: string };
export type DictationCatalog = { lessons: Array<Pick<ReadingLesson, "id" | "title" | "level" | "source">>; wordCount: number; retrySessionId: string | null; active: DictationSession | null; recent: DictationSession[] };
export function normalizeDictation(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, ""); }
export function compareDictation(expected: string, actual: string): { correct: boolean; differences: DictationDifference[] } {
  const target = Array.from(normalizeDictation(expected)); const input = Array.from(normalizeDictation(actual));
  const distance = Array.from({ length: target.length + 1 }, (_, row) => Array.from({ length: input.length + 1 }, (_, column) => row === 0 ? column : column === 0 ? row : 0));
  for (let row = 1; row <= target.length; row++) for (let column = 1; column <= input.length; column++) distance[row][column] = Math.min(distance[row - 1][column] + 1, distance[row][column - 1] + 1, distance[row - 1][column - 1] + (target[row - 1] === input[column - 1] ? 0 : 1));
  const differences: DictationDifference[] = []; let row = target.length; let column = input.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0 && distance[row][column] === distance[row - 1][column - 1] + (target[row - 1] === input[column - 1] ? 0 : 1)) {
      differences.push({ kind: target[row - 1] === input[column - 1] ? "same" : "different", expected: target[--row], actual: input[--column] });
    } else if (row > 0 && distance[row][column] === distance[row - 1][column] + 1) differences.push({ kind: "missing", expected: target[--row], actual: "" });
    else differences.push({ kind: "extra", expected: "", actual: input[--column] });
  }
  return { correct: distance[target.length][input.length] === 0, differences: differences.reverse() };
}
export function dictationError(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "dictation_changed") return "本轮进度已更新，正在重新读取；当前输入仍保留。";
  if (code === "dictation_in_progress") return "已有一轮未完成的听写，正在读取进度，请继续或结束后再开始新一轮。";
  if (code === "dictation_source_unavailable" || code === "reading_lesson_unavailable") return "来源已归档或班级权限有变化，已有结果仍可回看。";
  if (code === "reading_lesson_changed") return "课文已更新，请重新读取后再开始听写。";
  if (code === "dictation_empty") return "当前来源没有可用听写内容，请先收藏词语或选择其他课文。";
  if (code === "dictation_no_mistakes") return "这一轮没有需要重练的错项，可以选择新内容继续练习。";
  if (code === "dictation_conflict") return "请求与已有记录不一致，请重新读取后继续。";
  return "本次结果尚未确认，请保留输入并重试或重新读取。";
}
