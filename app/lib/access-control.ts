import type { PlatformContext } from "./platform-store";

export type AccessClause = { sql: string; args: unknown[] };

export function classAccessClause(context: PlatformContext, classAlias = "c"): AccessClause {
  if (context.roles.includes("admin")) return { sql: "1=1", args: [] };
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (context.roles.includes("teacher")) {
    clauses.push(`${classAlias}.teacher_user_id=?`);
    args.push(context.userId);
  }
  if (context.roles.includes("student")) {
    clauses.push(`EXISTS (SELECT 1 FROM enrollments ea WHERE ea.tenant_id=${classAlias}.tenant_id AND ea.class_id=${classAlias}.id AND ea.student_user_id=? AND ea.status='active')`);
    args.push(context.userId);
  }
  if (context.roles.includes("guardian")) {
    clauses.push(`EXISTS (SELECT 1 FROM enrollments eg JOIN guardian_student_links gl ON gl.tenant_id=eg.tenant_id AND gl.student_user_id=eg.student_user_id AND gl.status='active' WHERE eg.tenant_id=${classAlias}.tenant_id AND eg.class_id=${classAlias}.id AND gl.guardian_user_id=?)`);
    args.push(context.userId);
  }
  return clauses.length ? { sql: `(${clauses.join(" OR ")})`, args } : { sql: "1=0", args: [] };
}

export function submissionAccessClause(context: PlatformContext, submissionAlias = "s", classAlias = "c"): AccessClause {
  if (context.roles.includes("admin")) return { sql: "1=1", args: [] };
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (context.roles.includes("teacher")) {
    clauses.push(`${classAlias}.teacher_user_id=?`);
    args.push(context.userId);
  }
  if (context.roles.includes("student")) {
    clauses.push(`${submissionAlias}.student_user_id=?`);
    args.push(context.userId);
  }
  if (context.roles.includes("guardian")) {
    clauses.push(`EXISTS (SELECT 1 FROM guardian_student_links gl WHERE gl.tenant_id=${submissionAlias}.tenant_id AND gl.student_user_id=${submissionAlias}.student_user_id AND gl.guardian_user_id=? AND gl.status='active')`);
    args.push(context.userId);
  }
  return clauses.length ? { sql: `(${clauses.join(" OR ")})`, args } : { sql: "1=0", args: [] };
}

export async function assertSubmissionReviewAccess(db: D1Database, context: PlatformContext, submissionId: string) {
  if (context.roles.includes("admin")) return;
  const row = await db.prepare(`
    SELECT s.id
    FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
    WHERE s.id=? AND s.tenant_id=? AND c.teacher_user_id=?
  `).bind(submissionId, context.tenantId, context.userId).first();
  if (!row) throw new Error("forbidden");
}
