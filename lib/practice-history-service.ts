import { practiceId, practiceStudent } from "./journey-service";
import { learningAnalyticsConsentSql, readLearningAnalyticsState } from "./learning-analytics";
import type { PlatformContext } from "./platform-store";
import type { PracticeDetail, PracticeKind, PracticeMetric, PracticeTimelineEntry, ReadingResult, WritingResult } from "./practice-types";
import type { ReadingLesson } from "./reading-lessons";
import type { DictationAnswer } from "./dictation-types";
import type { DialogueTurn } from "./dialogue-types";

export const practiceKinds: PracticeKind[] = ["writing", "reading", "vocabulary", "dictation", "journey"];
export type ActivityRow = { id: string; kind: PracticeKind; title: string; createdAt: string; status: PracticeTimelineEntry["status"]; sourceJson: string; resultJson: string; stateJson: string; classId: string | null; userId: string; sequence: number };
type Markers = { p: number; v: number; d: number; j: number };
type Position = { at: string; kind: PracticeKind; id: string };
type Cursor = { period: 7 | 30; asOf: string; markers: Markers; after: Position | null };

// 时间线按保存/开始时间排序，进度仍展示读取时最新保存结果。行号边界防止同秒新记录挤入后续页。
export const practiceActivitySql = `WITH activities AS (
 SELECT p.id,p.kind,p.title,strftime('%Y-%m-%dT%H:%M:%fZ',p.created_at) AS createdAt,'finished' AS status,p.snapshot_json AS sourceJson,p.result_json AS resultJson,'{}' AS stateJson,
 COALESCE((SELECT j.class_id FROM journey_runs j WHERE j.id=p.journey_run_id AND j.tenant_id=p.tenant_id AND j.user_id=p.user_id),CASE WHEN p.kind='reading' THEN json_extract(p.snapshot_json,'$.source.classId') END) AS classId,p.user_id AS userId,p.rowid AS sequence
 FROM practice_records p WHERE p.tenant_id=? AND p.user_id=?
 UNION ALL
 SELECT v.id,'vocabulary','生词复习',strftime('%Y-%m-%dT%H:%M:%fZ',v.created_at),CASE WHEN v.completed_at IS NULL THEN 'active' WHEN json_extract(v.state_json,'$.position')>=json_array_length(v.state_json,'$.queue') THEN 'finished' ELSE 'ended' END,v.snapshot_json,'{}',v.state_json,NULL,v.user_id,v.rowid FROM vocabulary_review_sessions v WHERE v.tenant_id=? AND v.user_id=?
 UNION ALL
 SELECT d.id,'dictation',json_extract(d.source_json,'$.title'),strftime('%Y-%m-%dT%H:%M:%fZ',d.created_at),CASE WHEN d.completed_at IS NULL THEN 'active' WHEN json_extract(d.state_json,'$.index')>=json_array_length(d.snapshot_json) THEN 'finished' ELSE 'ended' END,d.snapshot_json,d.source_json,d.state_json,json_extract(d.source_json,'$.classId'),d.user_id,d.rowid FROM dictation_sessions d WHERE d.tenant_id=? AND d.user_id=?
 UNION ALL
 SELECT j.id,'journey',json_extract(j.snapshot_json,'$.title'),strftime('%Y-%m-%dT%H:%M:%fZ',j.created_at),CASE WHEN j.stage=3 THEN 'finished' ELSE 'active' END,j.snapshot_json,json_object('stage',j.stage,'steps',s.step,'hints',s.hint_count,'turns',json(s.turns_json)),'{}',j.class_id,j.user_id,j.rowid
 FROM journey_runs j JOIN dialogue_sessions s ON s.id=j.dialogue_session_id AND s.tenant_id=j.tenant_id AND s.user_id=j.user_id WHERE j.tenant_id=? AND j.user_id=?
)`;

export function activityArgs(tenantId: string, userId: string) { return [tenantId, userId, tenantId, userId, tenantId, userId, tenantId, userId]; }
export function activityEntry(row: ActivityRow): PracticeTimelineEntry {
  let href = ""; let summary = "";
  if (row.kind === "writing") {
    const source = JSON.parse(row.sourceJson) as { character: string };
    const result = JSON.parse(row.resultJson) as WritingResult;
    href = "/student/writing?character=" + encodeURIComponent(source.character);
    summary = (result.mode === "trace" ? "描红" : "独立书写") + " · 重试 " + result.mistakes + " 次 · 主动提示 " + result.hints + " 次";
  } else if (row.kind === "reading") {
    const lesson = JSON.parse(row.sourceJson) as ReadingLesson; const result = JSON.parse(row.resultJson) as ReadingResult;
    href = "/student/reading?lessonId=" + encodeURIComponent(lesson.id); summary = "自测答对 " + result.correct + "/" + result.total + " 题";
  } else if (row.kind === "vocabulary") {
    const state = JSON.parse(row.stateJson) as { attempts: unknown[] };
    href = "/student/vocabulary?sessionId=" + encodeURIComponent(row.id); summary = "已保存 " + state.attempts.length + " 次作答";
  } else if (row.kind === "dictation") {
    const state = JSON.parse(row.stateJson) as { answers: DictationAnswer[] };
    href = "/student/dictation?sessionId=" + encodeURIComponent(row.id); summary = "已保存 " + state.answers.length + " 项 · 与参考一致 " + state.answers.filter((item) => item.correct).length + " 项";
  } else {
    const result = JSON.parse(row.resultJson) as { stage: number; hints: number };
    href = "/student/journeys?run=" + encodeURIComponent(row.id); summary = "已完成 " + result.stage + "/3 关 · 对话主动提示 " + result.hints + " 次";
  }
  return { id: row.id, kind: row.kind, title: row.title, createdAt: row.createdAt, status: row.status, href, summary };
}

export function activityDetail(row: ActivityRow): PracticeDetail {
  const detail: PracticeDetail = { entry: activityEntry(row), answers: [], texts: [] };
  if (row.kind === "writing") { detail.writing = JSON.parse(row.resultJson) as WritingResult; const source = JSON.parse(row.sourceJson) as { pinyin: string; word: string; example: string }; detail.texts = [source.pinyin, source.word, source.example]; }
  else if (row.kind === "reading") {
    const lesson = JSON.parse(row.sourceJson) as ReadingLesson; detail.texts = lesson.sentences;
    detail.answers = (JSON.parse(row.resultJson) as ReadingResult).answers.map((item) => ({ prompt: "“" + item.word + "”的词义", actual: item.selected, expected: item.meaning, correct: item.correct }));
  } else if (row.kind === "vocabulary") {
    const items = JSON.parse(row.sourceJson) as Array<{ prompt: string; options: string[]; answerIndex: number; example: string }>;
    const state = JSON.parse(row.stateJson) as { attempts: Array<{ itemIndex: number; selectedOption: number; correct: boolean; at: string }> };
    detail.answers = state.attempts.map((attempt) => { const item = items[attempt.itemIndex]; return { prompt: item.prompt, actual: item.options[attempt.selectedOption], expected: item.options[item.answerIndex], correct: attempt.correct, at: attempt.at }; });
  } else if (row.kind === "dictation") {
    const state = JSON.parse(row.stateJson) as { answers: DictationAnswer[]; hints: Record<string, boolean> };
    const items = JSON.parse(row.sourceJson) as Array<{ expected: string; pinyin: string; sourceTitle: string }>;
    detail.texts = items.flatMap((item, index) => state.hints[String(index)] ? ["第 " + (index + 1) + " 项已查看参考：" + item.expected + (item.pinyin ? " · " + item.pinyin : "") + " · 来自《" + item.sourceTitle + "》"] : []);
    detail.hints = Object.values(state.hints).filter(Boolean).length;
    detail.answers = state.answers.map((item) => ({ prompt: "第 " + (item.index + 1) + " 项听写", actual: item.actual, expected: item.expected, correct: item.correct, at: item.at, usedReference: item.usedReference, playCount: item.playCount }));
  } else {
    const source = JSON.parse(row.sourceJson) as { lesson: ReadingLesson; characters: string[] };
    const result = JSON.parse(row.resultJson) as { hints: number; turns: DialogueTurn[] };
    detail.texts = ["练习字：" + source.characters.join("、"), ...source.lesson.sentences]; detail.turns = result.turns; detail.hints = result.hints;
  }
  return detail;
}

function encodeCursor(cursor: Cursor) { return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function decodeCursor(value: string, period: 7 | 30): Cursor {
  try {
    if (value.length > 2048) throw new Error();
    const data = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/"))) as Cursor;
    if (data.period !== period || new Date(data.asOf).toISOString() !== data.asOf || Date.parse(data.asOf) > Date.now() + 1000 || !data.markers || ["p", "v", "d", "j"].some((key) => !Number.isSafeInteger(data.markers[key as keyof Markers]) || data.markers[key as keyof Markers] < 0)) throw new Error();
    if (data.after && (!practiceKinds.includes(data.after.kind) || new Date(data.after.at).toISOString() !== data.after.at || practiceId(data.after.id) !== data.after.id)) throw new Error();
    return data;
  } catch { throw new Error("invalid_practice_cursor"); }
}

export async function readPracticeArchive(context: PlatformContext, query: URLSearchParams) {
  practiceStudent(context);
  const value = query.get("period") ?? "30"; if (value !== "7" && value !== "30") throw new Error("invalid_practice_period");
  const period = Number(value) as 7 | 30; const { db, tenantId, userId } = context;
  let cursor: Cursor;
  if (query.get("cursor")) cursor = decodeCursor(query.get("cursor")!, period);
  else {
    const markers = await db.prepare("SELECT COALESCE((SELECT MAX(rowid) FROM practice_records WHERE tenant_id=? AND user_id=?),0) AS p,COALESCE((SELECT MAX(rowid) FROM vocabulary_review_sessions WHERE tenant_id=? AND user_id=?),0) AS v,COALESCE((SELECT MAX(rowid) FROM dictation_sessions WHERE tenant_id=? AND user_id=?),0) AS d,COALESCE((SELECT MAX(rowid) FROM journey_runs WHERE tenant_id=? AND user_id=?),0) AS j").bind(...activityArgs(tenantId, userId)).first<Markers>();
    cursor = { period, asOf: new Date().toISOString(), markers: markers!, after: null };
  }
  const day = new Date(Date.parse(cursor.asOf) + 8 * 3600000); day.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(day.getTime() - 8 * 3600000 - (period - 1) * 86400000).toISOString();
  const filter = "createdAt>=? AND createdAt<=? AND sequence<=CASE kind WHEN 'writing' THEN ? WHEN 'reading' THEN ? WHEN 'vocabulary' THEN ? WHEN 'dictation' THEN ? ELSE ? END";
  const args = [...activityArgs(tenantId, userId), rangeStart, cursor.asOf, cursor.markers.p, cursor.markers.p, cursor.markers.v, cursor.markers.d, cursor.markers.j];
  const analytics = await readLearningAnalyticsState(db, tenantId, userId);
  const firstAttempts = "a.key=(SELECT MIN(b.key) FROM json_each(stateJson,'$.attempts') b WHERE json_extract(b.value,'$.itemIndex')=json_extract(a.value,'$.itemIndex'))";
  const metricSql = `SELECT kind,COUNT(*) AS rounds,SUM(status='finished') AS completed,
    SUM(CASE kind WHEN 'reading' THEN json_extract(resultJson,'$.correct') WHEN 'dictation' THEN (SELECT COUNT(*) FROM json_each(stateJson,'$.answers') a WHERE json_extract(a.value,'$.correct')=1) WHEN 'vocabulary' THEN (SELECT COUNT(*) FROM json_each(stateJson,'$.attempts') a WHERE json_extract(a.value,'$.correct')=1 AND ${firstAttempts}) END) AS correct,
    SUM(CASE kind WHEN 'reading' THEN json_extract(resultJson,'$.total') WHEN 'dictation' THEN json_array_length(stateJson,'$.answers') WHEN 'vocabulary' THEN (SELECT COUNT(*) FROM json_each(stateJson,'$.attempts') a WHERE ${firstAttempts}) END) AS total,
    SUM(CASE kind WHEN 'writing' THEN json_extract(resultJson,'$.hints') WHEN 'journey' THEN json_extract(resultJson,'$.hints') END) AS hints,
    SUM(CASE WHEN kind='dictation' THEN (SELECT COUNT(*) FROM json_each(stateJson,'$.answers') a WHERE json_extract(a.value,'$.usedReference')=1) END) AS referenceViewed
    FROM activities WHERE ${filter} AND ${learningAnalyticsConsentSql("?", "?")} GROUP BY kind`;
  const after = cursor.after;
  const position = after ? " AND (createdAt<? OR (createdAt=? AND (kind<? OR (kind=? AND id<?))))" : "";
  const statements = [
    db.prepare(practiceActivitySql + " SELECT * FROM activities WHERE " + filter + position + " ORDER BY createdAt DESC,kind DESC,id DESC LIMIT 21").bind(...args, ...(after ? [after.at, after.at, after.kind, after.kind, after.id] : [])),
    ...(analytics.available ? [db.prepare(practiceActivitySql + " " + metricSql).bind(...args, tenantId, userId)] : []),
  ];
  const results = await (db.readBatch ? db.readBatch(statements) : db.batch(statements));
  const rows = results[0].results as ActivityRow[];
  const latest = analytics.available ? await readLearningAnalyticsState(db, tenantId, userId) : analytics;
  const metrics = analytics.available && latest.available ? practiceKinds.map((kind) => (results[1].results as PracticeMetric[]).find((item) => item.kind === kind) ?? { kind, rounds: 0, completed: 0, correct: kind === "reading" || kind === "dictation" || kind === "vocabulary" ? 0 : null, total: kind === "reading" || kind === "dictation" || kind === "vocabulary" ? 0 : null, hints: kind === "writing" || kind === "journey" ? 0 : null, referenceViewed: kind === "dictation" ? 0 : null }) : null;
  const page = rows.slice(0, 20); const last = page.at(-1);
  return { ...latest, period, rangeStart, asOf: cursor.asOf, metrics, records: page.map(activityEntry), currentCursor: encodeCursor(cursor), nextCursor: rows.length > 20 && last ? encodeCursor({ ...cursor, after: { at: last.createdAt, kind: last.kind, id: last.id } }) : null };
}

export async function readPracticeDetail(context: PlatformContext, kind: string, id: string): Promise<PracticeDetail> {
  practiceStudent(context); practiceId(id); if (!practiceKinds.includes(kind as PracticeKind)) throw new Error("invalid_practice_kind");
  const row = await context.db.prepare(practiceActivitySql + " SELECT * FROM activities WHERE kind=? AND id=?").bind(...activityArgs(context.tenantId, context.userId), kind, id).first<ActivityRow>();
  if (!row) throw new Error("practice_record_not_found"); return activityDetail(row);
}
