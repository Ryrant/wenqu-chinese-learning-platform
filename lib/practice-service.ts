import { auditStatement } from "./audit";
import { practiceCharacters } from "./hanzi-practice";
import { resolveReadingLesson } from "./reading-content-service";
import type { ReadingLesson } from "./reading-lessons";
import { journeySnapshot, journeySourceGuard, ownJourneyRow, practiceId, practiceStudent } from "./journey-service";
import type { PlatformContext } from "./platform-store";
import type { PracticeHistory, PracticeRecord, ReadingResult, WritingResult } from "./practice-types";

type RecordRow = Omit<PracticeRecord, "result"> & { resultJson: string; payloadJson: string };
const selectRecord = "SELECT id,kind,reference_id AS referenceId,journey_run_id AS journeyRunId,title,result_json AS resultJson,payload_json AS payloadJson,created_at AS createdAt FROM practice_records";
function record(row: RecordRow): PracticeRecord { return { id: row.id, kind: row.kind, referenceId: row.referenceId, journeyRunId: row.journeyRunId, title: row.title, createdAt: row.createdAt, result: JSON.parse(row.resultJson) as PracticeRecord["result"] }; }
function count(value: unknown, maximum: number) { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new Error("invalid_practice_result"); return Number(value); }

export async function readPracticeHistory(context: PlatformContext, kind = "", referenceId = "", journeyRunId = ""): Promise<PracticeHistory> {
  practiceStudent(context);
  if (kind && !["reading", "writing"].includes(kind)) throw new Error("invalid_practice_kind");
  if (journeyRunId) await ownJourneyRow(context, practiceId(journeyRunId));
  const rows = await context.db.prepare(`${selectRecord} WHERE tenant_id=? AND user_id=? AND (?='' OR kind=?) AND (?='' OR reference_id=?) AND (?='' OR journey_run_id=?) ORDER BY created_at DESC,rowid DESC LIMIT 30`).bind(context.tenantId, context.userId, kind, kind, referenceId, referenceId, journeyRunId, journeyRunId).all<RecordRow>();
  const written = await context.db.prepare("SELECT DISTINCT reference_id AS character FROM practice_records WHERE tenant_id=? AND user_id=? AND kind='writing' AND (?='' OR journey_run_id=?)").bind(context.tenantId, context.userId, journeyRunId, journeyRunId).all<{ character: string }>();
  return { records: rows.results.map(record), writtenCharacters: written.results.map((item) => item.character) };
}

export async function savePractice(context: PlatformContext, body: Record<string, unknown>) {
  practiceStudent(context); const id = practiceId(body.id);
  if (body.kind !== "reading" && body.kind !== "writing") throw new Error("invalid_practice_kind");
  if (typeof body.referenceId !== "string" || !body.referenceId || body.referenceId.length > 120) throw new Error("invalid_practice_reference");
  const kind = body.kind; const referenceId = body.referenceId; const runId = body.journeyRunId ? practiceId(body.journeyRunId) : null;
  const sourceRevision = kind === "reading" && body.sourceRevision !== undefined ? count(body.sourceRevision, 1000000) : 0;
  let submission: unknown;
  if (kind === "writing") {
    if (body.mode !== "trace" && body.mode !== "recall") throw new Error("invalid_practice_mode");
    submission = { mode: body.mode, mistakes: count(body.mistakes, 10000), hints: count(body.hints, 1000), elapsedMs: count(body.elapsedMs, 3600000) } satisfies WritingResult;
  } else {
    if (!Array.isArray(body.answers) || body.answers.length !== 3) throw new Error("invalid_practice_answers");
    submission = body.answers.map((value: unknown) => {
      if (!value || typeof value !== "object") throw new Error("invalid_practice_answers");
      const item = value as Record<string, unknown>;
      if (typeof item.word !== "string" || item.word.length > 80 || typeof item.meaning !== "string" || item.meaning.length > 500) throw new Error("invalid_practice_answers");
      return { word: item.word, meaning: item.meaning };
    });
  }
  const payload = JSON.stringify({ kind, referenceId, journeyRunId: runId, submission, ...(sourceRevision ? { sourceRevision } : {}) });
  const existing = await context.db.prepare(`${selectRecord} WHERE id=? AND tenant_id=? AND user_id=?`).bind(id, context.tenantId, context.userId).first<RecordRow>();
  if (existing) { if (existing.payloadJson !== payload) throw new Error("practice_record_conflict"); return { record: record(existing) }; }
  const journey = runId ? await ownJourneyRow(context, runId) : null;
  if (journey && !journey.available) throw new Error("journey_unavailable");
  const snapshot = journey && journeySnapshot(journey);
  let title: string; let source: unknown; let result: PracticeRecord["result"];
  if (kind === "writing") {
    const item = practiceCharacters.find((item) => item.character === referenceId);
    if (!item || (snapshot && !snapshot.characters.includes(referenceId))) throw new Error("invalid_practice_character");
    if (journey && journey.stage < 1) throw new Error("journey_stage_locked");
    title = item.character; source = item; result = submission as WritingResult;
  } else {
    const lesson = snapshot?.lesson ?? await resolveReadingLesson(context, referenceId);
    if (!lesson || lesson.id !== referenceId) throw new Error("invalid_practice_lesson");
    if ((lesson.source?.revision ?? 0) !== sourceRevision) throw new Error("reading_lesson_changed");
    const answers = submission as Array<{ word: string; meaning: string }>;
    if (new Set(answers.map((item) => item.word)).size !== 3) throw new Error("invalid_practice_answers");
    const graded = answers.map((answer) => {
      const term = lesson.terms.find((term) => term.word === answer.word && lesson.focusWords.includes(term.word));
      if (!term || !lesson.focusWords.some((word) => lesson.terms.find((item) => item.word === word)?.meaning === answer.meaning)) throw new Error("invalid_practice_answers");
      return { word: term.word, selected: answer.meaning, meaning: term.meaning, correct: answer.meaning === term.meaning };
    });
    title = lesson.title; source = lesson; result = { correct: graded.filter((item) => item.correct).length, total: graded.length, answers: graded } satisfies ReadingResult;
  }
  const teacherLesson = kind === "reading" && (source as ReadingLesson).source ? source as ReadingLesson : null;
  const guard = journey ? journeySourceGuard(context, journey.scenario_id, journey.class_id) : teacherLesson ? {
    sql: "EXISTS (SELECT 1 FROM teacher_reading_lessons r JOIN enrollments e ON e.tenant_id=r.tenant_id AND e.class_id=r.class_id WHERE r.id=? AND r.tenant_id=? AND r.revision=? AND r.status='published' AND e.student_user_id=? AND e.status='active')",
    args: [teacherLesson.id, context.tenantId, teacherLesson.source!.revision, context.userId],
  } : { sql: "1=1", args: [] };
  const runGuard = journey ? "AND EXISTS (SELECT 1 FROM journey_runs WHERE id=? AND tenant_id=? AND user_id=? AND (?='reading' OR stage>=1))" : "";
  const statements = [context.db.prepare(`INSERT OR IGNORE INTO practice_records (id,tenant_id,user_id,kind,reference_id,journey_run_id,title,snapshot_json,payload_json,result_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} ${runGuard}`)
    .bind(id, context.tenantId, context.userId, kind, referenceId, runId, title, JSON.stringify(source), payload, JSON.stringify(result), ...guard.args, ...(journey ? [journey.id, context.tenantId, context.userId, kind] : [])),
    auditStatement(context.db, context.tenantId, context.userId, "practice.saved", "practice-record", id, { kind, referenceId, journeyRunId: runId }, true)];
  if (journey) {
    if (kind === "reading") statements.push(context.db.prepare("UPDATE journey_runs SET stage=1 WHERE id=? AND tenant_id=? AND user_id=? AND stage=0 AND EXISTS (SELECT 1 FROM practice_records WHERE id=? AND tenant_id=? AND user_id=? AND journey_run_id=journey_runs.id)").bind(journey.id, context.tenantId, context.userId, id, context.tenantId, context.userId));
    else statements.push(context.db.prepare(`UPDATE journey_runs SET stage=2 WHERE id=? AND tenant_id=? AND user_id=? AND stage=1 AND EXISTS (SELECT 1 FROM practice_records WHERE id=? AND tenant_id=? AND user_id=? AND journey_run_id=journey_runs.id)
      AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(journey_runs.snapshot_json,'$.characters')) required WHERE NOT EXISTS (SELECT 1 FROM practice_records p WHERE p.tenant_id=journey_runs.tenant_id AND p.user_id=journey_runs.user_id AND p.journey_run_id=journey_runs.id AND p.kind='writing' AND p.reference_id=required.value))`).bind(journey.id, context.tenantId, context.userId, id, context.tenantId, context.userId));
  }
  const [saved] = await context.db.batch(statements);
  const stored = await context.db.prepare(`${selectRecord} WHERE id=? AND tenant_id=? AND user_id=?`).bind(id, context.tenantId, context.userId).first<RecordRow>();
  if (!saved.meta.changes && (!stored || stored.payloadJson !== payload)) throw new Error(journey ? "journey_unavailable" : teacherLesson ? "reading_lesson_changed" : "practice_record_conflict");
  if (!stored) throw new Error("practice_record_not_found");
  return { record: record(stored) };
}
