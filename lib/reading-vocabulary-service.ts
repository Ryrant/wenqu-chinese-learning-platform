import type { PlatformContext } from "./platform-store";
import { lessonTerms, readingLessons, type SavedReadingWord } from "./reading-lessons";

export async function readReadingVocabulary({ db, tenantId, userId }: PlatformContext): Promise<SavedReadingWord[]> {
  return (await db.prepare(`SELECT id,lesson_id AS lessonId,lesson_title AS lessonTitle,word,pinyin,meaning,example,created_at AS createdAt
    FROM student_vocabulary WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC,rowid DESC`).bind(tenantId, userId).all<SavedReadingWord>()).results;
}

export async function changeReadingVocabulary(context: PlatformContext, body: Record<string, unknown>) {
  const { db, tenantId, userId } = context;
  if (body.action === "save") {
    const lesson = readingLessons.find((item) => item.id === body.lessonId);
    const term = lesson && lessonTerms(lesson).find((item) => item.word === body.word);
    const example = lesson?.sentences.find((sentence) => term && sentence.includes(term.word));
    if (!lesson || !term || !example) throw new Error("invalid_reading_word");
    await db.prepare(`INSERT OR IGNORE INTO student_vocabulary (id,tenant_id,user_id,lesson_id,lesson_title,word,pinyin,meaning,example)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), tenantId, userId, lesson.id, lesson.title, term.word, term.pinyin, term.meaning, example).run();
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
