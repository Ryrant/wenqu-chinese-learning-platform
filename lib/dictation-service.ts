import { auditStatement } from "./audit";
import { practiceId, practiceStudent } from "./journey-service";
import { readReadingCatalog, resolveReadingLesson } from "./reading-content-service";
import { readReadingVocabulary } from "./reading-vocabulary-service";
import { compareDictation, normalizeDictation, type DictationAnswer, type DictationCatalog, type DictationSession } from "./dictation-types";
import type { PlatformContext } from "./platform-store";
import type { ReadingLesson } from "./reading-lessons";

type Source = { kind: "vocabulary" | "words" | "sentences"; title: string; lessonId?: string; classId?: string; revision?: number; retryOf?: string };
type Item = { expected: string; sourceTitle: string; pinyin: string };
type Receipt = { requestId: string; kind: string; revision: number; answer?: string; playCount?: number };
type State = { index: number; hints: Record<number, boolean>; answers: DictationAnswer[]; receipts: Receipt[] };
type Row = { id: string; source_json: string; snapshot_json: string; payload_json: string; state_json: string; revision: number; created_at: string; completed_at: string | null };
function integer(value: unknown, maximum: number) { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new Error("invalid_dictation_value"); return Number(value); }
function shuffle<T>(items: T[]) { const values = [...items]; for (let index = values.length - 1; index > 0; index--) { const other = Math.floor(Math.random() * (index + 1)); [values[index], values[other]] = [values[other], values[index]]; } return values; }
function sourceGuard(context: PlatformContext, source: Source, exactRevision = false) {
  let sql = "EXISTS (SELECT 1 FROM users u JOIN role_memberships rm ON rm.user_id=u.id JOIN tenants t ON t.id=rm.tenant_id WHERE u.id=? AND u.status='active' AND u.must_change_password=0 AND rm.tenant_id=? AND rm.role='student' AND rm.status='active' AND t.status='active')";
  const args: Array<string | number> = [context.userId, context.tenantId];
  if (source.classId) {
    sql += " AND EXISTS (SELECT 1 FROM teacher_reading_lessons r JOIN enrollments e ON e.tenant_id=r.tenant_id AND e.class_id=r.class_id WHERE r.id=? AND r.tenant_id=? AND r.class_id=? AND r.status='published' AND e.student_user_id=? AND e.status='active'" + (exactRevision ? " AND r.revision=?" : "") + ")";
    args.push(source.lessonId!, context.tenantId, source.classId, context.userId, ...(exactRevision ? [source.revision!] : []));
  }
  return { sql, args };
}
async function ownSession(context: PlatformContext, id: string) { const row = await context.db.prepare("SELECT * FROM dictation_sessions WHERE id=? AND tenant_id=? AND user_id=?").bind(id, context.tenantId, context.userId).first<Row>(); if (!row) throw new Error("dictation_session_not_found"); return row; }
function available(source: Source, lessons: ReadingLesson[]) { return source.kind === "vocabulary" || lessons.some((lesson) => lesson.id === source.lessonId && (lesson.source?.classId ?? "") === (source.classId ?? "")); }
type RetryMetadata = { id: string; sourceJson: string; targetsJson: string; answersJson: string };
async function retries(context: PlatformContext) {
  // 只读取目标和对错，不复制历史原始作答；跨轮次按显式 retryOf 追踪纠正情况。
  const rows = (await context.db.prepare("SELECT id,source_json AS sourceJson,(SELECT json_group_array(json_extract(value,'$.expected')) FROM json_each(snapshot_json)) AS targetsJson,(SELECT json_group_array(json_object('expected',json_extract(value,'$.expected'),'correct',json_extract(value,'$.correct'))) FROM json_each(json_extract(state_json,'$.answers'))) AS answersJson FROM dictation_sessions WHERE tenant_id=? AND user_id=? AND completed_at IS NOT NULL ORDER BY created_at,rowid").bind(context.tenantId, context.userId).all<RetryMetadata>()).results;
  const roots = new Map<string, string>(); const unresolved = new Map<string, Set<string>>();
  for (const row of rows) {
    const source = JSON.parse(row.sourceJson) as Source;
    const root = source.retryOf ? roots.get(source.retryOf) ?? row.id : row.id;
    roots.set(row.id, root);
    const pending = unresolved.get(root) ?? new Set<string>();
    for (const answer of JSON.parse(row.answersJson) as Array<{ expected: string; correct: boolean | number }>) {
      const key = normalizeDictation(answer.expected);
      if (answer.correct) pending.delete(key); else pending.add(key);
    }
    unresolved.set(root, pending);
  }
  const pending = new Map<string, Set<string>>();
  for (const row of rows) {
    const group = unresolved.get(roots.get(row.id)!)!;
    pending.set(row.id, new Set((JSON.parse(row.targetsJson) as string[]).map(normalizeDictation).filter((key) => group.has(key))));
  }
  return { rows, pending };
}
function session(row: Row, lessons: ReadingLesson[], retryCount: number): DictationSession {
  const source = JSON.parse(row.source_json) as Source; const items = JSON.parse(row.snapshot_json) as Item[]; const state = JSON.parse(row.state_json) as State;
  const item = items[state.index]; const canContinue = available(source, lessons);
  return { id: row.id, kind: source.kind, sourceTitle: `${source.retryOf ? "错项重练 · " : ""}${source.title}`, revision: row.revision, total: items.length, retryCount, index: state.index, complete: !!row.completed_at, available: canContinue,
    question: item && !row.completed_at && canContinue ? { id: `${row.id}:${state.index}`, speechText: item.expected, sourceTitle: item.sourceTitle, pinyin: state.hints[state.index] ? item.pinyin : "", referenceVisible: !!state.hints[state.index] } : null, answers: state.answers, createdAt: row.created_at };
}
export async function readDictation(context: PlatformContext, focusId = ""): Promise<DictationCatalog> {
  practiceStudent(context);
  const catalog = await readReadingCatalog(context);
  const retryState = await retries(context);
  const retrySessionId = retryState.rows.toReversed().find((row) => retryState.pending.get(row.id)?.size && available(JSON.parse(row.sourceJson) as Source, catalog.lessons))?.id ?? null;
  const count = await context.db.prepare("SELECT COUNT(*) AS count FROM student_vocabulary WHERE tenant_id=? AND user_id=?").bind(context.tenantId, context.userId).first<{ count: number }>();
  const rows = await context.db.prepare("SELECT * FROM dictation_sessions WHERE tenant_id=? AND user_id=? ORDER BY CASE WHEN completed_at IS NULL THEN 0 WHEN id=? THEN 1 WHEN id=? THEN 2 ELSE 3 END,created_at DESC,rowid DESC LIMIT 10").bind(context.tenantId, context.userId, focusId, retrySessionId).all<Row>();
  const recent = rows.results.map((row) => session(row, catalog.lessons, retryState.pending.get(row.id)?.size ?? 0));
  return { lessons: catalog.lessons.map(({ id, title, level, source }) => ({ id, title, level, ...(source ? { source } : {}) })), wordCount: count?.count ?? 0, retrySessionId, active: recent.find((item) => !item.complete) ?? null, recent };
}

export async function startDictation(context: PlatformContext, body: Record<string, unknown>) {
  practiceStudent(context); const id = practiceId(body.id);
  const retry = body.action === "retry";
  if (!retry && !["vocabulary", "words", "sentences"].includes(String(body.kind))) throw new Error("invalid_dictation_kind");
  const parentId = retry ? practiceId(body.sessionId) : "";
  if (!retry && body.kind !== "vocabulary" && (typeof body.lessonId !== "string" || !body.lessonId || body.lessonId.length > 120)) throw new Error("invalid_dictation_source");
  const sourceRevision = !retry && body.kind !== "vocabulary" ? integer(body.sourceRevision ?? 0, 1000000) : 0;
  const payload = JSON.stringify(retry ? { action: "retry", sessionId: parentId } : { action: "start", kind: body.kind, ...(body.kind !== "vocabulary" ? { lessonId: body.lessonId, sourceRevision } : {}) });
  const existing = await context.db.prepare("SELECT payload_json FROM dictation_sessions WHERE id=? AND tenant_id=? AND user_id=?").bind(id, context.tenantId, context.userId).first<{ payload_json: string }>();
  if (existing) { if (existing.payload_json !== payload) throw new Error("dictation_conflict"); return readDictation(context, id); }
  const active = await context.db.prepare("SELECT id,payload_json FROM dictation_sessions WHERE tenant_id=? AND user_id=? AND completed_at IS NULL").bind(context.tenantId, context.userId).first<{ id: string; payload_json: string }>();
  if (active) { if (active.id !== id) throw new Error("dictation_in_progress"); if (active.payload_json !== payload) throw new Error("dictation_conflict"); return readDictation(context, id); }
  let source: Source; let items: Item[];
  if (retry) {
    const parent = await ownSession(context, parentId); if (!parent.completed_at) throw new Error("invalid_dictation_incomplete");
    const original = JSON.parse(parent.snapshot_json) as Item[];
    const pending = (await retries(context)).pending.get(parentId) ?? new Set<string>();
    items = original.filter((item) => pending.has(normalizeDictation(item.expected)));
    if (!items.length) throw new Error("dictation_no_mistakes");
    source = { ...JSON.parse(parent.source_json) as Source, retryOf: parentId };
  } else if (body.kind === "vocabulary") {
    source = { kind: "vocabulary", title: "我的生词本" };
    items = (await readReadingVocabulary(context)).map((word) => ({ expected: word.word, sourceTitle: word.lessonTitle, pinyin: word.pinyin }));
  } else {
    const lesson = await resolveReadingLesson(context, String(body.lessonId));
    if ((lesson.source?.revision ?? 0) !== sourceRevision) throw new Error("reading_lesson_changed");
    source = { kind: body.kind as "words" | "sentences", title: lesson.title, lessonId: lesson.id, ...(lesson.source ? { classId: lesson.source.classId, revision: lesson.source.revision } : {}) };
    items = body.kind === "sentences" ? lesson.sentences.map((expected) => ({ expected, sourceTitle: lesson.title, pinyin: "" })) : lesson.focusWords.map((word) => ({ expected: word, sourceTitle: lesson.title, pinyin: lesson.terms.find((term) => term.word === word)!.pinyin }));
  }
  const byText = new Map<string, Item>();
  for (const item of items) { const key = normalizeDictation(item.expected); if (key && !byText.has(key)) byText.set(key, item); }
  const unique = [...byText.values()];
  items = shuffle(unique).slice(0, 5);
  if (!items.length) throw new Error("dictation_empty");
  const guard = sourceGuard(context, source, !retry);
  const state: State = { index: 0, hints: {}, answers: [], receipts: [] };
  await context.db.batch([
    context.db.prepare(`INSERT OR IGNORE INTO dictation_sessions (id,tenant_id,user_id,source_json,snapshot_json,payload_json,state_json) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(id, context.tenantId, context.userId, JSON.stringify(source), JSON.stringify(items), payload, JSON.stringify(state), ...guard.args),
    auditStatement(context.db, context.tenantId, context.userId, "dictation.started", "dictation-session", id, { kind: source.kind, count: items.length, ...(retry ? { retryOf: parentId } : {}) }, true),
  ]);
  const saved = await context.db.prepare("SELECT id,payload_json FROM dictation_sessions WHERE tenant_id=? AND user_id=? AND (id=? OR completed_at IS NULL) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1").bind(context.tenantId, context.userId, id, id).first<{ id: string; payload_json: string }>();
  if (!saved) throw new Error("dictation_source_unavailable");
  if (saved.id !== id) throw new Error("dictation_in_progress");
  if (saved.id === id && saved.payload_json !== payload) throw new Error("dictation_conflict");
  return readDictation(context, saved.id);
}

export async function changeDictation(context: PlatformContext, body: Record<string, unknown>) {
  practiceStudent(context); const id = practiceId(body.sessionId); const requestId = practiceId(body.requestId); const revision = integer(body.revision, 1000000);
  const row = await ownSession(context, id); const source = JSON.parse(row.source_json) as Source; const state = JSON.parse(row.state_json) as State;
  let input = ""; let playCount = 0;
  if (body.action === "answer") {
    if (typeof body.answer !== "string" || !body.answer.trim() || body.answer.length > 600) throw new Error("invalid_dictation_answer"); input = body.answer.trim(); playCount = integer(body.playCount, 1000);
  } else if (body.action !== "hint" && body.action !== "finish") throw new Error("invalid_dictation_action");
  const previous = state.receipts.find((receipt) => receipt.requestId === requestId);
  if (previous) {
    if (previous.kind !== body.action || previous.revision !== revision || (body.action === "answer" && (previous.answer !== input || previous.playCount !== playCount))) throw new Error("dictation_conflict");
    return readDictation(context, id);
  }
  if (row.completed_at && body.action === "finish") return readDictation(context, id);
  if (row.revision !== revision) throw new Error("dictation_changed");
  if (row.completed_at) throw new Error("invalid_dictation_complete");
  const items = JSON.parse(row.snapshot_json) as Item[]; const item = items[state.index];
  if (!item) throw new Error("invalid_dictation_question");
  if (body.action === "hint" && state.hints[state.index]) return readDictation(context, id);
  if (body.action === "answer" && !playCount && !state.hints[state.index]) throw new Error("invalid_dictation_not_played");
  const next: State = { ...state, hints: { ...state.hints }, answers: [...state.answers], receipts: [...state.receipts, { requestId, kind: String(body.action), revision, ...(body.action === "answer" ? { answer: input, playCount } : {}) }] };
  if (body.action === "hint") next.hints[state.index] = true;
  if (body.action === "answer") {
    next.answers.push({ requestId, index: state.index, expected: item.expected, actual: input, ...compareDictation(item.expected, input), playCount, usedReference: !!state.hints[state.index], at: new Date().toISOString() });
    next.index++;
  }
  const done = body.action === "finish" || next.index >= items.length;
  const guard = body.action === "finish" ? { sql: "1=1", args: [] } : sourceGuard(context, source);
  const [saved] = await context.db.batch([
    context.db.prepare(`UPDATE dictation_sessions SET state_json=?,revision=revision+1,completed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=? AND tenant_id=? AND user_id=? AND revision=? AND completed_at IS NULL AND ${guard.sql}`).bind(JSON.stringify(next), done ? 1 : 0, id, context.tenantId, context.userId, revision, ...guard.args),
    auditStatement(context.db, context.tenantId, context.userId, `dictation.${body.action}`, "dictation-session", id, { requestId, index: state.index }, true),
  ]);
  if (!saved.meta.changes) {
    const latest = JSON.parse((await ownSession(context, id)).state_json) as State;
    const replay = latest.receipts.find((receipt) => receipt.requestId === requestId);
    if (!replay || replay.kind !== body.action || replay.revision !== revision || (body.action === "answer" && (replay.answer !== input || replay.playCount !== playCount))) throw new Error("dictation_changed");
  }
  return readDictation(context, id);
}
