import type { ReadingLesson, ReadingTerm } from "./reading-lessons";

export type ReadingTermDraft = ReadingTerm & { id: string };
export type ReadingDraft = { id: string; revision: number; classId: string; title: string; level: string; text: string; terms: ReadingTermDraft[]; focus: string };
export type ReadingDraftScope = { tenantId: string; userId: string };
export type StoredReadingDraft = { version: 1; tenantId: string; userId: string; baseRevision: number; savedAt: string; draft: ReadingDraft };
export const readingDraftTextLimit = 20 * 300 + 19;
type DraftReader = Pick<Storage, "length" | "key" | "getItem">;
type DraftWriter = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const field = (value: unknown, maximum: number) => typeof value === "string" && value.length <= maximum;
export function readingDraftPrefix(scope: ReadingDraftScope) { return "huawen-reading-draft:v1:" + encodeURIComponent(scope.tenantId) + ":" + encodeURIComponent(scope.userId) + ":"; }
function draftKey(scope: ReadingDraftScope, id: string) { return readingDraftPrefix(scope) + encodeURIComponent(id); }
function decode(raw: string, scope: ReadingDraftScope): StoredReadingDraft {
  let value: StoredReadingDraft;
  try { value = JSON.parse(raw) as StoredReadingDraft; } catch (reason) { throw new Error("invalid_local_reading_draft", { cause: reason }); }
  const draft = value?.draft;
  if (value?.version !== 1 || value.tenantId !== scope.tenantId || value.userId !== scope.userId || !field(value.savedAt, 40) || !Number.isFinite(Date.parse(value.savedAt))
    || !draft || !uuid(draft.id) || !Number.isSafeInteger(draft.revision) || draft.revision < 0 || value.baseRevision !== draft.revision
    || !field(draft.classId, 120) || !field(draft.title, 100) || !field(draft.level, 20) || !field(draft.text, readingDraftTextLimit) || !field(draft.focus, 400)
    || !Array.isArray(draft.terms) || draft.terms.length > 300 || new Set(draft.terms.map((term) => term?.id)).size !== draft.terms.length
    || draft.terms.some((term) => !term || !uuid(term.id) || !field(term.word, 30) || !field(term.pinyin, 120) || !field(term.meaning, 500))) throw new Error("invalid_local_reading_draft");
  return value;
}
export function readLocalReadingDrafts(storage: DraftReader, scope: ReadingDraftScope) {
  const drafts: StoredReadingDraft[] = []; const unreadable: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index); if (!key?.startsWith(readingDraftPrefix(scope))) continue;
    const raw = storage.getItem(key); if (raw === null) continue;
    try {
      const stored = decode(raw, scope); if (key !== draftKey(scope, stored.draft.id)) throw new Error("invalid_local_reading_draft");
      drafts.push(stored);
    } catch (reason) {
      // 保留损坏或旧格式的原始内容，由界面明确提示，避免自动删除用户草稿。
      if (!(reason instanceof Error) || reason.message !== "invalid_local_reading_draft") throw reason;
      unreadable.push(key);
    }
  }
  return { drafts: drafts.sort((left, right) => right.savedAt.localeCompare(left.savedAt) || left.draft.id.localeCompare(right.draft.id)), unreadable };
}
export function saveLocalReadingDraft(storage: Pick<DraftWriter, "setItem">, scope: ReadingDraftScope, draft: ReadingDraft, savedAt = new Date().toISOString()) {
  const stored: StoredReadingDraft = { version: 1, ...scope, baseRevision: draft.revision, savedAt, draft };
  const raw = JSON.stringify(stored); decode(raw, scope);
  storage.setItem(draftKey(scope, draft.id), raw);
  return stored;
}
export function readingDraftMatchesLesson(draft: ReadingDraft, lesson: ReadingLesson | undefined) {
  if (!lesson || lesson.id !== draft.id || lesson.source?.classId !== draft.classId || lesson.title !== draft.title.trim() || lesson.level !== draft.level.trim()) return false;
  const content = { sentences: draft.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    terms: draft.terms.map((term) => ({ word: term.word.trim(), pinyin: term.pinyin.trim(), meaning: term.meaning.trim() })),
    focusWords: draft.focus.split(/[,，、\n]+/).map((word) => word.trim()).filter(Boolean) };
  return JSON.stringify(content) === JSON.stringify({ sentences: lesson.sentences, terms: lesson.terms, focusWords: lesson.focusWords });
}
export function removeConfirmedReadingDraft(storage: Pick<DraftWriter, "getItem" | "removeItem">, scope: ReadingDraftScope, expected: ReadingDraft) {
  const key = draftKey(scope, expected.id); const raw = storage.getItem(key); if (raw === null) return false;
  const current = decode(raw, scope);
  // 服务器确认旧提交时，不清除另一页面后来写入的本机版本。
  if (JSON.stringify(current.draft) !== JSON.stringify(expected)) return false;
  storage.removeItem(key); return true;
}
