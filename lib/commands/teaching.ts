import { validateRubric } from "../learning-loop";
import { setClassEnrollments } from "../learning-loop-service";
import { assertDiagnosticMedia } from "../diagnostic-media";
import { text, requireText, requireStringArray, auditStatement, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const teachingCommands = {
  set_class_enrollments: async (body, context) => {
    const { db } = context;
    const studentUserIds = requireStringArray(body.studentUserIds, "student_ids");
    const expectedStudentUserIds = body.expectedStudentUserIds === undefined ? undefined : requireStringArray(body.expectedStudentUserIds, "expected_student_ids");
    const result = await setClassEnrollments(db, context, { classId: requireText(body.classId, "class_id", 120), studentUserIds, expectedStudentUserIds });
    return Response.json(result);
  },

  create_class: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = crypto.randomUUID();
    const name = requireText(body.name, "class_name");
    const level = requireText(body.level, "level", 20);
    await db.batch([
      db.prepare("INSERT INTO classes (id,tenant_id,name,level,teacher_user_id,academic_year) VALUES (?,?,?,?,?,?)").bind(id, tenantId, name, level, userId, String(new Date().getFullYear())),
      auditStatement(db, tenantId, userId, "class.created", "class", id, { name, level }),
    ]);
    return Response.json({ id, name, level }, { status: 201 });
  },

  create_assignment: async (body, context) => {
    const { db, tenantId, userId } = context;
    const isAdmin = context.roles.includes("admin");
    const id = crypto.randomUUID();
    const title = requireText(body.title, "title");
    const classId = requireText(body.classId, "class_id");
    const activityType = requireText(body.activityType, "activity_type", 80);
    const owned = await db.prepare("SELECT id FROM classes WHERE id=? AND tenant_id=? AND (teacher_user_id=? OR ?=1)").bind(classId, tenantId, userId, isAdmin ? 1 : 0).first();
    if (!owned) return Response.json({ error: "class_not_found" }, { status: 404 });
    const objectiveIds = [...new Set(Array.isArray(body.objectiveIds) ? body.objectiveIds.map((value) => text(value, 120)).filter(Boolean) : [])];
    if (!objectiveIds.length || objectiveIds.length > 3) throw new Error("invalid_objective_ids");
    const placeholders = objectiveIds.map(() => "?").join(",");
    const objectives = await db.prepare(`SELECT id FROM learning_objectives WHERE tenant_id=? AND status='active' AND id IN (${placeholders})`).bind(tenantId, ...objectiveIds).all<{ id: string }>();
    if (objectives.results.length !== objectiveIds.length) throw new Error("invalid_objective_ids");
    const rubric = validateRubric(body.rubric);
    const dueAt = text(body.dueAt, 40) || null;
    const diagnosticMode = text(body.diagnosticMode, 20);
    if (!["", "speaking", "writing"].includes(diagnosticMode)) throw new Error("invalid_diagnostic_mode");
    const diagnosticPrompt = diagnosticMode ? requireText(body.diagnosticPrompt, "diagnostic_prompt", 2000) : "";
    const diagnosticMediaId = diagnosticMode ? text(body.diagnosticMediaId, 120) || null : null;
    if (diagnosticMode === "speaking" && !diagnosticMediaId) throw new Error("invalid_diagnostic_media");
    if (diagnosticMediaId) await assertDiagnosticMedia(context, diagnosticMediaId, "image");
    await db.batch([
      db.prepare("INSERT INTO assignments (id,tenant_id,class_id,title,activity_type,status,due_at,rubric_json,created_by,diagnostic_mode,diagnostic_prompt,diagnostic_media_id) VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?)").bind(id, tenantId, classId, title, activityType, dueAt, JSON.stringify(rubric), userId, diagnosticMode, diagnosticPrompt, diagnosticMediaId),
      ...objectiveIds.map((objectiveId) => db.prepare("INSERT INTO assignment_objectives (tenant_id,assignment_id,objective_id,weight) VALUES (?,?,?,?)").bind(tenantId, id, objectiveId, 1 / objectiveIds.length)),
      auditStatement(db, tenantId, userId, "assignment.created", "assignment", id, { title, objectiveIds, rubric }),
    ]);
    return Response.json({ id, status: "draft" }, { status: 201 });
  },

  publish_assignment: async (body, context) => {
    const { db, tenantId, userId } = context;
    const isAdmin = context.roles.includes("admin");
    const id = requireText(body.id, "assignment_id");
    const existing = await db.prepare(`SELECT a.rubric_json AS rubricJson,COUNT(lo.id) AS objectiveCount
        FROM assignments a
        LEFT JOIN assignment_objectives ao ON ao.assignment_id=a.id AND ao.tenant_id=a.tenant_id
        LEFT JOIN learning_objectives lo ON lo.id=ao.objective_id AND lo.tenant_id=ao.tenant_id AND lo.status='active'
        WHERE a.id=? AND a.tenant_id=? AND a.status IN ('draft','review')
          AND (?=1 OR a.class_id IN (SELECT id FROM classes WHERE tenant_id=? AND teacher_user_id=?))
        GROUP BY a.id`)
      .bind(id, tenantId, isAdmin ? 1 : 0, tenantId, userId)
      .first<{ rubricJson: string; objectiveCount: number }>();
    if (!existing || Number(existing.objectiveCount) < 1) {
      return Response.json({ error: "assignment_requires_objective" }, { status: 409 });
    }
    try {
      validateRubric(JSON.parse(existing.rubricJson));
    } catch {
      return Response.json({ error: "assignment_requires_valid_rubric" }, { status: 409 });
    }
    const [result] = await db.batch([
      db.prepare("UPDATE assignments SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND status IN ('draft','review') AND (?=1 OR class_id IN (SELECT id FROM classes WHERE tenant_id=? AND teacher_user_id=?))").bind(id, tenantId, isAdmin ? 1 : 0, tenantId, userId),
      db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) SELECT ?,?,?,'assignment.published','assignment',?,'{}' WHERE changes()>0").bind(crypto.randomUUID(), tenantId, userId, id),
    ]);
    if (!result.meta.changes) return Response.json({ error: "assignment_not_publishable" }, { status: 409 });
    return Response.json({ id, status: "published" });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
