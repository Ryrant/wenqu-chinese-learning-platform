import { studentAccessClause, submissionAccessClause } from "./access-control";
import type { FamilyPortfolioData, FamilyPortfolioEntry, PortfolioStudent } from "./family-portfolio-types";
import { readFamilyWorkSnapshot } from "./family-task";
import { HELP_LEVEL_LABELS, type HelpLevel } from "./learning-sequence-types";
import type { PlatformContext } from "./platform-store";
import { readWorkRows, workEvidence } from "./work-evidence-service";

export async function readFamilyPortfolio(context: PlatformContext, requestedStudentId?: string): Promise<FamilyPortfolioData> {
  const { db, tenantId } = context;
  const studentAccess = studentAccessClause(context, "u.id", "rm.tenant_id");
  const workAccess = submissionAccessClause(context);
  // 候选包含在读学生与授权历史作品的学生，离班后仍可回看原班级作品。
  const students = (await db.prepare(`SELECT DISTINCT u.id AS id,u.display_name AS displayName FROM users u
    JOIN role_memberships rm ON rm.user_id=u.id AND rm.tenant_id=? AND rm.role='student' AND rm.status='active'
    WHERE ${studentAccess.sql}
    UNION SELECT DISTINCT u.id AS id,u.display_name AS displayName FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id JOIN users u ON u.id=s.student_user_id
    WHERE s.tenant_id=? AND s.family_task_id IS NOT NULL AND ${workAccess.sql}
    ORDER BY displayName,id`).bind(tenantId, ...studentAccess.args, tenantId, ...workAccess.args).all<PortfolioStudent>()).results;
  const selectedId = requestedStudentId ?? (students.find((item) => item.id === context.userId)?.id || students[0]?.id);
  const student = students.find((item) => item.id === selectedId) ?? null;
  if (requestedStudentId !== undefined && !student) throw new Error("portfolio_student_not_found");
  if (!student) return { students, student: null, entries: [], generatedAt: new Date().toISOString() };
  const [rows, sequenceResult] = await Promise.all([
    readWorkRows(db, context, "s.family_task_id IS NOT NULL AND s.student_user_id=?", [student.id]),
    db.prepare(`SELECT ls.id,ls.title,ls.objective_title AS objectiveTitle,ls.baseline_submission_id AS baselineId,d.sequence_id AS parentId
      FROM learning_sequences ls JOIN submissions s ON s.id=ls.baseline_submission_id AND s.tenant_id=ls.tenant_id
        AND s.assignment_id=ls.assignment_id AND s.student_user_id=ls.student_user_id
      JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      LEFT JOIN learning_sequence_decisions d ON d.next_sequence_id=ls.id AND d.tenant_id=ls.tenant_id
      WHERE ls.tenant_id=? AND ls.student_user_id=? AND ${workAccess.sql} ORDER BY ls.created_at DESC,ls.rowid DESC`)
      .bind(tenantId, student.id, ...workAccess.args).all<{ id: string; title: string; objectiveTitle: string; baselineId: string; parentId: string | null }>(),
  ]);
  const entries: FamilyPortfolioEntry[] = rows.map((row) => {
    const snapshot = readFamilyWorkSnapshot(row.family_snapshot_json);
    const evidence = workEvidence(row);
    return {
      work: snapshot ? evidence : { ...evidence, title: "历史家庭交流作品", prompt: "" }, snapshot, className: row.className,
      confirmedAt: row.family_confirmed_at, confirmedByName: row.familyConfirmedName,
      confirmationRole: row.family_confirmation_role === "guardian" || row.family_confirmation_role === "teacher" ? row.family_confirmation_role : null,
      familyHelpLevel: row.family_help_level && Object.hasOwn(HELP_LEVEL_LABELS, row.family_help_level) ? row.family_help_level as HelpLevel : "unknown",
      sequences: [],
    };
  });
  const entriesById = new Map(entries.map((item) => [item.work.id, item]));
  const sequences = new Map(sequenceResult.results.map((item) => [item.id, item]));
  for (const sequence of sequenceResult.results) {
    let current: typeof sequence | undefined = sequence;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const origin = entriesById.get(current.baselineId);
      if (origin) {
        origin.sequences.push({ id: sequence.id, title: sequence.title, objectiveTitle: sequence.objectiveTitle, direct: current.id === sequence.id });
        break;
      }
      current = current.parentId ? sequences.get(current.parentId) : undefined;
    }
  }
  return { students, student, entries, generatedAt: new Date().toISOString() };
}
