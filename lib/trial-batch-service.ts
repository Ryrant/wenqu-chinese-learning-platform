import { readFamilyFeedback } from "./family-feedback-service";
import type { FeedbackSnapshot } from "./family-feedback-types";
import { readFamilyPlan } from "./family-task";
import { readSequenceWorkspace } from "./learning-sequence-service";
import { evidenceStatus, sameRubric, type SequenceEvidence } from "./learning-sequence-types";
import type { PlatformContext } from "./platform-store";
import { batchPeriod, trialTimestamp, type BatchCatalog, type BatchClass, type BatchEvidence, type BatchFamilyTask, type BatchParticipant, type BatchReport, type BatchScope, type BatchSequence, type TrialBatch } from "./trial-batch-types";
import { readTrialEntries } from "./trial-service";

type BatchRow = { id: string; class_id: string; title: string; scope_json: string; request_json: string; revision: number; created_by: string; teacherName: string; created_at: string; voided_at: string | null; void_reason: string | null };
type ClassRow = { id: string; name: string; teacherId: string };
type SequenceRow = BatchSequence & { classId: string; baselineId: string };
type FamilyRow = BatchFamilyTask & { classId: string; planJson: string; detail: string; feedbackId?: string; feedbackSnapshot?: string };
type FamilyHistory = { feedbackId: string; id: string; studentId: string; assignmentId: string | null; classId: string; revision: number; feedbackSnapshot: string };
type Sources = { classroom: ClassRow; participants: BatchParticipant[]; sequences: SequenceRow[]; familyTasks: FamilyRow[]; catalog: BatchClass };
const own = (context: PlatformContext) => context.roles.includes("admin");
function staff(context: PlatformContext): PlatformContext {
  if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden");
  // 内部试用不能借用学生或监护人身份扩大读取范围。
  return { ...context, roles: own(context) ? ["admin"] : ["teacher"] };
}
async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sources(input: PlatformContext): Promise<Sources[]> {
  const context = staff(input); const { db, tenantId, userId } = context;
  const classrooms = (await db.prepare("SELECT id,name,teacher_user_id AS teacherId FROM classes WHERE tenant_id=? AND (?=1 OR teacher_user_id=?) ORDER BY name,id")
    .bind(tenantId, own(context) ? 1 : 0, userId).all<ClassRow>()).results;
  const classIds = JSON.stringify(classrooms.map((item) => item.id));
  const [people, groups, families, history, goals] = await Promise.all([
    db.prepare(`SELECT e.class_id AS classId,u.id,u.display_name AS name,e.status FROM enrollments e JOIN users u ON u.id=e.student_user_id
      WHERE e.tenant_id=? AND e.class_id IN (SELECT value FROM json_each(?)) ORDER BY u.id`).bind(tenantId, classIds).all<BatchParticipant & { classId: string }>(),
    db.prepare(`SELECT ls.id,ls.student_user_id AS studentId,ls.assignment_id AS assignmentId,ls.objective_id AS objectiveId,ls.title,ls.rubric_json AS rubricJson,ls.medium,ls.baseline_submission_id AS baselineId,a.class_id AS classId
      FROM learning_sequences ls JOIN assignments a ON a.id=ls.assignment_id AND a.tenant_id=ls.tenant_id
      WHERE ls.tenant_id=? AND a.class_id IN (SELECT value FROM json_each(?)) ORDER BY ls.id`).bind(tenantId, classIds).all<SequenceRow>(),
    db.prepare(`SELECT lr.id,lr.student_user_id AS studentId,lr.assignment_id AS assignmentId,lr.objective_id AS objectiveId,lr.title,lr.detail,lr.family_plan_json AS planJson,a.class_id AS classId
      FROM learning_recommendations lr JOIN assignments a ON a.id=lr.assignment_id AND a.tenant_id=lr.tenant_id
      WHERE lr.tenant_id=? AND lr.source_type='family' AND a.class_id IN (SELECT value FROM json_each(?)) ORDER BY lr.id`).bind(tenantId, classIds).all<Omit<FamilyRow, "revision" | "historical">>(),
    db.prepare(`SELECT id AS feedbackId,family_task_id AS id,student_user_id AS studentId,assignment_id AS assignmentId,class_id AS classId,task_revision AS revision,task_snapshot_json AS feedbackSnapshot
      FROM family_usability_feedback WHERE tenant_id=? AND class_id IN (SELECT value FROM json_each(?)) ORDER BY created_at,rowid`).bind(tenantId, classIds).all<FamilyHistory>(),
    db.prepare("SELECT id,title FROM learning_objectives WHERE tenant_id=? ORDER BY id").bind(tenantId).all<{ id: string; title: string }>(),
  ]);
  return Promise.all(classrooms.map(async (classroom) => {
    const participants = people.results.filter((person) => person.classId === classroom.id).map(({ id, name, status }) => ({ id, name, status }));
    const sequences = groups.results.filter((group) => group.classId === classroom.id);
    const candidates: FamilyRow[] = [...families.results.filter((task) => task.classId === classroom.id).map((task) => ({ ...task, revision: readFamilyPlan(task.planJson)?.revision ?? 0, historical: false })),
      ...history.results.filter((task) => task.classId === classroom.id).map((task) => { const snapshot = JSON.parse(task.feedbackSnapshot) as FeedbackSnapshot;
        return { ...task, title: snapshot.title, objectiveId: snapshot.objectiveId, detail: snapshot.detail, planJson: JSON.stringify(snapshot.plan), historical: true }; })];
    const keys = new Set<string>(); const familyTasks = candidates.filter((task) => { const key = JSON.stringify([task.id, task.revision]); if (keys.has(key)) return false; keys.add(key); return true; });
    const catalog: BatchClass = { id: classroom.id, name: classroom.name, participants, objectives: goals.results,
      sequences: sequences.map(({ id, studentId, assignmentId, objectiveId, title, rubricJson, medium }) => ({ id, studentId, assignmentId, objectiveId, title, rubricJson, medium })),
      familyTasks: familyTasks.map(({ id, studentId, assignmentId, objectiveId, title, revision, historical }) => ({ id, studentId, assignmentId, objectiveId, title, revision, historical })),
      version: await digest({ classroom, participants, sequences, familyTasks, goals: goals.results }) };
    return { classroom, participants, sequences, familyTasks, catalog };
  }));
}
const batchSelect = `SELECT b.*,u.display_name AS teacherName FROM learning_trial_batches b JOIN users u ON u.id=b.created_by
  LEFT JOIN classes c ON c.id=b.class_id AND c.tenant_id=b.tenant_id WHERE b.tenant_id=? AND (?=1 OR c.teacher_user_id=?)`;
async function batchRow(context: PlatformContext, id: string) {
  staff(context);
  const row = await context.db.prepare(`${batchSelect} AND b.id=?`).bind(context.tenantId, own(context) ? 1 : 0, context.userId, id).first<BatchRow>();
  if (!row) throw new Error("trial_batch_not_found"); return row;
}
function mapped(row: BatchRow, context: PlatformContext): TrialBatch {
  return { id: row.id, title: row.title, scope: JSON.parse(row.scope_json) as BatchScope, revision: row.revision, teacherName: row.teacherName, createdAt: row.created_at,
    voidedAt: row.voided_at, voidReason: row.void_reason, canVoid: !row.voided_at && (own(context) || row.created_by === context.userId) };
}
export async function readBatchCatalog(context: PlatformContext): Promise<BatchCatalog> {
  staff(context);
  const [catalog, batches] = await Promise.all([sources(context), context.db.prepare(`${batchSelect} ORDER BY b.created_at DESC,b.rowid DESC`)
    .bind(context.tenantId, own(context) ? 1 : 0, context.userId).all<BatchRow>()]);
  return { classes: catalog.map((item) => item.catalog), batches: batches.results.map((row) => mapped(row, context)), generatedAt: new Date().toISOString() };
}
function text(value: unknown, key: string, limit = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`invalid_trial_batch_${key}`); return value.trim();
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("invalid_trial_batch_selection");
  return [...new Set(value.map((id) => text(id, "selection")))].sort();
}
function familyTargets(value: unknown): Array<{ id: string; revision: number }> {
  if (!Array.isArray(value)) throw new Error("invalid_trial_batch_selection");
  const result = value.map((target) => {
    if (!target || typeof target !== "object" || !Number.isInteger(target.revision) || target.revision < 0) throw new Error("invalid_trial_batch_selection");
    return { id: text(target.id, "selection"), revision: target.revision as number };
  }).sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision);
  if (new Set(result.map((target) => JSON.stringify(target))).size !== result.length) throw new Error("invalid_trial_batch_selection"); return result;
}
function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("invalid_trial_batch_period"); return value;
}
async function selection(context: PlatformContext, scope: Pick<BatchScope, "classId" | "objectiveId" | "participants">, version: unknown, sequenceIds: string[], targets: Array<{ id: string; revision: number }>) {
  const source = (await sources(context)).find((item) => item.classroom.id === scope.classId);
  if (!source) throw new Error("forbidden");
  if (source.catalog.version !== version) throw new Error("trial_batch_scope_changed");
  const participants = new Set(scope.participants.map((person) => person.id));
  const sequences = source.catalog.sequences.filter((group) => sequenceIds.includes(group.id));
  const familyTasks = source.catalog.familyTasks.filter((task) => targets.some((target) => target.id === task.id && target.revision === task.revision));
  if (sequences.length !== sequenceIds.length || familyTasks.length !== targets.length
    || [...sequences, ...familyTasks].some((item) => !participants.has(item.studentId) || item.objectiveId !== scope.objectiveId)) throw new Error("invalid_trial_batch_selection");
  return { source, sequences, familyTasks };
}
// 同一次原子写入重新核对来源与权限，防止名单、任务或教师在读取后被换掉。
function sourceGuard(context: PlatformContext, source: Sources, scope: BatchScope, groupIds: string[], targets: Array<{ id: string; revision: number }>, checkParticipants: boolean) {
  const sql = `EXISTS (SELECT 1 FROM classes c JOIN learning_objectives lo ON lo.tenant_id=c.tenant_id AND lo.id=?
    WHERE c.id=? AND c.tenant_id=? AND c.name=? AND c.teacher_user_id=? AND lo.title=? AND (?=1 OR c.teacher_user_id=?))
    AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM enrollments e JOIN users u ON u.id=e.student_user_id
      WHERE e.tenant_id=? AND e.class_id=? AND u.id=json_extract(j.value,'$.id') AND u.display_name=json_extract(j.value,'$.name') AND e.status=json_extract(j.value,'$.status')))
    AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM learning_sequences ls JOIN assignments a ON a.id=ls.assignment_id AND a.tenant_id=ls.tenant_id
      WHERE ls.tenant_id=? AND a.class_id=? AND ls.id=json_extract(j.value,'$.id') AND ls.student_user_id=json_extract(j.value,'$.studentId') AND ls.assignment_id=json_extract(j.value,'$.assignmentId')
      AND ls.objective_id=json_extract(j.value,'$.objectiveId') AND ls.title=json_extract(j.value,'$.title') AND ls.rubric_json=json_extract(j.value,'$.rubricJson') AND ls.medium=json_extract(j.value,'$.medium') AND ls.baseline_submission_id=json_extract(j.value,'$.baselineId')))
    AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT (
      (json_extract(j.value,'$.historical')=1 AND EXISTS (SELECT 1 FROM family_usability_feedback f WHERE f.id=json_extract(j.value,'$.feedbackId') AND f.tenant_id=? AND f.class_id=?
        AND f.family_task_id=json_extract(j.value,'$.id') AND f.student_user_id=json_extract(j.value,'$.studentId') AND f.task_revision=json_extract(j.value,'$.revision') AND f.task_snapshot_json=json_extract(j.value,'$.feedbackSnapshot')))
      OR (json_extract(j.value,'$.historical')=0 AND EXISTS (SELECT 1 FROM learning_recommendations lr JOIN assignments a ON a.id=lr.assignment_id AND a.tenant_id=lr.tenant_id
        WHERE lr.tenant_id=? AND a.class_id=? AND lr.source_type='family' AND lr.id=json_extract(j.value,'$.id') AND lr.student_user_id=json_extract(j.value,'$.studentId')
        AND lr.assignment_id=json_extract(j.value,'$.assignmentId') AND lr.objective_id IS json_extract(j.value,'$.objectiveId') AND lr.title=json_extract(j.value,'$.title') AND lr.detail=json_extract(j.value,'$.detail') AND lr.family_plan_json=json_extract(j.value,'$.planJson'))))) `;
  return { sql, args: [scope.objectiveId, scope.classId, context.tenantId, source.classroom.name, source.classroom.teacherId, scope.objectiveTitle, own(context) ? 1 : 0, context.userId,
    JSON.stringify(checkParticipants ? scope.participants : []), context.tenantId, scope.classId, JSON.stringify(source.sequences.filter((group) => groupIds.includes(group.id))), context.tenantId, scope.classId,
    JSON.stringify(source.familyTasks.filter((task) => targets.some((target) => target.id === task.id && target.revision === task.revision))), context.tenantId, scope.classId, context.tenantId, scope.classId] };
}
export async function createTrialBatch(context: PlatformContext, body: Record<string, unknown>) {
  staff(context);
  const id = text(body.id, "id"); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("invalid_trial_batch_id");
  const title = text(body.title, "title"); const classId = text(body.classId, "class"); const objectiveId = text(body.objectiveId, "objective");
  const participantIds = ids(body.participantIds); if (!participantIds.length) throw new Error("invalid_trial_batch_participants");
  const sequenceIds = ids(body.sequenceIds); const targets = familyTargets(body.familyTasks);
  const startDate = date(body.startDate); const endDate = date(body.endDate); if (startDate > endDate) throw new Error("invalid_trial_batch_period");
  const workScope = text(body.workScope, "work_scope", 2000);
  const request = JSON.stringify({ title, classId, objectiveId, participantIds, sequenceIds, targets, startDate, endDate, workScope, catalogVersion: body.catalogVersion });
  const existing = await context.db.prepare("SELECT id FROM learning_trial_batches WHERE id=? AND tenant_id=?").bind(id, context.tenantId).first();
  const recover = async () => {
    const row = await batchRow(context, id);
    if (row.created_by !== context.userId || row.request_json !== request) throw new Error("trial_batch_id_conflict");
    if (row.voided_at) throw new Error("trial_batch_already_voided"); return { id, revision: row.revision };
  };
  if (existing) return recover();
  const scope: BatchScope = { version: 1, classId, className: "", objectiveId, objectiveTitle: "", startDate, endDate, workScope, participants: participantIds.map((id) => ({ id, name: "", status: "" })), sequences: [], familyTasks: [] };
  const selected = await selection(context, scope, body.catalogVersion, sequenceIds, targets);
  const goal = selected.source.catalog.objectives.find((goal) => goal.id === objectiveId); if (!goal) throw new Error("invalid_trial_batch_objective");
  scope.className = selected.source.classroom.name; scope.objectiveTitle = goal.title;
  scope.participants = selected.source.participants.filter((person) => participantIds.includes(person.id));
  if (scope.participants.length !== participantIds.length) throw new Error("invalid_trial_batch_participants");
  scope.sequences = selected.sequences; scope.familyTasks = selected.familyTasks;
  const guard = sourceGuard(context, selected.source, scope, sequenceIds, targets, true);
  try { await context.db.batch([
    context.db.prepare(`INSERT INTO learning_trial_batches (id,tenant_id,class_id,title,scope_json,request_json,created_by) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`)
      .bind(id, context.tenantId, classId, title, JSON.stringify(scope), request, context.userId, ...guard.args),
    context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,'trial_batch.created','trial_batch',?,? WHERE changes()>0")
      .bind(crypto.randomUUID(), context.tenantId, context.userId, id, JSON.stringify({ participants: participantIds.length, sequenceIds, familyTasks: targets })),
  ]); } catch (error) {
    const concurrent = await context.db.prepare("SELECT id FROM learning_trial_batches WHERE id=? AND tenant_id=?").bind(id, context.tenantId).first();
    if (concurrent) return recover();
    if (error instanceof Error && error.message.includes("learning_trial_batches.id")) throw new Error("trial_batch_id_conflict"); throw error;
  }
  if (!await context.db.prepare("SELECT id FROM learning_trial_batches WHERE id=? AND tenant_id=?").bind(id, context.tenantId).first()) throw new Error("trial_batch_scope_changed");
  return recover();
}
export async function linkTrialBatch(context: PlatformContext, body: Record<string, unknown>) {
  const id = text(body.id, "id"); const row = await batchRow(context, id); if (row.voided_at) throw new Error("trial_batch_already_voided");
  const scope = JSON.parse(row.scope_json) as BatchScope; const sequenceIds = ids(body.sequenceIds); const targets = familyTargets(body.familyTasks);
  if (!sequenceIds.length && !targets.length) throw new Error("invalid_trial_batch_selection");
  const linked = (value: BatchScope) => sequenceIds.every((id) => value.sequences.some((group) => group.id === id)) && targets.every((target) => value.familyTasks.some((task) => task.id === target.id && task.revision === target.revision));
  if (linked(scope)) return { id, revision: row.revision };
  if (body.revision !== row.revision) throw new Error("trial_batch_changed");
  const pendingIds = sequenceIds.filter((id) => !scope.sequences.some((group) => group.id === id));
  const pendingTargets = targets.filter((target) => !scope.familyTasks.some((task) => task.id === target.id && task.revision === target.revision));
  const selected = await selection(context, scope, body.catalogVersion, pendingIds, pendingTargets);
  scope.sequences.push(...selected.sequences.filter((group) => !scope.sequences.some((old) => old.id === group.id)));
  scope.familyTasks.push(...selected.familyTasks.filter((task) => !scope.familyTasks.some((old) => old.id === task.id && old.revision === task.revision)));
  const guard = sourceGuard(context, selected.source, { ...scope, objectiveTitle: selected.source.catalog.objectives.find((goal) => goal.id === scope.objectiveId)?.title ?? "" }, pendingIds, pendingTargets, false);
  await context.db.batch([
    context.db.prepare(`UPDATE learning_trial_batches SET scope_json=?,revision=revision+1 WHERE id=? AND tenant_id=? AND revision=? AND voided_at IS NULL AND ${guard.sql}`)
      .bind(JSON.stringify(scope), id, context.tenantId, row.revision, ...guard.args),
    context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,'trial_batch.linked','trial_batch',?,? WHERE changes()>0")
      .bind(crypto.randomUUID(), context.tenantId, context.userId, id, JSON.stringify({ sequenceIds, familyTasks: targets })),
  ]);
  const latest = await batchRow(context, id); if (!linked(JSON.parse(latest.scope_json))) throw new Error("trial_batch_changed");
  if (latest.voided_at) throw new Error("trial_batch_already_voided"); return { id, revision: latest.revision };
}
export async function voidTrialBatch(context: PlatformContext, body: Record<string, unknown>) {
  const id = text(body.id, "id"); const row = await batchRow(context, id); const reason = text(body.reason, "reason", 1000);
  if (!own(context) && row.created_by !== context.userId) throw new Error("forbidden");
  await context.db.batch([
    context.db.prepare(`UPDATE learning_trial_batches SET voided_at=CURRENT_TIMESTAMP,voided_by=?,void_reason=? WHERE id=? AND tenant_id=? AND voided_at IS NULL
      AND (?=1 OR EXISTS (SELECT 1 FROM classes c WHERE c.id=learning_trial_batches.class_id AND c.tenant_id=learning_trial_batches.tenant_id AND c.teacher_user_id=?))`).bind(context.userId, reason, id, context.tenantId, own(context) ? 1 : 0, context.userId),
    context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,'trial_batch.voided','trial_batch',?,? WHERE changes()>0")
      .bind(crypto.randomUUID(), context.tenantId, context.userId, id, JSON.stringify({ reason })),
  ]);
  const latest = await batchRow(context, id); if (!latest.voided_at || latest.void_reason !== reason) throw new Error("trial_batch_already_voided"); return { id, revision: latest.revision };
}
export async function readTrialBatch(input: PlatformContext, id: string): Promise<BatchReport> {
  const context = staff(input); const row = await batchRow(context, id); const batch = mapped(row, context); const { scope } = batch;
  const catalog = (await sources(context)).find((item) => item.classroom.id === scope.classId);
  const eligible = scope.sequences.filter((group) => catalog?.catalog.sequences.some((current) => JSON.stringify(current) === JSON.stringify(group)));
  const [sequences, entries, feedback] = await Promise.all([
    readSequenceWorkspace(context.db, context, null, undefined, eligible.map((group) => group.id)),
    readTrialEntries(context.db, context), readFamilyFeedback(context, "teaching"),
  ]);
  const period = batchPeriod(scope); const until = Math.min(period.end, Date.now());
  const inPeriod = (value: string) => trialTimestamp(value) >= period.start && trialTimestamp(value) < until;
  const bounded = (work: SequenceEvidence) => {
    const reviewed = work.reviewed && !!work.reviewedAt && trialTimestamp(work.reviewedAt) < until;
    return { ...work, reviewed, ...(reviewed ? {} : { objectives: [], dimensions: [], score: null, helpLevel: "unknown" as const, promptCount: null, contextConfirmed: false }) };
  };
  const participants = scope.participants.map((person) => ({ ...person, currentStatus: catalog?.participants.find((current) => current.id === person.id)?.status ?? null,
    groups: scope.sequences.filter((group) => group.studentId === person.id).map((source) => {
      const sequence = sequences.learningSequences.find((group) => group.id === source.id);
      const base = { source, available: !!sequence, baseline: null, practice: [], transfer: [], retest: [], transferStatus: "原关联任务组已变更或不可读取，证据未纳入", retestStatus: "原关联任务组已变更或不可读取，证据未纳入", retestAvailableAt: null };
      if (!sequence) return base;
      const evidence = (value: SequenceEvidence): BatchEvidence => {
        const work = bounded(value); return { id: work.id, title: work.title, submittedAt: work.submittedAt, reviewed: work.reviewed, reviewedAt: work.reviewedAt,
          goalScore: work.reviewed ? work.objectives.find((goal) => goal.id === scope.objectiveId)?.score ?? null : null,
          helpLevel: work.helpLevel, promptCount: work.promptCount, contextConfirmed: work.contextConfirmed, inPeriod: inPeriod(work.submittedAt), rubricMatched: sameRubric(work.rubric, sequence.rubric) };
      };
      const practice = sequence.practice.filter((work) => inPeriod(work.submittedAt)); const transfer = sequence.transfer.filter((work) => inPeriod(work.submittedAt)); const retest = sequence.retest.filter((work) => inPeriod(work.submittedAt));
      return { source, available: true, baseline: evidence(sequence.baseline), practice: practice.map(evidence), transfer: transfer.map(evidence), retest: retest.map(evidence),
        transferStatus: evidenceStatus(transfer[0] ? bounded(transfer[0]) : undefined, scope.objectiveId, "迁移"), retestStatus: evidenceStatus(retest[0] ? bounded(retest[0]) : undefined, scope.objectiveId, "复测"), retestAvailableAt: sequence.retestAvailableAt };
    }) }));
  return { batch, participants, entries: entries.filter((entry) => eligible.some((group) => group.id === entry.sequenceId) && inPeriod(entry.createdAt)),
    feedback: feedback.entries.filter((entry) => entry.classId === scope.classId && scope.participants.some((person) => person.id === entry.studentId)
      && entry.snapshot.objectiveId === scope.objectiveId && scope.familyTasks.some((task) => task.id === entry.taskId && task.revision === entry.revision && task.studentId === entry.studentId) && inPeriod(entry.createdAt))
      .map((entry) => ({ ...entry, responses: entry.responses.filter((response) => inPeriod(response.createdAt)) })),
    workloadScope: own(context) ? "institution" : "self", generatedAt: new Date().toISOString() };
}
