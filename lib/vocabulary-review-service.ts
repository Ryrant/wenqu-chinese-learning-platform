import { auditStatement } from "./audit";
import { practiceId, practiceStudent } from "./journey-service";
import { readingLessons, type SavedReadingWord } from "./reading-lessons";
import type { PlatformContext } from "./platform-store";
import type { VocabularyReviewCatalog, VocabularyReviewFeedback, VocabularyReviewSession } from "./vocabulary-review-types";

type Word = SavedReadingWord & { stage: number | null; dueAt: string | null };
type Item = { vocabularyId: string; word: string; meaning: string; example: string; kind: "meaning" | "cloze"; prompt: string; options: string[]; answerIndex: number; stage: number };
type Attempt = { requestId: string; itemIndex: number; selectedOption: number; revision: number; correct: boolean; at: string; nextDueAt: string | null };
type ReviewState = { queue: number[]; position: number; attempts: Attempt[] };
type SessionRow = { id: string; mode: "due" | "free"; snapshot_json: string; state_json: string; revision: number; created_at: string; completed_at: string | null };
const selectWords = `SELECT v.id,v.lesson_id AS lessonId,v.lesson_title AS lessonTitle,v.word,v.pinyin,v.meaning,v.example,v.created_at AS createdAt,s.stage,s.due_at AS dueAt FROM student_vocabulary v LEFT JOIN vocabulary_review_state s ON s.vocabulary_id=v.id AND s.tenant_id=v.tenant_id AND s.user_id=v.user_id WHERE v.tenant_id=? AND v.user_id=? ORDER BY COALESCE(s.due_at,''),v.created_at,v.rowid`;
function shuffled<T>(values: T[]): T[] { const result = [...values]; for (let index = result.length - 1; index > 0; index--) { const other = Math.floor(Math.random() * (index + 1)); [result[index], result[other]] = [result[other], result[index]]; } return result; }
function decode(row: SessionRow, activeWords: Set<string>): VocabularyReviewSession {
  const items = JSON.parse(row.snapshot_json) as Item[]; const state = JSON.parse(row.state_json) as ReviewState;
  const item = items[state.queue[state.position]]; const last = state.attempts.at(-1);
  let feedback: VocabularyReviewFeedback | null = null;
  if (last) {
    const source = items[last.itemIndex];
    feedback = { requestId: last.requestId, word: source.word, selected: source.options[last.selectedOption], answer: source.options[source.answerIndex], meaning: source.meaning, example: source.example, correct: last.correct,
      repeated: state.attempts.some((attempt) => attempt.itemIndex === last.itemIndex && attempt.requestId !== last.requestId), nextDueAt: activeWords.has(source.vocabularyId) ? last.nextDueAt : null };
  }
  const first = items.map((_, index) => state.attempts.find((attempt) => attempt.itemIndex === index));
  return { id: row.id, mode: row.mode, revision: row.revision, total: items.length, remaining: state.queue.length - state.position, attemptCount: state.attempts.length, firstCorrect: first.filter((attempt) => attempt?.correct).length,
    complete: !!row.completed_at, question: row.completed_at || !item ? null : { vocabularyId: item.vocabularyId, kind: item.kind, prompt: item.prompt, options: item.options }, feedback, createdAt: row.created_at };
}
async function ownSession(context: PlatformContext, id: string) {
  const row = await context.db.prepare("SELECT * FROM vocabulary_review_sessions WHERE id=? AND tenant_id=? AND user_id=?").bind(id, context.tenantId, context.userId).first<SessionRow>();
  if (!row) throw new Error("vocabulary_review_session_not_found"); return row;
}
export async function readVocabularyReview(context: PlatformContext, focusId = ""): Promise<VocabularyReviewCatalog> {
  practiceStudent(context);
  const words = (await context.db.prepare(selectWords).bind(context.tenantId, context.userId).all<Word>()).results;
  const now = new Date().toISOString(); const activeWords = new Set(words.map((word) => word.id));
  const sessions = await context.db.prepare("SELECT * FROM vocabulary_review_sessions WHERE tenant_id=? AND user_id=? ORDER BY CASE WHEN completed_at IS NULL THEN 0 WHEN id=? THEN 1 ELSE 2 END,created_at DESC,rowid DESC LIMIT 10").bind(context.tenantId, context.userId, focusId).all<SessionRow>();
  const recent = sessions.results.map((row) => decode(row, activeWords));
  return { totalWords: words.length, dueCount: words.filter((word) => !word.dueAt || word.dueAt <= now).length, nextDueAt: words.map((word) => word.dueAt).filter((value): value is string => !!value && value > now).sort()[0] ?? null, active: recent.find((session) => !session.complete) ?? null, recent };
}

export async function startVocabularyReview(context: PlatformContext, body: Record<string, unknown>) {
  practiceStudent(context); const id = practiceId(body.id);
  if (body.mode !== "due" && body.mode !== "free") throw new Error("invalid_vocabulary_review_mode");
  const existing = await context.db.prepare("SELECT mode FROM vocabulary_review_sessions WHERE id=? AND tenant_id=? AND user_id=?").bind(id, context.tenantId, context.userId).first<{ mode: string }>();
  if (existing) { if (existing.mode !== body.mode) throw new Error("vocabulary_review_conflict"); return readVocabularyReview(context, id); }
  const active = await context.db.prepare("SELECT id,mode FROM vocabulary_review_sessions WHERE tenant_id=? AND user_id=? AND completed_at IS NULL").bind(context.tenantId, context.userId).first<{ id: string; mode: string }>();
  if (active) {
    if (active.id === id && active.mode !== body.mode) throw new Error("vocabulary_review_conflict");
    return readVocabularyReview(context, active.id);
  }
  const words = (await context.db.prepare(selectWords).bind(context.tenantId, context.userId).all<Word>()).results;
  const now = new Date().toISOString(); const selected = (body.mode === "due" ? words.filter((word) => !word.dueAt || word.dueAt <= now) : shuffled(words)).slice(0, 5);
  if (!selected.length) throw new Error("vocabulary_review_empty");
  const pool = [...words, ...readingLessons.flatMap((lesson) => lesson.terms)];
  const items: Item[] = selected.map((word, index) => {
    const kind = index % 2 === 0 ? "meaning" : "cloze"; const answer = kind === "meaning" ? word.meaning : word.word;
    const distractors = [...new Set(pool.map((term) => kind === "meaning" ? term.meaning : term.word))].filter((value) => value !== answer);
    const options = shuffled([answer, ...shuffled(distractors).slice(0, 3)]);
    return { vocabularyId: word.id, word: word.word, meaning: word.meaning, example: word.example, stage: word.stage ?? 0, kind, prompt: kind === "meaning" ? `“${word.word}”是什么意思？` : `${word.example.replaceAll(word.word, "____")}\n选择生词本中的原词，意思是：${word.meaning}`, options, answerIndex: options.indexOf(answer) };
  });
  const state: ReviewState = { queue: items.map((_, index) => index), position: 0, attempts: [] };
  await context.db.batch([
    context.db.prepare("INSERT OR IGNORE INTO vocabulary_review_sessions (id,tenant_id,user_id,mode,snapshot_json,state_json) VALUES (?,?,?,?,?,?)").bind(id, context.tenantId, context.userId, body.mode, JSON.stringify(items), JSON.stringify(state)),
    auditStatement(context.db, context.tenantId, context.userId, "vocabulary_review.started", "vocabulary-review", id, { mode: body.mode, count: items.length }, true),
  ]);
  const started = await context.db.prepare("SELECT id,mode FROM vocabulary_review_sessions WHERE tenant_id=? AND user_id=? AND (id=? OR completed_at IS NULL) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1").bind(context.tenantId, context.userId, id, id).first<{ id: string; mode: string }>();
  if (!started || (started.id === id && started.mode !== body.mode)) throw new Error("vocabulary_review_conflict");
  return readVocabularyReview(context, started.id);
}

export async function answerVocabularyReview(context: PlatformContext, body: Record<string, unknown>) {
  practiceStudent(context); const sessionId = practiceId(body.sessionId); const requestId = practiceId(body.requestId);
  if (!Number.isInteger(body.revision) || Number(body.revision) < 0) throw new Error("invalid_vocabulary_review_revision");
  const row = await ownSession(context, sessionId); const state = JSON.parse(row.state_json) as ReviewState;
  const previous = state.attempts.find((item) => item.requestId === requestId);
  if (previous) {
    if (body.action !== "answer" || previous.selectedOption !== body.selectedOption || previous.revision !== body.revision) throw new Error("vocabulary_review_conflict");
    return readVocabularyReview(context, sessionId);
  }
  if (row.completed_at && body.action === "finish") return readVocabularyReview(context, sessionId);
  if (row.revision !== body.revision) throw new Error("vocabulary_review_changed");
  if (row.completed_at) throw new Error("invalid_vocabulary_review_complete");
  if (body.action === "finish") {
    const [finished] = await context.db.batch([
      context.db.prepare("UPDATE vocabulary_review_sessions SET completed_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=? AND tenant_id=? AND user_id=? AND revision=? AND completed_at IS NULL").bind(sessionId, context.tenantId, context.userId, row.revision),
      auditStatement(context.db, context.tenantId, context.userId, "vocabulary_review.finished", "vocabulary-review", sessionId, {}, true),
    ]);
    if (!finished.meta.changes) throw new Error("vocabulary_review_changed");
    return readVocabularyReview(context, sessionId);
  }
  const items = JSON.parse(row.snapshot_json) as Item[]; const index = state.queue[state.position]; const item = items[index];
  if (!item || !Number.isInteger(body.selectedOption) || Number(body.selectedOption) < 0 || Number(body.selectedOption) >= item.options.length) throw new Error("invalid_vocabulary_review_answer");
  const correct = body.selectedOption === item.answerIndex; const now = new Date().toISOString();
  const first = !state.attempts.some((attempt) => attempt.itemIndex === index);
  const activeWord = await context.db.prepare("SELECT id FROM student_vocabulary WHERE id=? AND tenant_id=? AND user_id=?").bind(item.vocabularyId, context.tenantId, context.userId).first();
  const stage = correct ? Math.min(item.stage + 1, 4) : 0;
  const days = correct ? [1, 3, 7, 14][stage - 1] : 1;
  const nextDueAt = row.mode === "due" && first && activeWord ? new Date(Date.now() + days * 86400000).toISOString() : null;
  const next: ReviewState = { ...state, queue: [...state.queue], position: state.position + 1, attempts: [...state.attempts, { requestId, itemIndex: index, selectedOption: Number(body.selectedOption), revision: row.revision, correct, at: now, nextDueAt }] };
  // 本轮错词最多回练两次；首次回答决定下次间隔，纠正重答不会虚增阶段。
  if (!correct && activeWord && state.attempts.filter((attempt) => attempt.itemIndex === index).length < 2) next.queue.push(index);
  const done = next.position >= next.queue.length;
  const statements = [context.db.prepare("UPDATE vocabulary_review_sessions SET state_json=?,revision=revision+1,completed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=? AND tenant_id=? AND user_id=? AND revision=? AND completed_at IS NULL").bind(JSON.stringify(next), done ? 1 : 0, sessionId, context.tenantId, context.userId, row.revision),
    auditStatement(context.db, context.tenantId, context.userId, "vocabulary_review.answered", "vocabulary-review", sessionId, { requestId, vocabularyId: item.vocabularyId, correct, mode: row.mode }, true)];
  if (nextDueAt) statements.push(context.db.prepare(`INSERT INTO vocabulary_review_state (id,tenant_id,user_id,vocabulary_id,stage,due_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0 AND EXISTS (SELECT 1 FROM student_vocabulary WHERE id=? AND tenant_id=? AND user_id=?)
    ON CONFLICT(tenant_id,user_id,vocabulary_id) DO UPDATE SET stage=excluded.stage,due_at=excluded.due_at,updated_at=excluded.updated_at`).bind(crypto.randomUUID(), context.tenantId, context.userId, item.vocabularyId, stage, nextDueAt, now, item.vocabularyId, context.tenantId, context.userId));
  const [saved] = await context.db.batch(statements);
  if (!saved.meta.changes) {
    const latest = JSON.parse((await ownSession(context, sessionId)).state_json) as ReviewState;
    if (!latest.attempts.some((attempt) => attempt.requestId === requestId && attempt.selectedOption === body.selectedOption && attempt.revision === body.revision)) throw new Error("vocabulary_review_changed");
  }
  return readVocabularyReview(context, sessionId);
}
