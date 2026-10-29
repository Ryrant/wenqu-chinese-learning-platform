import { auditStatement } from "./audit";
import type { PlatformContext } from "./platform-store";
import type { PracticeTaskKind, PracticeTaskSnapshot } from "./practice-task-types";

export type PracticeTaskRow = { id: string; tenant_id: string; class_id: string; student_user_id: string; snapshot_json: string; available: number; status: string; archived_at: string | null };

// 快照固定练习内容；来源发布状态、学籍和账号在每次写入事务中重新校验。
export function taskAvailableSql(t = "t", r = "r") {
  return `${r}.archived_at IS NULL
    AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=${t}.tenant_id AND e.class_id=${t}.class_id AND e.student_user_id=${r}.student_user_id AND e.status='active')
    AND EXISTS (SELECT 1 FROM users u JOIN role_memberships rm ON rm.user_id=u.id JOIN tenants tenant ON tenant.id=rm.tenant_id WHERE u.id=${r}.student_user_id AND u.status='active' AND u.must_change_password=0 AND rm.tenant_id=${t}.tenant_id AND rm.role='student' AND rm.status='active' AND tenant.status='active')
    AND (json_extract(${t}.snapshot_json,'$.lesson.source.classId') IS NULL OR EXISTS (SELECT 1 FROM teacher_reading_lessons lesson WHERE lesson.id=json_extract(${t}.snapshot_json,'$.lesson.id') AND lesson.tenant_id=${t}.tenant_id AND lesson.class_id=${t}.class_id AND lesson.status='published'))
    AND (${t}.target_kind!='journey' OR EXISTS (SELECT 1 FROM dialogue_scenarios scenario WHERE scenario.id=json_extract(${t}.snapshot_json,'$.scenario.id') AND scenario.tenant_id=${t}.tenant_id AND scenario.class_id=${t}.class_id AND scenario.status='published'))`;
}
export function taskGuard(context: PlatformContext, taskId: string) {
  return { sql: `EXISTS (SELECT 1 FROM practice_tasks t JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id WHERE t.id=? AND t.tenant_id=? AND r.student_user_id=? AND ${taskAvailableSql()})`, args: [taskId, context.tenantId, context.userId] };
}
export function boundTaskGuard(context: PlatformContext, kind: PracticeTaskKind, activityId: string) {
  return { sql: `NOT EXISTS (SELECT 1 FROM practice_task_activities pa JOIN practice_tasks t ON t.id=pa.task_id AND t.tenant_id=pa.tenant_id JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id WHERE pa.tenant_id=? AND pa.user_id=? AND pa.activity_kind=? AND pa.activity_id=? AND NOT (${taskAvailableSql()}))`, args: [context.tenantId, context.userId, kind, activityId] };
}
export async function ownPracticeTask(context: PlatformContext, id: unknown, kind?: PracticeTaskKind, active = true) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid_practice_task_id");
  const row = await context.db.prepare(`SELECT t.*,r.student_user_id,r.status,r.archived_at,CASE WHEN ${taskAvailableSql()} THEN 1 ELSE 0 END AS available FROM practice_tasks t JOIN learning_recommendations r ON r.id=t.id AND r.tenant_id=t.tenant_id WHERE t.id=? AND t.tenant_id=? AND r.student_user_id=?`).bind(id, context.tenantId, context.userId).first<PracticeTaskRow>();
  if (!row) throw new Error("practice_task_not_found");
  const snapshot = JSON.parse(row.snapshot_json) as PracticeTaskSnapshot;
  if (kind && snapshot.kind !== kind) throw new Error("invalid_practice_task_target");
  if (active && !row.available) throw new Error("practice_task_unavailable");
  return { ...row, snapshot };
}
export async function activityPracticeTask(context: PlatformContext, kind: PracticeTaskKind, activityId: string, provided?: unknown, active = true) {
  const link = await context.db.prepare("SELECT task_id FROM practice_task_activities WHERE tenant_id=? AND user_id=? AND activity_kind=? AND activity_id=?").bind(context.tenantId, context.userId, kind, activityId).first<{ task_id: string }>();
  if (provided !== undefined && provided !== link?.task_id) throw new Error("practice_task_conflict");
  return link ? ownPracticeTask(context, link.task_id, undefined, active) : null;
}
export function taskActivityStatement(context: PlatformContext, taskId: string, kind: PracticeTaskKind, activityId: string) {
  const table = kind === "journey" ? "journey_runs" : kind === "dictation" ? "dictation_sessions" : "practice_records";
  const guard = taskGuard(context, taskId);
  return context.db.prepare(`INSERT OR IGNORE INTO practice_task_activities (tenant_id,task_id,user_id,activity_kind,activity_id)
    SELECT ?,?,?,?,? WHERE changes()>0 AND ${guard.sql} AND EXISTS (SELECT 1 FROM ${table} WHERE id=? AND tenant_id=? AND user_id=?)`).bind(context.tenantId, taskId, context.userId, kind, activityId, ...guard.args, activityId, context.tenantId, context.userId);
}
export function taskCompletionStatements(context: PlatformContext, taskId: string) {
  return [
    context.db.prepare(`UPDATE learning_recommendations SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=? AND student_user_id=? AND status='pending' AND EXISTS (
        SELECT 1 FROM practice_tasks t WHERE t.id=learning_recommendations.id AND t.tenant_id=learning_recommendations.tenant_id
        AND ${taskAvailableSql("t", "learning_recommendations")} AND (
          (t.target_kind='reading' AND EXISTS (SELECT 1 FROM practice_task_activities pa JOIN practice_records p ON p.id=pa.activity_id AND p.tenant_id=pa.tenant_id AND p.user_id=pa.user_id WHERE pa.task_id=t.id AND pa.tenant_id=t.tenant_id AND pa.user_id=learning_recommendations.student_user_id AND pa.activity_kind='reading' AND p.kind='reading'))
          OR (t.target_kind='writing' AND NOT EXISTS (SELECT 1 FROM json_each(t.snapshot_json,'$.characters') ch WHERE NOT EXISTS (SELECT 1 FROM practice_task_activities pa JOIN practice_records p ON p.id=pa.activity_id AND p.tenant_id=pa.tenant_id AND p.user_id=pa.user_id WHERE pa.task_id=t.id AND pa.tenant_id=t.tenant_id AND pa.user_id=learning_recommendations.student_user_id AND pa.activity_kind='writing' AND p.kind='writing' AND p.reference_id=ch.value)))
          OR (t.target_kind='dictation' AND EXISTS (SELECT 1 FROM practice_task_activities pa JOIN dictation_sessions d ON d.id=pa.activity_id AND d.tenant_id=pa.tenant_id AND d.user_id=pa.user_id WHERE pa.task_id=t.id AND pa.tenant_id=t.tenant_id AND pa.user_id=learning_recommendations.student_user_id AND pa.activity_kind='dictation' AND d.completed_at IS NOT NULL AND json_extract(d.state_json,'$.index')>=json_array_length(d.snapshot_json)))
          OR (t.target_kind='journey' AND EXISTS (SELECT 1 FROM practice_task_activities pa JOIN journey_runs j ON j.id=pa.activity_id AND j.tenant_id=pa.tenant_id AND j.user_id=pa.user_id WHERE pa.task_id=t.id AND pa.tenant_id=t.tenant_id AND pa.user_id=learning_recommendations.student_user_id AND pa.activity_kind='journey' AND j.stage=3))
        ))`).bind(taskId, context.tenantId, context.userId),
    auditStatement(context.db, context.tenantId, context.userId, "practice_task.completed", "learning_recommendation", taskId, {}, true),
  ];
}
