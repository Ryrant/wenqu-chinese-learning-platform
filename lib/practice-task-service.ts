import { auditStatement } from "./audit";
import { practiceCharacters } from "./hanzi-practice";
import { resolveReadingLesson } from "./reading-content-service";
import type { DialogueContent, DialogueScenario } from "./dialogue-types";
import { publicDialogueScenario } from "./dialogue-types";
import type { PlatformContext } from "./platform-store";
import type { PracticeTask, PracticeTaskSnapshot, PracticeTasks } from "./practice-task-types";
import { taskAvailableSql } from "./practice-task-support";
import type { EvidencePlanItem } from "./learning-plan-types";

function staff(context: PlatformContext) { if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden"); }
function text(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("invalid_practice_task_value"); return value.trim(); }
function uuid(value: unknown) { const id = text(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("invalid_practice_task_id"); return id; }
type TaskRow = { id: string; classId: string; className: string; studentId: string; studentName: string; title: string; detail: string; dueAt: string | null; status: "pending" | "completed"; archivedAt: string | null; createdAt: string; completedAt: string | null; snapshotJson: string; available: number };
const taskSelect = `SELECT t.id,t.class_id AS classId,c.name AS className,r.student_user_id AS studentId,u.display_name AS studentName,r.title,r.detail,r.due_at AS dueAt,r.status,r.archived_at AS archivedAt,r.created_at AS createdAt,r.completed_at AS completedAt,t.snapshot_json AS snapshotJson,CASE WHEN ${taskAvailableSql()} THEN 1 ELSE 0 END AS available
 FROM practice_tasks t JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id JOIN classes c ON c.id=t.class_id AND c.tenant_id=t.tenant_id JOIN users u ON u.id=r.student_user_id`;

export async function readAssignedPracticePlan(context: PlatformContext, studentId: string): Promise<EvidencePlanItem[]> {
  if (!context.roles.includes("student") || studentId !== context.userId) return [];
  const rows = (await context.db.prepare(`SELECT r.id,r.title,r.detail,r.due_at AS dueAt FROM practice_tasks t JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id WHERE t.tenant_id=? AND r.student_user_id=? AND r.status='pending' AND ${taskAvailableSql()} ORDER BY r.created_at,t.id`).bind(context.tenantId, studentId).all<{ id: string; title: string; detail: string; dueAt: string | null }>()).results;
  return rows.map((row) => ({ ...row, studentUserId: studentId, kind: "teacher", basis: [], practiceHref: "/student/practice?practiceTaskId=" + encodeURIComponent(row.id), selectionReason: "老师已布置具体练习，优先按要求完成；完成状态由实际保存的练习记录自动更新。" }));
}

export async function readPracticeTasks(context: PlatformContext, query = new URLSearchParams()): Promise<PracticeTasks> {
  const teaching = query.get("view") === "teaching";
  if (teaching) staff(context); else if (!context.roles.includes("student")) throw new Error("forbidden");
  const id = query.get("taskId") ?? ""; if (id) uuid(id);
  const classId = query.get("classId") ?? ""; const studentId = query.get("studentId") ?? "";
  const scope = teaching ? "(?=1 OR c.teacher_user_id=?)" : "r.student_user_id=?";
  const args = [context.tenantId, ...(teaching ? [context.roles.includes("admin") ? 1 : 0, context.userId] : [context.userId]), id, id, classId, classId, studentId, studentId];
  const where = ` WHERE t.tenant_id=? AND ${scope} AND (?='' OR t.id=?) AND (?='' OR t.class_id=?) AND (?='' OR r.student_user_id=?)`;
  const rows = (await context.db.prepare(taskSelect + where + " ORDER BY r.created_at DESC,t.id DESC").bind(...args).all<TaskRow>()).results;
  if (id && !rows.length) throw new Error("practice_task_not_found");
  const links = (await context.db.prepare(`SELECT pa.task_id,pa.activity_kind AS kind,pa.activity_id AS id,p.reference_id AS character FROM practice_task_activities pa JOIN practice_tasks t ON t.id=pa.task_id AND t.tenant_id=pa.tenant_id JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id JOIN classes c ON c.id=t.class_id AND c.tenant_id=t.tenant_id
    LEFT JOIN practice_records p ON p.id=pa.activity_id AND p.tenant_id=pa.tenant_id AND p.user_id=pa.user_id AND pa.activity_kind='writing' AND p.kind='writing'${where} AND pa.user_id=r.student_user_id ORDER BY pa.created_at DESC,pa.rowid DESC`).bind(...args).all<{ task_id: string; kind: PracticeTask["snapshot"]["kind"]; id: string; character: string | null }>()).results;
  return { tasks: rows.map(({ snapshotJson, available, ...row }) => {
    const activities = links.filter((link) => link.task_id === row.id);
    const snapshot = JSON.parse(snapshotJson) as PracticeTaskSnapshot;
    return { ...row, snapshot: teaching || !snapshot.scenario ? snapshot : { ...snapshot, scenario: publicDialogueScenario(snapshot.scenario) }, available: !!available, activities: activities.map(({ kind, id }) => ({ kind, id })), writtenCharacters: [...new Set(activities.flatMap((item) => item.character ? [item.character] : []))], href: "/student/practice?practiceTaskId=" + encodeURIComponent(row.id) };
  }) };
}

export async function changePracticeTask(context: PlatformContext, body: Record<string, unknown>) {
  staff(context); const id = uuid(body.id); const admin = context.roles.includes("admin") ? 1 : 0;
  if (body.action === "archive") {
    const found = await context.db.prepare("SELECT t.id FROM practice_tasks t JOIN classes c ON c.id=t.class_id AND c.tenant_id=t.tenant_id WHERE t.id=? AND t.tenant_id=? AND (?=1 OR c.teacher_user_id=?)").bind(id, context.tenantId, admin, context.userId).first();
    if (!found) throw new Error("practice_task_not_found");
    await context.db.batch([
      context.db.prepare("UPDATE learning_recommendations SET archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND archived_at IS NULL AND EXISTS (SELECT 1 FROM practice_tasks t JOIN classes c ON c.id=t.class_id AND c.tenant_id=t.tenant_id WHERE t.id=learning_recommendations.id AND t.tenant_id=learning_recommendations.tenant_id AND (?=1 OR c.teacher_user_id=?))").bind(id, context.tenantId, admin, context.userId),
      auditStatement(context.db, context.tenantId, context.userId, "practice_task.archived", "learning_recommendation", id, {}, true),
    ]);
    return readPracticeTasks(context, new URLSearchParams({ view: "teaching" }));
  }
  if (body.action !== "publish") throw new Error("invalid_practice_task_action");
  const classId = text(body.classId, 120); const studentId = text(body.studentId, 120);
  const title = text(body.title, 100); const detail = text(body.detail, 2000);
  const due = body.dueAt ? new Date(text(body.dueAt, 40)) : null;
  if (due && !Number.isFinite(due.getTime())) throw new Error("invalid_practice_task_due");
  const dueAt = due?.toISOString() ?? null;
  const kind = body.kind;
  if (!["reading", "writing", "dictation", "journey"].includes(String(kind))) throw new Error("invalid_practice_task_target");
  const payload = JSON.stringify({ classId, studentId, title, detail, dueAt, kind, lessonId: body.lessonId ?? null, sourceRevision: body.sourceRevision ?? 0, scenarioId: body.scenarioId ?? null, scenarioRevision: body.scenarioRevision ?? 0, characters: body.characters ?? null, dictationKind: body.dictationKind ?? null });
  const existing = await context.db.prepare("SELECT t.payload_json FROM practice_tasks t JOIN classes c ON c.id=t.class_id AND c.tenant_id=t.tenant_id WHERE t.id=? AND t.tenant_id=? AND (?=1 OR c.teacher_user_id=?)").bind(id, context.tenantId, admin, context.userId).first<{ payload_json: string }>();
  if (existing) { if (existing.payload_json !== payload) throw new Error("practice_task_conflict"); return readPracticeTasks(context, new URLSearchParams({ view: "teaching" })); }
  const scope = "EXISTS (SELECT 1 FROM classes c JOIN enrollments e ON e.class_id=c.id AND e.tenant_id=c.tenant_id JOIN users u ON u.id=e.student_user_id JOIN role_memberships rm ON rm.tenant_id=e.tenant_id AND rm.user_id=u.id WHERE c.id=? AND c.tenant_id=? AND (?=1 OR c.teacher_user_id=?) AND e.student_user_id=? AND e.status='active' AND u.status='active' AND u.must_change_password=0 AND rm.role='student' AND rm.status='active')";
  const scopeArgs: Array<string | number> = [classId, context.tenantId, admin, context.userId, studentId];
  if (!await context.db.prepare("SELECT 1 WHERE " + scope).bind(...scopeArgs).first()) throw new Error("forbidden");
  const snapshot: PracticeTaskSnapshot = { kind: kind as PracticeTaskSnapshot["kind"] };
  let guard = scope; const guardArgs = [...scopeArgs];
  if (kind === "writing") {
    if (!Array.isArray(body.characters) || !body.characters.length || body.characters.length > 12 || new Set(body.characters).size !== body.characters.length || body.characters.some((char) => !practiceCharacters.some((item) => item.character === char))) throw new Error("invalid_practice_character");
    snapshot.characters = body.characters;
  } else {
    if (kind === "journey") {
      const scenarioId = uuid(body.scenarioId);
      const row = await context.db.prepare("SELECT d.*,c.name AS className,u.display_name AS authorName FROM dialogue_scenarios d JOIN classes c ON c.id=d.class_id AND c.tenant_id=d.tenant_id JOIN users u ON u.id=d.created_by WHERE d.id=? AND d.tenant_id=? AND d.class_id=? AND d.status='published' AND (?=1 OR c.teacher_user_id=?)").bind(scenarioId, context.tenantId, classId, admin, context.userId).first<{ id: string; title: string; content_json: string; revision: number; className: string; authorName: string }>();
      if (!row || row.revision !== body.scenarioRevision) throw new Error("practice_task_unavailable");
      const content = JSON.parse(row.content_json) as DialogueContent;
      if (!content.journey) throw new Error("invalid_practice_task_target");
      snapshot.scenario = { ...content, id: row.id, title: row.title, classId, className: row.className, authorName: row.authorName, revision: row.revision, status: "published" } satisfies DialogueScenario;
      snapshot.characters = content.journey.characters;
      snapshot.lesson = await resolveReadingLesson(context, content.journey.lessonId, true, classId);
      guard += " AND EXISTS (SELECT 1 FROM dialogue_scenarios WHERE id=? AND tenant_id=? AND class_id=? AND revision=? AND status='published')";
      guardArgs.push(row.id, context.tenantId, classId, row.revision);
    } else {
      snapshot.lesson = await resolveReadingLesson(context, text(body.lessonId, 120), true, classId);
      if ((snapshot.lesson.source?.revision ?? 0) !== (body.sourceRevision ?? 0)) throw new Error("reading_lesson_changed");
    }
    if (snapshot.lesson!.source) {
      guard += " AND EXISTS (SELECT 1 FROM teacher_reading_lessons WHERE id=? AND tenant_id=? AND class_id=? AND revision=? AND status='published')";
      guardArgs.push(snapshot.lesson!.id, context.tenantId, classId, snapshot.lesson!.source.revision);
    }
    if (kind === "dictation") {
      if (body.dictationKind !== "words" && body.dictationKind !== "sentences") throw new Error("invalid_dictation_kind");
      const lesson = snapshot.lesson!; snapshot.dictationKind = body.dictationKind;
      const items = body.dictationKind === "sentences" ? lesson.sentences.map((expected) => ({ expected, pinyin: "", sourceTitle: lesson.title })) : lesson.focusWords.map((word) => ({ expected: word, pinyin: lesson.terms.find((term) => term.word === word)!.pinyin, sourceTitle: lesson.title }));
      snapshot.items = [...new Map(items.map((item) => [item.expected, item])).values()].slice(0, 5);
      if (!snapshot.items.length) throw new Error("dictation_empty");
    }
  }
  const auditId = crypto.randomUUID();
  const [saved] = await context.db.batch([
    context.db.prepare(`INSERT OR IGNORE INTO learning_recommendations (id,tenant_id,student_user_id,source_type,source_id,title,detail,due_at,created_by) SELECT ?,?,?,'teacher',?,?,?,?,? WHERE ${guard}`).bind(id, context.tenantId, studentId, id, title, detail, dueAt, context.userId, ...guardArgs),
    auditStatement(context.db, context.tenantId, context.userId, "practice_task.published", "learning_recommendation", id, { classId, studentId, kind }, true, auditId),
    context.db.prepare("INSERT OR IGNORE INTO practice_tasks (id,tenant_id,class_id,target_kind,snapshot_json,payload_json) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM audit_logs WHERE id=? AND tenant_id=? AND actor_user_id=? AND target_id=?)").bind(id, context.tenantId, classId, kind, JSON.stringify(snapshot), payload, auditId, context.tenantId, context.userId, id),
  ]);
  if (!saved.meta.changes) {
    const replay = await context.db.prepare("SELECT payload_json FROM practice_tasks WHERE id=? AND tenant_id=?").bind(id, context.tenantId).first<{ payload_json: string }>();
    if (!replay || replay.payload_json !== payload) throw new Error("practice_task_conflict");
  }
  return readPracticeTasks(context, new URLSearchParams({ view: "teaching" }));
}
