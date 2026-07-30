import { env } from "cloudflare:workers";
import { getAuthMode, platformApiError, platformContext } from "../../../lib/platform-store";
import { workspacePasswordChangeGate } from "../../../lib/password-change-state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const passwordChangeGate = workspacePasswordChangeGate(getAuthMode(), context);
    if (passwordChangeGate) return passwordChangeGate;
    const { db, tenantId, userId, userEmail, displayName, roles } = context;
    const admin = roles.includes("admin");
    const classClauses: string[] = [];
    const classArgs: unknown[] = [tenantId];
    if (!admin && roles.includes("teacher")) { classClauses.push("c.teacher_user_id=?"); classArgs.push(userId); }
    if (!admin && roles.includes("student")) { classClauses.push("EXISTS (SELECT 1 FROM enrollments ea WHERE ea.tenant_id=c.tenant_id AND ea.class_id=c.id AND ea.student_user_id=? AND ea.status='active')"); classArgs.push(userId); }
    if (!admin && roles.includes("guardian")) { classClauses.push("EXISTS (SELECT 1 FROM enrollments eg JOIN guardian_student_links gl ON gl.tenant_id=eg.tenant_id AND gl.student_user_id=eg.student_user_id WHERE eg.tenant_id=c.tenant_id AND eg.class_id=c.id AND gl.guardian_user_id=?)"); classArgs.push(userId); }
    const classAccess = admin ? "1=1" : classClauses.length ? `(${classClauses.join(" OR ")})` : "1=0";

    const submissionClauses: string[] = [];
    const submissionArgs: unknown[] = [tenantId];
    if (!admin && roles.includes("teacher")) { submissionClauses.push("c.teacher_user_id=?"); submissionArgs.push(userId); }
    if (!admin && roles.includes("student")) { submissionClauses.push("s.student_user_id=?"); submissionArgs.push(userId); }
    if (!admin && roles.includes("guardian")) { submissionClauses.push("EXISTS (SELECT 1 FROM guardian_student_links gl WHERE gl.tenant_id=s.tenant_id AND gl.student_user_id=s.student_user_id AND gl.guardian_user_id=?)"); submissionArgs.push(userId); }
    const submissionAccess = admin ? "1=1" : submissionClauses.length ? `(${submissionClauses.join(" OR ")})` : "1=0";

    const classesQuery = db.prepare(`SELECT c.*,COUNT(e.id) AS studentCount FROM classes c LEFT JOIN enrollments e ON e.class_id=c.id AND e.tenant_id=c.tenant_id AND e.status='active' WHERE c.tenant_id=? AND ${classAccess} GROUP BY c.id ORDER BY c.created_at DESC`).bind(...classArgs);
    const assignmentsQuery = db.prepare(`SELECT a.*,c.name AS className,COUNT(s.id) AS submissionCount FROM assignments a JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id LEFT JOIN submissions s ON s.assignment_id=a.id AND s.tenant_id=a.tenant_id WHERE a.tenant_id=? AND ${classAccess} GROUP BY a.id ORDER BY a.created_at DESC`).bind(...classArgs);
    const submissionsQuery = db.prepare(`SELECT s.*,a.title AS assignmentTitle,u.display_name AS studentName FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id LEFT JOIN users u ON u.id=s.student_user_id WHERE s.tenant_id=? AND ${submissionAccess} ORDER BY s.created_at DESC LIMIT 50`).bind(...submissionArgs);
    const empty = { results: [] };
    const [classes, assignments, submissions, mastery, documents, plans, notifications, consents, audits, invitations] = await Promise.all([
      classesQuery.all(), assignmentsQuery.all(), submissionsQuery.all(),
      db.prepare(`SELECT lo.title,lo.skill,ms.mastery,ms.evidence_count AS evidenceCount,ms.created_at AS measuredAt FROM mastery_snapshots ms JOIN learning_objectives lo ON lo.id=ms.objective_id AND lo.tenant_id=ms.tenant_id WHERE ms.tenant_id=? AND (ms.student_user_id=? OR EXISTS (SELECT 1 FROM guardian_student_links gl WHERE gl.tenant_id=ms.tenant_id AND gl.student_user_id=ms.student_user_id AND gl.guardian_user_id=?)) ORDER BY ms.created_at DESC`).bind(tenantId,userId,userId).all(),
      admin || roles.includes("teacher") ? db.prepare(`SELECT d.*,COUNT(k.id) AS chunkCount FROM source_documents d LEFT JOIN knowledge_chunks k ON k.source_document_id=d.id AND k.tenant_id=d.tenant_id WHERE d.tenant_id=? GROUP BY d.id ORDER BY d.created_at DESC`).bind(tenantId).all() : Promise.resolve(empty),
      admin ? db.prepare("SELECT * FROM lesson_plans WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId).all() : roles.includes("teacher") ? db.prepare("SELECT * FROM lesson_plans WHERE tenant_id=? AND created_by=? ORDER BY created_at DESC LIMIT 20").bind(tenantId,userId).all() : Promise.resolve(empty),
      db.prepare("SELECT * FROM notifications WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId,userId).all(),
      db.prepare("SELECT * FROM consent_records WHERE tenant_id=? AND (student_user_id=? OR guardian_user_id=?) ORDER BY created_at DESC").bind(tenantId,userId,userId).all(),
      admin ? db.prepare("SELECT * FROM audit_logs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30").bind(tenantId).all() : Promise.resolve(empty),
      admin ? db.prepare("SELECT id,email,role,status,expires_at AS expiresAt,created_at AS createdAt FROM invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId).all() : Promise.resolve(empty),
    ]);
    const config = env as unknown as Record<string, unknown>;
    return Response.json({
      workspace: { tenantId, name: "华文趣味试用学校", region: "sg", sampleData: true },
      user: { id: userId, email: userEmail, displayName, roles },
      classes: classes.results, assignments: assignments.results, submissions: submissions.results, mastery: mastery.results,
      documents: documents.results, lessonPlans: plans.results, notifications: notifications.results, consents: consents.results, audits: audits.results, invitations: invitations.results,
      services: {
        database: { status: "available", label: "D1 业务数据" }, storage: { status: "available", label: "R2 文件存储" }, retrieval: { status: "available", label: "已发布知识片段检索" },
        generation: config.AI_API_KEY ? { status: "configured", label: "外部模型已配置" } : { status: "template", label: "未配置外部模型，使用来源化教学模板" },
        speech: config.SPEECH_API_KEY ? { status: "configured", label: "语音评分已配置" } : { status: "manual", label: "录音真实保存，评分转教师复核" },
      }, generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return platformApiError(error); }
}
