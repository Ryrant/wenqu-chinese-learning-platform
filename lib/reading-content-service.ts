import { auditStatement } from "./audit";
import { missingReadingCharacters, readingLessons, type ReadingLesson, type ReadingTerm } from "./reading-lessons";
import type { PlatformContext } from "./platform-store";

type LessonRow = { id: string; class_id: string; title: string; level: string; content_json: string; status: "draft" | "published" | "archived"; revision: number; className: string; authorName: string };
export type ReadingCatalog = { lessons: ReadingLesson[]; classes: Array<{ id: string; name: string }> };
const selectLesson = `SELECT r.*,c.name AS className,u.display_name AS authorName FROM teacher_reading_lessons r JOIN classes c ON c.id=r.class_id AND c.tenant_id=r.tenant_id JOIN users u ON u.id=r.created_by`;
const admin = (context: PlatformContext) => context.roles.includes("admin");
function staff(context: PlatformContext) { if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden"); }
function student(context: PlatformContext) { if (!context.roles.includes("student")) throw new Error("forbidden"); }
function readingId(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("invalid_reading_lesson_id"); return value; }
function lesson(row: LessonRow): ReadingLesson { return { ...JSON.parse(row.content_json) as Pick<ReadingLesson, "sentences" | "terms" | "focusWords">, id: row.id, title: row.title, level: row.level, source: { classId: row.class_id, className: row.className, authorName: row.authorName, revision: row.revision, status: row.status } }; }
function text(value: unknown, limit: number) { if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("invalid_reading_lesson_text"); return value.trim(); }

export async function readReadingCatalog(context: PlatformContext, asStaff = false): Promise<ReadingCatalog> {
  if (asStaff) staff(context); else student(context);
  const scope = asStaff ? "(?=1 OR c.teacher_user_id=?)" : "r.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=r.tenant_id AND e.class_id=r.class_id AND e.student_user_id=? AND e.status='active')";
  const args = asStaff ? [admin(context) ? 1 : 0, context.userId] : [context.userId];
  const rows = await context.db.prepare(`${selectLesson} WHERE r.tenant_id=? AND ${scope} ORDER BY r.updated_at DESC,r.rowid DESC`).bind(context.tenantId, ...args).all<LessonRow>();
  const classes = asStaff ? (await context.db.prepare("SELECT id,name FROM classes WHERE tenant_id=? AND (?=1 OR teacher_user_id=?) ORDER BY name,id").bind(context.tenantId, admin(context) ? 1 : 0, context.userId).all<{ id: string; name: string }>()).results : [];
  return { lessons: [...(asStaff ? [] : readingLessons), ...rows.results.map(lesson)], classes };
}

export async function resolveReadingLesson(context: PlatformContext, id: string, asStaff = false, classId = ""): Promise<ReadingLesson> {
  if (asStaff) staff(context); else student(context);
  const builtin = readingLessons.find((item) => item.id === id); if (builtin) return builtin;
  readingId(id);
  const scope = asStaff ? "(?=1 OR c.teacher_user_id=?)" : "EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=r.tenant_id AND e.class_id=r.class_id AND e.student_user_id=? AND e.status='active')";
  const args = asStaff ? [admin(context) ? 1 : 0, context.userId] : [context.userId];
  const row = await context.db.prepare(`${selectLesson} WHERE r.id=? AND r.tenant_id=? AND r.status='published' AND (?='' OR r.class_id=?) AND ${scope}`).bind(id, context.tenantId, classId, classId, ...args).first<LessonRow>();
  if (!row) throw new Error("reading_lesson_unavailable"); return lesson(row);
}

export async function changeReadingLesson(context: PlatformContext, body: Record<string, unknown>) {
  staff(context); const id = readingId(body.id);
  if (!Number.isInteger(body.revision) || Number(body.revision) < 0) throw new Error("invalid_reading_lesson_revision");
  const current = await context.db.prepare(`${selectLesson} WHERE r.id=? AND r.tenant_id=? AND (?=1 OR c.teacher_user_id=?)`).bind(id, context.tenantId, admin(context) ? 1 : 0, context.userId).first<LessonRow>();
  if (body.action === "archive") {
    if (!current) throw new Error("reading_lesson_not_found");
    if (current.status === "archived") return readReadingCatalog(context, true);
    const [result] = await context.db.batch([
      context.db.prepare("UPDATE teacher_reading_lessons SET status='archived',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND revision=? AND EXISTS (SELECT 1 FROM classes c WHERE c.id=teacher_reading_lessons.class_id AND c.tenant_id=teacher_reading_lessons.tenant_id AND (?=1 OR c.teacher_user_id=?))").bind(id, context.tenantId, body.revision, admin(context) ? 1 : 0, context.userId),
      auditStatement(context.db, context.tenantId, context.userId, "reading_lesson.archived", "reading-lesson", id, {}, true),
    ]);
    if (!result.meta.changes) throw new Error("reading_lesson_changed");
    return readReadingCatalog(context, true);
  }
  if (body.action !== "draft" && body.action !== "publish") throw new Error("invalid_reading_lesson_action");
  if (body.action === "draft" && current?.status === "published") throw new Error("invalid_reading_lesson_published_draft");
  const classId = text(body.classId, 120); const title = text(body.title, 100); const level = text(body.level, 20);
  const owned = await context.db.prepare("SELECT id FROM classes WHERE id=? AND tenant_id=? AND (?=1 OR teacher_user_id=?)").bind(classId, context.tenantId, admin(context) ? 1 : 0, context.userId).first();
  if (!owned) throw new Error("forbidden");
  if (current && current.class_id !== classId) throw new Error("reading_lesson_changed");
  if (!Array.isArray(body.sentences) || body.sentences.length < 1 || body.sentences.length > 20 || !Array.isArray(body.terms) || body.terms.length > 300 || !Array.isArray(body.focusWords) || body.focusWords.length > 12) throw new Error("invalid_reading_lesson_content");
  const sentences = body.sentences.map((value) => text(value, 300));
  const terms: ReadingTerm[] = body.terms.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_reading_lesson_term");
    const term = value as Record<string, unknown>;
    return { word: text(term.word, 30), pinyin: text(term.pinyin, 120), meaning: text(term.meaning, 500) };
  });
  if (new Set(terms.map((term) => term.word)).size !== terms.length || terms.some((term) => !sentences.some((sentence) => sentence.includes(term.word)))) throw new Error("invalid_reading_lesson_terms");
  const focusWords = body.focusWords.map((word) => text(word, 30));
  if (new Set(focusWords).size !== focusWords.length || focusWords.some((word) => !terms.some((term) => term.word === word))) throw new Error("invalid_reading_lesson_focus");
  const content = { sentences, terms, focusWords }; const data: ReadingLesson = { id, title, level, ...content };
  if (body.action === "publish" && (focusWords.length < 4 || new Set(focusWords.map((word) => terms.find((term) => term.word === word)!.meaning)).size !== focusWords.length || missingReadingCharacters(data).length)) throw new Error("invalid_reading_lesson_annotations");
  const status = body.action === "publish" ? "published" : "draft"; const serialized = JSON.stringify(content);
  if (current && current.title === title && current.level === level && current.content_json === serialized && current.status === status) return readReadingCatalog(context, true);
  if ((current?.revision ?? 0) !== body.revision) throw new Error("reading_lesson_changed");
  const guard = "EXISTS (SELECT 1 FROM classes c WHERE c.id=? AND c.tenant_id=? AND (?=1 OR c.teacher_user_id=?))";
  const args = [classId, context.tenantId, admin(context) ? 1 : 0, context.userId];
  const statement = current
    ? context.db.prepare(`UPDATE teacher_reading_lessons SET title=?,level=?,content_json=?,status=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND class_id=? AND revision=? AND ${guard}`).bind(title, level, serialized, status, id, context.tenantId, classId, body.revision, ...args)
    : context.db.prepare(`INSERT OR IGNORE INTO teacher_reading_lessons (id,tenant_id,class_id,title,level,content_json,status,created_by) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(id, context.tenantId, classId, title, level, serialized, status, context.userId, ...args);
  const [saved] = await context.db.batch([statement, auditStatement(context.db, context.tenantId, context.userId, `reading_lesson.${body.action === "publish" ? "published" : "draft_saved"}`, "reading-lesson", id, { classId, revision: Number(body.revision) + 1 }, true)]);
  if (!saved.meta.changes) throw new Error("reading_lesson_changed");
  return readReadingCatalog(context, true);
}
