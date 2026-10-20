import type { WorkDiagnosticSnapshot } from "./diagnostic-types";
import { readFamilyWorkSnapshot } from "./family-task";
import { readSequenceWorkspace } from "./learning-sequence-service";
import { evidenceStatus, jsonValue, nextSequenceStage, readReviewEvidence, readSequenceWork } from "./learning-sequence-types";
import type { PlatformContext } from "./platform-store";
import type { FollowupGoal, TeachingFollowup, TeachingFollowupData } from "./teaching-followup-types";
import { readWorkRows, workEvidence, type WorkRow } from "./work-evidence-service";

function workGoals(row: WorkRow): { goals: FollowupGoal[]; current: boolean } {
  const review = readReviewEvidence(row.evidenceJson);
  const task = readSequenceWork(row.sequence_snapshot_json);
  const family = readFamilyWorkSnapshot(row.family_snapshot_json);
  const diagnostic = jsonValue<Partial<WorkDiagnosticSnapshot>>(row.diagnostic_snapshot_json, {});
  const frozen = review?.objectives ?? (task ? [{ id: task.objectiveId, title: task.objectiveTitle }] : family ? [{ id: family.objectiveId, title: family.objectiveTitle }] : diagnostic.version === 1 ? diagnostic.objectives : undefined);
  return { goals: frozen ?? jsonValue(row.objectiveTitlesJson, []), current: !frozen };
}

function hasOriginalTask(row: WorkRow) {
  return !!(readSequenceWork(row.sequence_snapshot_json) || readFamilyWorkSnapshot(row.family_snapshot_json)
    || jsonValue<Partial<WorkDiagnosticSnapshot>>(row.diagnostic_snapshot_json, {}).version === 1);
}

function reference(row: WorkRow) {
  const work = workEvidence(row);
  return hasOriginalTask(row) ? work : { ...work, title: "作品（提交时的任务要求未留存）", prompt: "" };
}

export async function readTeachingFollowups(context: PlatformContext): Promise<TeachingFollowupData> {
  if (!context.roles.some((role) => role === "teacher" || role === "admin")) throw new Error("forbidden");
  // 复合角色的监护权限只允许回看孩子；教师待办始终按原作业班级授权。
  const teaching: PlatformContext = { ...context, roles: context.roles.includes("admin") ? ["admin"] : ["teacher"] };
  const { db, tenantId } = teaching;
  const owner = teaching.roles.includes("admin") ? 1 : 0;
  const [classResult, rosterResult, assignmentResult, goalResult, rows, sequences] = await Promise.all([
    db.prepare("SELECT id,name FROM classes WHERE tenant_id=? AND (?=1 OR teacher_user_id=?) ORDER BY name,id")
      .bind(tenantId, owner, teaching.userId).all<{ id: string; name: string }>(),
    db.prepare(`SELECT DISTINCT e.class_id AS classId,u.id,u.display_name AS name FROM enrollments e
      JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id JOIN users u ON u.id=e.student_user_id AND u.status='active'
      JOIN role_memberships rm ON rm.tenant_id=e.tenant_id AND rm.user_id=u.id AND rm.role='student' AND rm.status='active'
      WHERE e.tenant_id=? AND e.status='active' AND (?=1 OR c.teacher_user_id=?) ORDER BY u.display_name,u.id`)
      .bind(tenantId, owner, teaching.userId).all<{ classId: string; id: string; name: string }>(),
    db.prepare(`SELECT a.id,a.title,a.status,a.class_id AS classId,c.name AS className FROM assignments a
      JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND (?=1 OR c.teacher_user_id=?) ORDER BY a.created_at DESC,a.rowid DESC`)
      .bind(tenantId, owner, teaching.userId).all<{ id: string; title: string; status: string; classId: string; className: string }>(),
    db.prepare(`SELECT lo.id,lo.title,ao.assignment_id AS assignmentId FROM learning_objectives lo
      LEFT JOIN assignment_objectives ao ON ao.tenant_id=lo.tenant_id AND ao.objective_id=lo.id
      WHERE lo.tenant_id=? AND lo.status='active'`).bind(tenantId).all<FollowupGoal & { assignmentId: string | null }>(),
    readWorkRows(db, teaching, "1=1"), readSequenceWorkspace(db, teaching, null),
  ]);
  const assignments = new Map(assignmentResult.results.map((item) => [item.id, item]));
  const activeGoals = new Set(goalResult.results.map((item) => item.id));
  const roster = new Set(rosterResult.results.map((item) => JSON.stringify([item.classId, item.id])));
  const activeSequences = sequences.learningSequences.filter((sequence) => {
    const assignment = assignments.get(sequence.assignmentId);
    return assignment?.status === "published" && activeGoals.has(sequence.objectiveId) && roster.has(JSON.stringify([assignment.classId, sequence.studentUserId]));
  });
  const items: TeachingFollowup[] = [];
  for (const row of rows.filter((item) => item.review_status !== "reviewed")) {
    const confirmation = !!row.family_task_id && !row.family_confirmed_at;
    const association = workGoals(row);
    items.push({ id: `work:${row.id}`, kind: confirmation ? "confirmation" : "review", classId: row.classId, className: row.className,
      studentId: row.student_user_id, studentName: row.studentName, goals: association.goals,
      title: hasOriginalTask(row) ? reference(row).title : `${row.assignmentTitle}（当前任务名）`,
      time: row.created_at, work: reference(row), action: { kind: "review", submissionId: row.id },
      detail: `${confirmation ? "交流尚未确认，确认后才能评价语言表现。" : "作品已提交，等待教师按目标与量规评价。"}${association.current ? "目标按当前作业关联展示，提交时的目标关联未留存。" : ""}` });
  }
  // 一个学生在一个原班级、同一目标下已有任务组时，直接跟进阶段，不另造重复的迁移安排。
  for (const member of rosterResult.results) {
    const goals = new Map(goalResult.results.flatMap((goal) => {
      const assignment = goal.assignmentId ? assignments.get(goal.assignmentId) : undefined;
      return assignment?.status === "published" && assignment.classId === member.classId ? [[goal.id, { goal, assignment }] as const] : [];
    }));
    for (const { goal, assignment } of goals.values()) {
      if (activeSequences.some((sequence) => sequence.studentUserId === member.id && sequence.objectiveId === goal.id && assignments.get(sequence.assignmentId)?.classId === member.classId)) continue;
      const matching = rows.filter((row) => row.classId === member.classId && row.student_user_id === member.id && workGoals(row).goals.some((item) => item.id === goal.id));
      if (matching.some((row) => row.review_status !== "reviewed")) continue;
      const latest = matching[0];
      const source = latest && sequences.sequenceSources.find((item) => item.work.id === latest.id && item.work.objectives.some((item) => item.id === goal.id));
      items.push({ id: `goal:${member.classId}:${member.id}:${goal.id}`, kind: source ? "transfer_setup" : "initial",
        classId: member.classId, className: assignment.className, studentId: member.id, studentName: member.name,
        goals: [{ id: goal.id, title: goal.title }], title: source ? "从已评价作品安排练习与迁移" : assignment.title,
        time: latest?.reviewed_at ?? null, work: latest ? reference(latest) : null,
        detail: source ? "已有该目标的教师评价，尚未关联练习与迁移任务；是否安排由教师判断。"
          : !latest ? "当前已发布目标尚无学生作品，先收集初次证据。"
          : !workEvidence(latest).objectives.some((item) => item.id === goal.id) ? "已有作品，但该目标尚未独立评价。总分不能代替目标评分，请通过新作品补充证据。"
          : "最近作品来自已归档任务，保留历史评价；请在当前已发布任务中收集可继续安排的证据。",
        action: source ? { kind: "source", studentId: member.id, sourceId: source.work.id, objectiveId: goal.id }
          : { kind: "assignment", classId: member.classId, assignmentId: assignment.id, objectiveId: goal.id } });
    }
  }
  for (const sequence of activeSequences) {
    const assignment = assignments.get(sequence.assignmentId)!;
    const stage = nextSequenceStage(sequence);
    const base = { classId: assignment.classId, className: assignment.className, studentId: sequence.studentUserId, studentName: sequence.studentName,
      goals: [{ id: sequence.objectiveId, title: sequence.objectiveTitle }], title: sequence.title,
      action: { kind: "sequence" as const, studentId: sequence.studentUserId, sequenceId: sequence.id } };
    if (stage) {
      if (sequence[stage].some((work) => !work.reviewed)) continue;
      items.push({ ...base, id: `sequence:${sequence.id}:${stage}`, kind: stage, time: stage === "retest" ? sequence.retestAvailableAt : null,
        work: stage === "practice" ? sequence.baseline : stage === "transfer" ? sequence.practice[0] ?? null : sequence.transfer.find((work) => work.id === sequence.retestReferenceId) ?? null,
        detail: stage === "retest" ? "教师安排的复测已经开放，尚无待批阅的复测作品。可查看原参照与安排，跟进学生提交。"
          : stage === "practice" ? "已发布针对性练习，尚无待批阅的练习作品。" : "练习已评价，迁移已开放，尚无待批阅的迁移作品。" });
      continue;
    }
    // 尚未开放的复测已经有安排；不提前列为缺证据，也不要求完成的任务组不断生成下一轮。
    if (sequence.retestAvailableAt && !sequence.retestOpen) continue;
    const latest = sequence.retest[0] ?? sequence.transfer[0];
    if (!latest?.reviewed || sequence.decisions.some((decision) => decision.reference.id === latest.id)) continue;
    if (latest.contextConfirmed && latest.helpLevel === "independent" && latest.objectives.some((item) => item.id === sequence.objectiveId)) continue;
    items.push({ ...base, id: `sequence:${sequence.id}:evidence`, kind: "evidence", time: latest.reviewedAt, work: latest,
      detail: `${evidenceStatus(latest, sequence.objectiveId, sequence.retest.length ? "复测" : "迁移")}。请结合原作判断，必要时发布补充证据或减少提示的后续安排。` });
  }
  const priority: Record<TeachingFollowup["kind"], number> = { review: 0, confirmation: 1, retest: 2, evidence: 3, transfer_setup: 4, practice: 5, transfer: 6, initial: 7 };
  items.sort((a, b) => priority[a.kind] - priority[b.kind] || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
  const students = new Map<string, TeachingFollowupData["students"][number]>();
  const objectives = new Map<string, TeachingFollowupData["objectives"][number]>();
  for (const member of rosterResult.results) {
    const candidate = students.get(member.id) ?? { id: member.id, name: member.name, classIds: [] };
    if (!candidate.classIds.includes(member.classId)) candidate.classIds.push(member.classId);
    students.set(member.id, candidate);
  }
  for (const goal of goalResult.results) {
    const assignment = goal.assignmentId ? assignments.get(goal.assignmentId) : undefined;
    if (assignment?.status !== "published") continue;
    const candidate = objectives.get(goal.id) ?? { id: goal.id, title: goal.title, classIds: [] };
    if (!candidate.classIds.includes(assignment.classId)) candidate.classIds.push(assignment.classId);
    objectives.set(goal.id, candidate);
  }
  for (const item of items) {
    const student = students.get(item.studentId) ?? { id: item.studentId, name: item.studentName, classIds: [] };
    if (!student.classIds.includes(item.classId)) student.classIds.push(item.classId);
    students.set(student.id, student);
    for (const goal of item.goals) {
      const candidate = objectives.get(goal.id) ?? { ...goal, classIds: [] };
      if (!candidate.classIds.includes(item.classId)) candidate.classIds.push(item.classId);
      objectives.set(goal.id, candidate);
    }
  }
  return { classes: classResult.results, students: [...students.values()], objectives: [...objectives.values()], items, generatedAt: new Date().toISOString() };
}
