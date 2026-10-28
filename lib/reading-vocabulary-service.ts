import type { PlatformContext } from "./platform-store";
import { lessonTerms, type SavedReadingWord } from "./reading-lessons";
import { resolveReadingLesson } from "./reading-content-service";
import { journeySnapshot, journeySourceGuard, ownJourneyRow, practiceId } from "./journey-service";

export async function readReadingVocabulary({ db, tenantId, userId }: PlatformContext): Promise<SavedReadingWord[]> {
  return (await db.prepare(`SELECT id,lesson_id AS lessonId,lesson_title AS lessonTitle,word,pinyin,meaning,example,created_at AS createdAt
    FROM student_vocabulary WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC`).bind(tenantId, userId).all<SavedReadingWord>()).results;
}

export async function changeReadingVocabulary(context: PlatformContext, body: Record<string, unknown>) {
  const { db, tenantId, userId } = context;
  if (body.action === "save") {
    if (typeof body.lessonId !== "string" || !body.lessonId || body.lessonId.length > 120) throw new Error("invalid_reading_word");
    if (typeof body.word !== "string" || !body.word || body.word.length > 80) throw new Error("invalid_reading_word");
    const run = body.journeyRunId ? await ownJourneyRow(context, practiceId(body.journeyRunId)) : null;
    const collected = await db.prepare("SELECT id FROM student_vocabulary WHERE tenant_id=? AND user_id=? AND lesson_id=? AND word=?").bind(tenantId, userId, body.lessonId, body.word).first();
    if (collected) return { vocabulary: await readReadingVocabulary(context) };
    if (run && !run.available) throw new Error("journey_unavailable");
    const lesson = run ? journeySnapshot(run).lesson : await resolveReadingLesson(context, body.lessonId);
    if (lesson.id !== body.lessonId) throw new Error("invalid_reading_word");
    if ((lesson.source?.revision ?? 0) !== (body.sourceRevision ?? 0)) throw new Error("reading_lesson_changed");
    const term = lesson && lessonTerms(lesson).find((item) => item.word === body.word);
    const example = lesson?.sentences.find((sentence) => term && sentence.includes(term.word));
    if (!lesson || !term || !example) throw new Error("invalid_reading_word");
    const guard = run ? journeySourceGuard(context, run.scenario_id, run.class_id) : lesson.source ? {
      sql: "EXISTS (SELECT 1 FROM teacher_reading_lessons r JOIN enrollments e ON e.tenant_id=r.tenant_id AND e.class_id=r.class_id WHERE r.id=? AND r.tenant_id=? AND r.revision=? AND r.status='published' AND e.student_user_id=? AND e.status='active')",
      args: [lesson.id, tenantId, lesson.source.revision, userId],
    } : { sql: "1=1", args: [] };
    const saved = await db.prepare(`INSERT OR IGNORE INTO student_vocabulary (id,tenant_id,user_id,lesson_id,lesson_title,word,pinyin,meaning,example)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(crypto.randomUUID(), tenantId, userId, lesson.id, lesson.title, term.word, term.pinyin, term.meaning, example, ...guard.args).run();
    if (!saved.meta.changes && !await db.prepare("SELECT id FROM student_vocabulary WHERE tenant_id=? AND user_id=? AND lesson_id=? AND word=?").bind(tenantId, userId, lesson.id, term.word).first()) throw new Error("reading_lesson_unavailable");
  } else if (body.action === "remove") {
    if (typeof body.id !== "string" || !body.id || body.id.length > 120) throw new Error("invalid_reading_word_id");
    // 删除限定在本人和本机构；重复删除仍是已移除状态，便于响应丢失后重试。
    await db.batch([
      db.prepare("DELETE FROM vocabulary_review_state WHERE vocabulary_id=? AND tenant_id=? AND user_id=?").bind(body.id, tenantId, userId),
      db.prepare("DELETE FROM student_vocabulary WHERE id=? AND tenant_id=? AND user_id=?").bind(body.id, tenantId, userId),
    ]);
  } else throw new Error("invalid_reading_action");
  return { vocabulary: await readReadingVocabulary(context) };
}
