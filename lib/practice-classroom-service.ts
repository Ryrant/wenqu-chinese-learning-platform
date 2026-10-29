import { activityDetail, activityEntry, decodeCursor, encodeCursor, practiceActivitiesSql, practiceKinds, type ActivityRow, type Markers, type PracticeCursor } from "./practice-history-service";
import { learningAnalyticsConsentSql } from "./learning-analytics";
import { taskAvailableSql } from "./practice-task-support";
import type { ClassroomPractice } from "./practice-task-types";
import type { PlatformContext } from "./platform-store";

type ClassActivity = ActivityRow & { studentName: string; className: string };
type ClassCursor = PracticeCursor & { classId: string; studentId: string; taskMarker: number };
export async function readClassroomPractice(context: PlatformContext, query: URLSearchParams) {
  if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden");
  const { db, tenantId, userId } = context; const admin = context.roles.includes("admin") ? 1 : 0;
  const classId = query.get("classId") ?? ""; const studentId = query.get("studentId") ?? "";
  const periodValue = query.get("period") ?? "30";
  if (periodValue !== "7" && periodValue !== "30") throw new Error("invalid_practice_period");
  const period = Number(periodValue) as 7 | 30;
  const classes = (await db.prepare("SELECT id,name FROM classes WHERE tenant_id=? AND (?=1 OR teacher_user_id=?) ORDER BY name,id").bind(tenantId, admin, userId).all<{ id: string; name: string }>()).results;
  if (classId && !classes.some((item) => item.id === classId)) throw new Error("forbidden");
  const studentsSql = `SELECT DISTINCT u.id,u.display_name AS name,e.class_id AS classId,CASE WHEN ${learningAnalyticsConsentSql("e.tenant_id", "u.id")} THEN 1 ELSE 0 END AS analytics
    FROM enrollments e JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id JOIN users u ON u.id=e.student_user_id
    JOIN role_memberships rm ON rm.tenant_id=e.tenant_id AND rm.user_id=u.id AND rm.role='student' AND rm.status='active'
    WHERE e.tenant_id=? AND e.status='active' AND u.status='active' AND (?=1 OR c.teacher_user_id=?) AND (?='' OR c.id=?) ORDER BY u.display_name,u.id,e.class_id`;
  const studentsArgs = [tenantId, admin, userId, classId, classId];
  const students = (await db.prepare(studentsSql).bind(...studentsArgs).all<{ id: string; name: string; classId: string; analytics: number }>()).results;
  if (studentId && !students.some((item) => item.id === studentId)) throw new Error("forbidden");
  let cursor: ClassCursor;
  if (query.get("cursor")) {
    cursor = decodeCursor(query.get("cursor")!, period) as ClassCursor;
    if (cursor.classId !== classId || cursor.studentId !== studentId || !Number.isSafeInteger(cursor.taskMarker) || cursor.taskMarker < 0) throw new Error("invalid_practice_cursor");
  } else {
    const boundaries = await db.prepare("SELECT COALESCE((SELECT MAX(rowid) FROM practice_records WHERE tenant_id=?),0) AS p,COALESCE((SELECT MAX(rowid) FROM vocabulary_review_sessions WHERE tenant_id=?),0) AS v,COALESCE((SELECT MAX(rowid) FROM dictation_sessions WHERE tenant_id=?),0) AS d,COALESCE((SELECT MAX(rowid) FROM journey_runs WHERE tenant_id=?),0) AS j,COALESCE((SELECT MAX(rowid) FROM practice_tasks WHERE tenant_id=?),0) AS taskMarker").bind(tenantId, tenantId, tenantId, tenantId, tenantId).first<Markers & { taskMarker: number }>();
    const { taskMarker, ...markers } = boundaries!;
    cursor = { period, classId, studentId, asOf: new Date().toISOString(), markers, taskMarker, after: null };
  }
  const day = new Date(Date.parse(cursor.asOf) + 8 * 3600000); day.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(day.getTime() - 8 * 3600000 - (period - 1) * 86400000).toISOString();
  const scope = ` FROM activities a JOIN classes c ON c.id=a.classId AND c.tenant_id=? JOIN users u ON u.id=a.userId AND u.status='active'
    WHERE (?=1 OR c.teacher_user_id=?) AND (?='' OR c.id=?) AND (?='' OR a.userId=?)
      AND EXISTS (SELECT 1 FROM enrollments e JOIN role_memberships rm ON rm.tenant_id=e.tenant_id AND rm.user_id=e.student_user_id AND rm.role='student' AND rm.status='active' WHERE e.tenant_id=c.tenant_id AND e.class_id=c.id AND e.student_user_id=a.userId AND e.status='active')
      AND a.createdAt>=? AND a.createdAt<=? AND a.sequence<=CASE a.kind WHEN 'writing' THEN ? WHEN 'reading' THEN ? WHEN 'vocabulary' THEN ? WHEN 'dictation' THEN ? ELSE ? END`;
  const args = [tenantId, tenantId, tenantId, tenantId, tenantId, admin, userId, classId, classId, studentId, studentId, rangeStart, cursor.asOf, cursor.markers.p, cursor.markers.p, cursor.markers.v, cursor.markers.d, cursor.markers.j];
  const cte = practiceActivitiesSql(false);
  const recordKind = query.get("recordKind"); const recordId = query.get("recordId");
  if (recordKind || recordId) {
    if (!practiceKinds.includes(recordKind as ActivityRow["kind"]) || !recordId || !/^[0-9a-f-]{36}$/i.test(recordId)) throw new Error("invalid_practice_id");
    const row = await db.prepare(cte + " SELECT a.*" + scope + " AND a.kind=? AND a.id=?").bind(...args, recordKind, recordId).first<ClassActivity>();
    if (!row) throw new Error("practice_record_not_found");
    return activityDetail(row);
  }
  const consent = learningAnalyticsConsentSql("c.tenant_id", "a.userId");
  const after = cursor.after;
  const position = after ? " AND (a.createdAt<? OR (a.createdAt=? AND (a.kind<? OR (a.kind=? AND a.id<?))))" : "";
  const metric = `SELECT a.kind,COUNT(*) AS rounds,SUM(a.status='finished') AS completed,
    SUM(CASE a.kind WHEN 'reading' THEN json_extract(a.resultJson,'$.correct') WHEN 'dictation' THEN (SELECT COUNT(*) FROM json_each(a.stateJson,'$.answers') answer WHERE json_extract(answer.value,'$.correct')=1) END) AS correct,
    SUM(CASE a.kind WHEN 'reading' THEN json_extract(a.resultJson,'$.total') WHEN 'dictation' THEN json_array_length(a.stateJson,'$.answers') END) AS total,
    SUM(CASE a.kind WHEN 'writing' THEN json_extract(a.resultJson,'$.hints') WHEN 'journey' THEN json_extract(a.resultJson,'$.hints') END) AS hints,
    SUM(CASE WHEN a.kind='dictation' THEN (SELECT COUNT(*) FROM json_each(a.stateJson,'$.answers') answer WHERE json_extract(answer.value,'$.usedReference')=1) END) AS referenceViewed${scope} AND ${consent} GROUP BY a.kind`;
  const wrong = cte + `, visible AS (SELECT a.*${scope} AND ${consent}), mistakes AS (
    SELECT a.id,a.userId,a.kind,json_extract(answer.value,'$.word') AS word FROM visible a,json_each(a.resultJson,'$.answers') answer WHERE a.kind='reading' AND json_extract(answer.value,'$.correct')=0
    UNION ALL SELECT a.id,a.userId,a.kind,json_extract(answer.value,'$.expected') FROM visible a,json_each(a.stateJson,'$.answers') answer WHERE a.kind='dictation' AND json_extract(answer.value,'$.correct')=0
  ), ranked AS (SELECT *,COUNT(*) OVER (PARTITION BY kind,word) AS count,ROW_NUMBER() OVER (PARTITION BY kind,word ORDER BY id DESC,userId) AS position FROM mistakes)
  SELECT word,count,kind,id AS recordId,userId AS studentId FROM ranked WHERE position=1 ORDER BY count DESC,word,kind LIMIT 10`;
  const taskSql = `SELECT COUNT(*) AS total,COALESCE(SUM(r.status='completed'),0) AS completed,COALESCE(SUM(NOT (${taskAvailableSql()})),0) AS paused
    FROM practice_tasks t JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id JOIN classes c ON c.id=t.class_id AND c.tenant_id=t.tenant_id
    WHERE t.tenant_id=? AND (?=1 OR c.teacher_user_id=?) AND (?='' OR c.id=?) AND (?='' OR r.student_user_id=?) AND strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at)>=? AND strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at)<=? AND t.rowid<=?
      AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=t.tenant_id AND e.class_id=t.class_id AND e.student_user_id=r.student_user_id AND e.status='active')`;
  const statements = [
    db.prepare(cte + " SELECT a.*,u.display_name AS studentName,c.name AS className" + scope + position + " ORDER BY a.createdAt DESC,a.kind DESC,a.id DESC LIMIT 21").bind(...args, ...(after ? [after.at, after.at, after.kind, after.kind, after.id] : [])),
    db.prepare(cte + " " + metric).bind(...args), db.prepare(wrong).bind(...args),
    db.prepare(taskSql).bind(tenantId, admin, userId, classId, classId, studentId, studentId, rangeStart, cursor.asOf, cursor.taskMarker),
  ];
  const results = await (db.readBatch ? db.readBatch(statements) : db.batch(statements));
  const latest = (await db.prepare(studentsSql).bind(...studentsArgs).all<typeof students[number]>()).results;
  const currentConsent = (values: typeof students) => [...new Set(values.filter((item) => (!studentId || item.id === studentId) && item.analytics).map((item) => item.id))].sort().join(",");
  const sameConsent = currentConsent(students) === currentConsent(latest);
  const page = (results[0].results as ClassActivity[]).slice(0, 20); const last = page.at(-1);
  const data: ClassroomPractice = {
    classes, students: latest.map(({ id, name, classId }) => ({ id, name, classId })), classId, studentId, period, rangeStart, asOf: cursor.asOf,
    consentedStudents: new Set(latest.filter((item) => (!studentId || item.id === studentId) && item.analytics).map((item) => item.id)).size,
    studentCount: new Set(latest.filter((item) => !studentId || item.id === studentId).map((item) => item.id)).size,
    metrics: sameConsent ? results[1].results as ClassroomPractice["metrics"] : [], wrongWords: sameConsent ? results[2].results as ClassroomPractice["wrongWords"] : [],
    tasks: results[3].results![0] as ClassroomPractice["tasks"],
    records: page.map((row) => ({ ...activityEntry(row), studentId: row.userId, studentName: row.studentName, className: row.className })),
    currentCursor: encodeCursor(cursor), nextCursor: results[0].results!.length > 20 && last ? encodeCursor({ ...cursor, after: { at: last.createdAt, kind: last.kind, id: last.id } }) : null,
  };
  return data;
}
