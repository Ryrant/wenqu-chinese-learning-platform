import { classAccessClause, studentAccessClause, submissionAccessClause } from "./access-control";
import type { ChoiceSnapshot, WorkDiagnosticSnapshot } from "./diagnostic-types";
import { readFamilyFeedback } from "./family-feedback-service";
import { readFamilyPlan, readFamilyWorkSnapshot } from "./family-task";
import { readSequenceWorkspace } from "./learning-sequence-service";
import { jsonValue, readSequenceWork, SEQUENCE_STAGE_LABELS } from "./learning-sequence-types";
import type { PlatformContext } from "./platform-store";
import { caseTimestamp, type CaseEvent, type CaseGoal, type CaseTask, type CaseView, type StudentCaseData } from "./student-case-types";
import { readWorkRows, workEvidence, type WorkRow } from "./work-evidence-service";
import { readLearningAnalyticsState } from "./learning-analytics";

function caseContext(context: PlatformContext, view: CaseView): PlatformContext {
  // 当前查看身份不能借用另一个角色的授权范围。
  const role = view === "teaching" ? context.roles.includes("admin") ? "admin" : "teacher" : view;
  if (!context.roles.includes(role)) throw new Error("forbidden");
  return { ...context, roles: [role] };
}
function workGoals(row: WorkRow): CaseGoal[] {
  const family = readFamilyWorkSnapshot(row.family_snapshot_json);
  const sequence = readSequenceWork(row.sequence_snapshot_json); const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(row.diagnostic_snapshot_json, {});
  // 普通旧作品不能从当前作业关联反推原目标；具体目标评分本身仍是可追溯的评价证据。
  const goals = sequence ? [{ id: sequence.objectiveId, title: sequence.objectiveTitle }] : family ? [{ id: family.objectiveId, title: family.objectiveTitle }]
    : diagnostic.version === 1 ? diagnostic.objectives ?? [] : [];
  return [...new Map([...goals, ...workEvidence(row).objectives].map((goal) => [goal.id, { id: goal.id, title: goal.title }])).values()];
}
export async function readStudentCase(original: PlatformContext, view: CaseView, requestedId?: string): Promise<StudentCaseData> {
  const context = caseContext(original, view); const { db, tenantId, userId } = context;
  const studentAccess = studentAccessClause(context, "u.id", "rm.tenant_id"); const workAccess = submissionAccessClause(context);
  const feedbackAccess = view === "teaching" ? "(?=1 OR c.teacher_user_id=?)" : "1=0";
  const students = (await db.prepare(`SELECT DISTINCT u.id AS id,u.display_name AS displayName FROM users u
    JOIN role_memberships rm ON rm.user_id=u.id AND rm.tenant_id=? AND rm.role='student' AND rm.status='active'
    WHERE u.status='active' AND ${studentAccess.sql}
    UNION SELECT DISTINCT u.id AS id,u.display_name AS displayName FROM submissions s
      JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      JOIN users u ON u.id=s.student_user_id WHERE s.tenant_id=? AND ${workAccess.sql}
    UNION SELECT DISTINCT u.id AS id,u.display_name AS displayName FROM family_usability_feedback f JOIN users u ON u.id=f.student_user_id
      LEFT JOIN classes c ON c.id=f.class_id AND c.tenant_id=f.tenant_id WHERE f.tenant_id=? AND ${feedbackAccess}
    ORDER BY displayName,id`).bind(tenantId, ...studentAccess.args, tenantId, ...workAccess.args, tenantId,
      ...(view === "teaching" ? [context.roles.includes("admin") ? 1 : 0, userId] : [])).all<{ id: string; displayName: string }>()).results;
  const student = students.find((item) => item.id === (requestedId ?? (view === "student" ? userId : students[0]?.id))) ?? null;
  if (requestedId !== undefined && !student) throw new Error("student_case_not_found");
  if (!student) return { students, student, objectives: [], events: [], tasks: [], legacyChoiceCount: 0, generatedAt: new Date().toISOString() };
  const analytics = await readLearningAnalyticsState(db, tenantId, student.id);
  if (!analytics.available) return { students, student, objectives: [], events: [], tasks: [], legacyChoiceCount: 0, generatedAt: new Date().toISOString(), ...analytics };
  const classAccess = classAccessClause(context);
  const taskAccess = view === "teaching" && !context.roles.includes("admin") ? "((lr.source_type='family' AND c.teacher_user_id=?) OR (lr.source_type='teacher' AND lr.created_by=?))" : "1=1";
  const [works, metadata, taskRows, currentGoals, eligible] = await Promise.all([
    readWorkRows(db, context, "s.student_user_id=? AND COALESCE(json_extract(s.diagnostic_snapshot_json,'$.analyticsAllowed'),1)=1 AND COALESCE(json_extract(sr.evidence_json,'$.analyticsAllowed'),1)=1", [student.id]),
    db.prepare(`SELECT ls.id,ls.created_at FROM learning_sequences ls JOIN submissions s ON s.id=ls.baseline_submission_id AND s.tenant_id=ls.tenant_id
      AND s.student_user_id=ls.student_user_id AND s.assignment_id=ls.assignment_id
      JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      WHERE ls.tenant_id=? AND ls.student_user_id=? AND ${workAccess.sql} ORDER BY ls.created_at,ls.rowid`)
      .bind(tenantId, student.id, ...workAccess.args).all<{ id: string; created_at: string }>(),
    db.prepare(`SELECT lr.*,lo.title AS goalTitle,u.display_name AS authorName FROM learning_recommendations lr JOIN users u ON u.id=lr.created_by
      LEFT JOIN learning_objectives lo ON lo.id=lr.objective_id AND lo.tenant_id=lr.tenant_id
      LEFT JOIN assignments a ON a.id=lr.assignment_id AND a.tenant_id=lr.tenant_id LEFT JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      WHERE lr.tenant_id=? AND lr.student_user_id=? AND lr.source_type IN ('teacher','family') AND ${taskAccess} ORDER BY lr.created_at,lr.rowid`)
      .bind(tenantId, student.id, ...(view === "teaching" && !context.roles.includes("admin") ? [userId, userId] : []))
      .all<{ id: string; source_type: "teacher" | "family"; title: string; detail: string; objective_id: string | null; goalTitle: string | null; status: string; family_plan_json: string; updated_at: string | null; created_at: string; authorName: string }>(),
    db.prepare(`SELECT DISTINCT lo.id,lo.title FROM learning_objectives lo JOIN assignment_objectives ao ON ao.objective_id=lo.id AND ao.tenant_id=lo.tenant_id
      JOIN assignments a ON a.id=ao.assignment_id AND a.tenant_id=ao.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      JOIN enrollments e ON e.class_id=c.id AND e.tenant_id=c.tenant_id AND e.student_user_id=? AND e.status='active'
      WHERE lo.tenant_id=? AND a.status='published' AND ${classAccess.sql}`).bind(student.id, tenantId, ...classAccess.args).all<CaseGoal>(),
    db.prepare(`SELECT u.id FROM users u JOIN role_memberships rm ON rm.user_id=u.id AND rm.tenant_id=? AND rm.role='student' AND rm.status='active'
      WHERE u.id=? AND u.status='active' AND ${studentAccess.sql}`).bind(tenantId, student.id, ...studentAccess.args).first(),
  ]);
  const sequenceIds = metadata.results.map((row) => row.id);
  const [sequenceData, feedbackData, answers, retestRecords] = await Promise.all([
    readSequenceWorkspace(db, context, student.id, undefined, sequenceIds),
    view === "student" ? Promise.resolve({ entries: [] }) : readFamilyFeedback(context, view === "guardian" ? "guardian" : "teaching", view === "guardian" ? student.id : undefined),
    eligible ? db.prepare(`SELECT da.id,da.evidence_json,da.selected_option,da.is_correct,dt.id AS attemptId,dt.completed_at FROM diagnostic_answers da
      JOIN diagnostic_attempts dt ON dt.id=da.attempt_id AND dt.tenant_id=da.tenant_id
      WHERE da.tenant_id=? AND dt.student_user_id=? AND COALESCE(json_extract(da.evidence_json,'$.analyticsAllowed'),1)=1 ORDER BY dt.completed_at,dt.rowid,da.rowid`).bind(tenantId, student.id)
      .all<{ id: string; evidence_json: string; selected_option: number; is_correct: number; attemptId: string; completed_at: string }>() : Promise.resolve({ results: [] }),
    db.prepare(`SELECT target_id,created_at FROM audit_logs WHERE tenant_id=? AND action='learning_sequence.retest_scheduled'
      AND target_id IN (SELECT value FROM json_each(?)) ORDER BY created_at,rowid`).bind(tenantId, JSON.stringify(sequenceIds)).all<{ target_id: string; created_at: string }>(),
  ]);
  const sequences = sequenceData.learningSequences;
  const events: CaseEvent[] = []; let legacyChoiceCount = 0;
  for (const row of answers.results) {
    const snapshot = jsonValue<Partial<ChoiceSnapshot>>(row.evidence_json, {});
    if (snapshot.version !== 1 || !snapshot.objectiveId || !Array.isArray(snapshot.options)) { legacyChoiceCount++; continue; }
    events.push({ id: `choice:${row.id}`, at: row.completed_at, goals: [{ id: snapshot.objectiveId, title: snapshot.objectiveTitle || snapshot.objectiveId }], kind: "choice", snapshot: snapshot as ChoiceSnapshot,
      selected: row.selected_option, correct: row.is_correct === 1, attemptId: row.attemptId });
  }
  for (const row of works) {
    const work = workEvidence(row); const stage = readSequenceWork(row.sequence_snapshot_json)?.stage;
    const item = { goals: workGoals(row), work, stage: stage ? SEQUENCE_STAGE_LABELS[stage] : row.family_task_id ? "家庭交流作品" : "初次或普通作品", className: row.className,
      family: readFamilyWorkSnapshot(row.family_snapshot_json), confirmedAt: row.family_confirmed_at, confirmedBy: row.familyConfirmedName, confirmationRole: row.family_confirmation_role,
      sequenceIds: sequences.filter((sequence) => sequence.baseline.id === row.id || sequence.id === row.sequence_id).map((sequence) => sequence.id) };
    events.push({ ...item, id: `work:${row.id}`, kind: "work", at: row.created_at });
    if (work.reviewed && work.reviewedAt) events.push({ ...item, id: `review:${row.id}`, kind: "review", at: work.reviewedAt });
  }
  for (const sequence of sequences) {
    const goals = [{ id: sequence.objectiveId, title: sequence.objectiveTitle }];
    events.push({ id: `sequence:${sequence.id}`, kind: "sequence", at: metadata.results.find((row) => row.id === sequence.id)!.created_at, goals,
      sequenceId: sequence.id, title: sequence.title, practice: sequence.practicePrompt, transfer: sequence.transferPrompt, context: sequence.transferContext, baselineId: sequence.baseline.id });
    for (const decision of sequence.decisions) events.push({ id: `decision:${decision.id}`, kind: "decision", at: decision.createdAt, goals, sequenceId: sequence.id, decision });
    const record = retestRecords.results.find((row) => row.target_id === sequence.id);
    if (record && sequence.retestAvailableAt) events.push({ id: `retest:${sequence.id}`, kind: "retest", at: record.created_at, goals, sequenceId: sequence.id,
      prompt: sequence.retestPrompt, context: sequence.retestContext, availableAt: sequence.retestAvailableAt, referenceId: sequence.retestReferenceId });
  }
  for (const entry of feedbackData.entries.filter((item) => item.studentId === student.id)) {
    const goals = entry.snapshot.objectiveId ? [{ id: entry.snapshot.objectiveId, title: entry.snapshot.objectiveTitle || entry.snapshot.objectiveId }] : [];
    events.push({ id: `feedback:${entry.id}`, kind: "feedback", at: entry.createdAt, goals, entry: { ...entry, responses: [], canVoid: false, canRespond: false } });
    if (entry.voidedAt) events.push({ id: `void-feedback:${entry.id}`, kind: "withdrawal", at: entry.voidedAt, goals, sourceId: entry.id, sourceKind: "feedback", reason: entry.voidReason ?? "" });
    for (const response of entry.responses) {
      events.push({ id: `support:${response.id}`, kind: "support", at: response.createdAt, goals, response: { ...response, canVoid: false }, feedbackId: entry.id, taskTitle: entry.snapshot.title, revision: entry.revision, originalNote: entry.note });
      if (response.voidedAt) events.push({ id: `void-support:${response.id}`, kind: "withdrawal", at: response.voidedAt, goals, sourceId: response.id, sourceKind: "support", reason: response.voidReason ?? "" });
    }
  }
  const tasks: CaseTask[] = taskRows.results.map((row) => ({ id: row.id, kind: row.source_type, title: row.title, detail: row.detail,
    goal: row.objective_id ? { id: row.objective_id, title: row.goalTitle ?? row.objective_id } : null, status: row.status,
    revision: row.source_type === "family" ? readFamilyPlan(row.family_plan_json)?.revision ?? null : null, updatedAt: row.updated_at ?? row.created_at, authorName: row.authorName }));
  const objectives = [...new Map([...events.flatMap((item) => item.goals), ...tasks.flatMap((item) => item.goal ? [item.goal] : []), ...currentGoals.results].map((goal) => [goal.id, goal])).values()];
  events.sort((a, b) => caseTimestamp(a.at) - caseTimestamp(b.at) || a.id.localeCompare(b.id));
  return { students, student, objectives, events, tasks, legacyChoiceCount, generatedAt: new Date().toISOString(), ...analytics };
}
