import type { ReadingLesson } from "./reading-lessons";
import type { DialogueScenario, PublicDialogueScenario } from "./dialogue-types";
import type { PracticeDetail, PracticeMetric, PracticeTimelineEntry } from "./practice-types";

export type PracticeTaskKind = "reading" | "writing" | "dictation" | "journey";
export type PracticeTaskSnapshot = {
  kind: PracticeTaskKind; lesson?: ReadingLesson; characters?: string[]; scenario?: DialogueScenario;
  dictationKind?: "words" | "sentences"; items?: Array<{ expected: string; pinyin: string; sourceTitle: string }>;
};
export type PracticeTask = {
  id: string; classId: string; className: string; studentId: string; studentName: string;
  title: string; detail: string; dueAt: string | null; status: "pending" | "completed"; archivedAt: string | null;
  available: boolean; snapshot: Omit<PracticeTaskSnapshot, "scenario"> & { scenario?: PublicDialogueScenario }; createdAt: string; completedAt: string | null;
  activities: Array<{ kind: PracticeTaskKind; id: string }>; writtenCharacters: string[]; href: string;
};
export type PracticeTasks = { tasks: PracticeTask[] };
export type ClassroomPractice = {
  classes: Array<{ id: string; name: string }>; students: Array<{ id: string; name: string; classId: string }>;
  classId: string; studentId: string; period: 7 | 30; rangeStart: string; asOf: string;
  metrics: PracticeMetric[]; consentedStudents: number; studentCount: number;
  tasks: { total: number; completed: number; paused: number };
  wrongWords: Array<{ word: string; count: number; kind: "reading" | "dictation"; recordId: string; studentId: string }>;
  records: Array<PracticeTimelineEntry & { studentId: string; studentName: string; className: string }>;
  currentCursor: string; nextCursor: string | null;
};
export type ClassroomPracticeDetail = PracticeDetail;
export const practiceTaskLabels: Record<PracticeTaskKind, string> = { reading: "阅读自测", writing: "指定汉字", dictation: "课文听写", journey: "主题三关" };
export function practiceTaskError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "";
  if (message === "practice_task_unavailable") return "安排或来源已归档，或学籍已变化。已有记录仍保留，本次不能继续推进。";
  if (message === "practice_task_conflict") return "安排内容与已保存记录不一致，请重新读取。当前输入仍保留。";
  if (message === "practice_task_required") return "此安排根据实际练习自动完成，请从安排入口继续。";
  if (message === "invalid_practice_character") return "请填写字库中的 1–12 个不同汉字。";
  if (message === "reading_lesson_changed" || message === "reading_lesson_unavailable") return "课文已更新或不再可用，请重新读取并核对内容后发布。填写内容仍保留。";
  return "安排暂未保存，请保留当前输入并重试。";
}
