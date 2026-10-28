import type { ReadingLesson } from "./reading-lessons";

export type WritingResult = { mode: "trace" | "recall"; mistakes: number; hints: number; elapsedMs: number };
export type ReadingResult = { correct: number; total: number; answers: Array<{ word: string; selected: string; meaning: string; correct: boolean }> };
export type PracticeRecord = { id: string; kind: "writing" | "reading"; referenceId: string; journeyRunId: string | null; title: string; result: WritingResult | ReadingResult; createdAt: string };
export type PracticeHistory = { records: PracticeRecord[]; writtenCharacters: string[] };
export type JourneyDefinition = { lessonId: string; characters: string[] };
export type JourneySummary = { id: string; title: string; className: string; lessonTitle: string; characters: string[]; revision: number };
export type JourneyRun = { id: string; scenarioId: string; title: string; className: string; stage: number; lesson: ReadingLesson; characters: string[]; dialogueSessionId: string; available: boolean; records: PracticeRecord[]; dialogue: { steps: number; total: number; hints: number }; createdAt: string };
export type JourneyCatalog = { journeys: JourneySummary[]; runs: JourneyRun[] };

export function practiceError(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "journey_unavailable") return "任务已归档或班级权限有变化，已有练习仍可回看。";
  if (code === "journey_stage_locked") return "请先完成前一关，再继续当前练习。";
  if (code === "practice_record_conflict") return "本次记录与已有内容不一致，请重新读取后再开始一轮。";
  if (code === "reading_lesson_changed") return "老师已更新课文，请重新加载当前课文后再进行自测。原有选择仍保留。";
  if (code === "reading_lesson_unavailable") return "课文已归档或班级权限有变化，已有练习记录仍保留。";
  return "记录尚未确认保存，请保留当前页面并重试。";
}
