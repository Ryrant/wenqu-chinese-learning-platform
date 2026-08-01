import { classAccessClause, submissionAccessClause } from "../../../lib/access-control";
import { isRecommendationDue, rankLearningPlan, type LearningPlanItem } from "../../../lib/learning-loop";
import { assertGuardianStudentAccess } from "../../../lib/learning-loop-service";
import { loadPlatformSettings, publicPlatformSettings } from "../../../lib/platform-settings";
import { getAuthMode, platformApiError, platformContext } from "../../../lib/platform-store";
import { workspacePasswordChangeGate } from "../../../lib/password-change-state";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const empty = { results: [] as Row[] };

async function qualityMetrics(db: D1Database, tenantId: string) {
  const [assignments, covered, reviews, submissions, weak, masteryTotal, content, documents, ai, students, consents, uncoveredDetails, reviewDetails, weakDetails, contentDetails, aiDetails] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM assignments WHERE tenant_id=? AND status='published'").bind(tenantId).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT a.id) AS count FROM assignments a
      JOIN assignment_objectives ao ON ao.assignment_id=a.id AND ao.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.status='published'`).bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE tenant_id=? AND review_status!='reviewed'").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE tenant_id=?").bind(tenantId).first<{ count: number }>(),
    db.prepare(`WITH latest AS (
      SELECT student_user_id,objective_id,mastery,
        ROW_NUMBER() OVER (PARTITION BY student_user_id,objective_id ORDER BY id DESC) AS rn
      FROM mastery_snapshots WHERE tenant_id=?
    ) SELECT COUNT(*) AS count FROM latest
      JOIN learning_objectives lo ON lo.tenant_id=? AND lo.id=latest.objective_id AND lo.status='active'
      JOIN role_memberships rm ON rm.tenant_id=? AND rm.user_id=latest.student_user_id
        AND rm.role='student' AND rm.status='active'
      WHERE latest.rn=1 AND latest.mastery<0.6
        AND EXISTS (SELECT 1 FROM enrollments e
          WHERE e.tenant_id=? AND e.student_user_id=latest.student_user_id AND e.status='active')`)
      .bind(tenantId, tenantId, tenantId, tenantId).first<{ count: number }>(),
    db.prepare(`WITH latest AS (
      SELECT id,ROW_NUMBER() OVER (PARTITION BY student_user_id,objective_id ORDER BY id DESC) AS rn
      FROM mastery_snapshots WHERE tenant_id=?
    ) SELECT COUNT(*) AS count FROM latest WHERE rn=1`).bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM source_documents WHERE tenant_id=? AND archived_at IS NULL AND processing_status IN ('uploaded','processed')").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM source_documents WHERE tenant_id=? AND archived_at IS NULL").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM ai_sessions WHERE tenant_id=? AND created_at>=datetime('now','-7 days')").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM role_memberships WHERE tenant_id=? AND role='student' AND status='active'").bind(tenantId).first<{ count: number }>(),
    db.prepare(`WITH latest AS (
      SELECT cr.student_user_id,cr.status,cr.expires_at,
        ROW_NUMBER() OVER (PARTITION BY cr.student_user_id,cr.scope ORDER BY cr.created_at DESC,cr.id DESC) AS rn
      FROM consent_records cr
      WHERE cr.tenant_id=? AND cr.scope='learning_analytics'
    ) SELECT COUNT(DISTINCT latest.student_user_id) AS count
      FROM latest
      JOIN role_memberships rm ON rm.tenant_id=? AND rm.user_id=latest.student_user_id
        AND rm.role='student' AND rm.status='active'
      WHERE latest.rn=1 AND latest.status='granted'
        AND (latest.expires_at IS NULL OR latest.expires_at>CURRENT_TIMESTAMP)`)
      .bind(tenantId, tenantId).first<{ count: number }>(),
    db.prepare(`SELECT a.id,a.title AS label,'未关联学习目标' AS meta FROM assignments a
      WHERE a.tenant_id=? AND a.status='published' AND NOT EXISTS (
        SELECT 1 FROM assignment_objectives ao WHERE ao.tenant_id=a.tenant_id AND ao.assignment_id=a.id
      ) ORDER BY a.created_at DESC LIMIT 5`).bind(tenantId).all(),
    db.prepare(`SELECT s.id,a.title||' · '||COALESCE(u.display_name,'学生') AS label,'等待教师确认' AS meta
      FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
      LEFT JOIN users u ON u.id=s.student_user_id WHERE s.tenant_id=? AND s.review_status!='reviewed'
      ORDER BY s.created_at DESC LIMIT 5`).bind(tenantId).all(),
    db.prepare(`WITH latest AS (
      SELECT ms.*,ROW_NUMBER() OVER (PARTITION BY ms.student_user_id,ms.objective_id ORDER BY ms.id DESC) AS rn
      FROM mastery_snapshots ms WHERE ms.tenant_id=?
    ) SELECT CAST(latest.id AS TEXT) AS id,COALESCE(u.display_name,'学生')||' · '||lo.title AS label,
      ROUND(latest.mastery*100)||'%' AS meta FROM latest JOIN users u ON u.id=latest.student_user_id
      JOIN learning_objectives lo ON lo.id=latest.objective_id AND lo.tenant_id=?
      WHERE latest.rn=1 AND latest.mastery<0.6 ORDER BY latest.mastery LIMIT 5`).bind(tenantId, tenantId).all(),
    db.prepare(`SELECT id,title AS label,'待权属或发布审核' AS meta FROM source_documents
      WHERE tenant_id=? AND archived_at IS NULL AND processing_status IN ('uploaded','processed')
      ORDER BY created_at DESC LIMIT 5`).bind(tenantId).all(),
    db.prepare(`SELECT COALESCE(u.id,a.user_id)||':'||a.purpose AS id,COALESCE(u.display_name,'用户')||' · '||a.purpose AS label,
      COUNT(*)||' 次' AS meta FROM ai_sessions a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.tenant_id=? AND a.created_at>=datetime('now','-7 days') GROUP BY a.user_id,a.purpose ORDER BY COUNT(*) DESC LIMIT 5`).bind(tenantId).all(),
  ]);
  const publishedAssignments = Number(assignments?.count ?? 0);
  const activeStudents = Number(students?.count ?? 0);
  const coveredCount = Number(covered?.count ?? 0);
  const consentCount = Number(consents?.count ?? 0);
  const metric = (label: string, numerator: number, denominator: number, unit: "percent" | "count", note: string, details: Row[] = []) => ({
    label,
    value: unit === "percent" ? (denominator ? Math.round(numerator / denominator * 100) : 0) : numerator,
    numerator,
    denominator,
    unit,
    note,
    details: details.map((item) => ({ id: String(item.id), label: String(item.label), meta: item.meta ? String(item.meta) : undefined })),
    trendAvailable: false,
  });
  return {
    objectiveCoverage: metric("目标覆盖率", coveredCount, publishedAssignments, "percent", "已发布任务关联目标", uncoveredDetails.results),
    pendingReviews: metric("待批阅作业", Number(reviews?.count ?? 0), Number(submissions?.count ?? 0), "count", "只统计真实提交", reviewDetails.results),
    lowMasteryObjectives: metric("低掌握度目标", Number(weak?.count ?? 0), Number(masteryTotal?.count ?? 0), "count", "最新快照低于 60%", weakDetails.results),
    pendingContent: metric("内容待审核", Number(content?.count ?? 0), Number(documents?.count ?? 0), "count", "未发布且未归档内容", contentDetails.results),
    consentCoverage: metric("授权覆盖", consentCount, activeStudents, "percent", "学习分析有效授权", []),
    aiSessions7d: metric("AI 使用情况", Number(ai?.count ?? 0), 7, "count", "最近 7 天真实会话", aiDetails.results),
  };
}

export async function GET(request: Request) {
  try {
    const context = await platformContext(request);
    const passwordChangeGate = workspacePasswordChangeGate(getAuthMode(), context);
    if (passwordChangeGate) return passwordChangeGate;
    const { db, tenantId, userId, userEmail, displayName, roles } = context;
    const admin = roles.includes("admin");
    const teacher = roles.includes("teacher");
    const guardian = roles.includes("guardian");
    const student = roles.includes("student");
    const classAccess = classAccessClause(context, "c");
    const submissionAccess = submissionAccessClause(context, "s", "c");

    const availableStudentsResult = guardian
      ? await db.prepare(`SELECT DISTINCT u.id,u.display_name AS displayName
          FROM guardian_student_links gl JOIN users u ON u.id=gl.student_user_id AND u.status='active'
          WHERE gl.tenant_id=? AND gl.guardian_user_id=? AND gl.status='active' ORDER BY u.display_name`)
        .bind(tenantId, userId).all<{ id: string; displayName: string }>()
      : { results: [] as Array<{ id: string; displayName: string }> };
    const requestedStudentId = new URL(request.url).searchParams.get("studentId")?.trim() ?? "";
    let selectedStudentId: string | null = student ? userId : null;
    if (guardian && requestedStudentId) {
      await assertGuardianStudentAccess(db, context, requestedStudentId);
      selectedStudentId = requestedStudentId;
    } else if (guardian && !selectedStudentId) {
      selectedStudentId = availableStudentsResult.results[0]?.id ?? null;
    }
    const focusStudentId = selectedStudentId ?? userId;
    const selectedStudent = availableStudentsResult.results.find((item) => item.id === selectedStudentId)
      ?? (student && focusStudentId === userId ? { id: userId, displayName } : null);

    const guardianSubmissionFilter = guardian && !admin && !teacher && !student ? " AND s.student_user_id=?" : "";
    const guardianSubmissionArgs = guardianSubmissionFilter ? [focusStudentId] : [];
    const classesQuery = db.prepare(`SELECT c.*,COUNT(e.id) AS studentCount
      FROM classes c LEFT JOIN enrollments e ON e.class_id=c.id AND e.tenant_id=c.tenant_id AND e.status='active'
      WHERE c.tenant_id=? AND ${classAccess.sql} GROUP BY c.id ORDER BY c.created_at DESC`)
      .bind(tenantId, ...classAccess.args);
    const assignmentsQuery = db.prepare(`SELECT a.*,c.name AS className,COUNT(DISTINCT s.id) AS submissionCount,
      EXISTS(SELECT 1 FROM submissions fs
        WHERE fs.tenant_id=a.tenant_id AND fs.assignment_id=a.id AND fs.student_user_id=?) AS submittedByFocus,
      group_concat(DISTINCT ao.objective_id) AS objectiveIds
      FROM assignments a JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      LEFT JOIN submissions s ON s.assignment_id=a.id AND s.tenant_id=a.tenant_id
      LEFT JOIN assignment_objectives ao ON ao.assignment_id=a.id AND ao.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND ${classAccess.sql} GROUP BY a.id ORDER BY a.created_at DESC`)
      .bind(focusStudentId, tenantId, ...classAccess.args);
    const submissionsQuery = db.prepare(`SELECT s.*,a.title AS assignmentTitle,u.display_name AS studentName,
      group_concat(DISTINCT lo.title) AS objectiveTitles
      FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
      JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      LEFT JOIN users u ON u.id=s.student_user_id
      LEFT JOIN assignment_objectives ao ON ao.assignment_id=a.id AND ao.tenant_id=a.tenant_id
      LEFT JOIN learning_objectives lo ON lo.id=ao.objective_id AND lo.tenant_id=ao.tenant_id
      WHERE s.tenant_id=? AND ${submissionAccess.sql}${guardianSubmissionFilter}
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 50`)
      .bind(tenantId, ...submissionAccess.args, ...guardianSubmissionArgs);
    const weeklyStatsQuery = db.prepare(`SELECT
      SUM(CASE WHEN created_at>=datetime('now','-7 days') THEN 1 ELSE 0 END) AS submittedCount,
      SUM(CASE WHEN review_status='reviewed'
        AND COALESCE(reviewed_at,created_at)>=datetime('now','-7 days') THEN 1 ELSE 0 END) AS reviewedCount,
      AVG(CASE WHEN review_status='reviewed'
        AND COALESCE(reviewed_at,created_at)>=datetime('now','-7 days') THEN score END) AS averageScore
      FROM submissions WHERE tenant_id=? AND student_user_id=?`)
      .bind(tenantId, focusStudentId);
    const submissionReviewsQuery = (admin || teacher)
      ? db.prepare(`SELECT sr.* FROM submission_reviews sr
          JOIN submissions s ON s.id=sr.submission_id AND s.tenant_id=sr.tenant_id
          JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
          JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
          WHERE sr.tenant_id=? AND ${submissionAccess.sql} ORDER BY sr.created_at DESC LIMIT 50`)
        .bind(tenantId, ...submissionAccess.args)
      : null;
    const masteryQuery = db.prepare(`WITH ranked AS (
      SELECT ms.*,ROW_NUMBER() OVER (PARTITION BY ms.student_user_id,ms.objective_id ORDER BY ms.id DESC) AS rn
      FROM mastery_snapshots ms WHERE ms.tenant_id=? AND ms.student_user_id=?
    ) SELECT r.student_user_id AS studentUserId,r.objective_id AS objectiveId,lo.title,lo.skill,
      r.mastery,r.evidence_count AS evidenceCount,r.created_at AS measuredAt
      FROM ranked r JOIN learning_objectives lo ON lo.id=r.objective_id AND lo.tenant_id=?
      WHERE r.rn=1 ORDER BY lo.skill`)
      .bind(tenantId, focusStudentId, tenantId);
    const masteryMatrixQuery = (admin || teacher)
      ? db.prepare(`WITH ranked AS (
          SELECT ms.*,ROW_NUMBER() OVER (PARTITION BY ms.student_user_id,ms.objective_id ORDER BY ms.id DESC) AS rn
          FROM mastery_snapshots ms WHERE ms.tenant_id=?
        ) SELECT r.student_user_id AS studentUserId,u.display_name AS studentName,r.objective_id AS objectiveId,
          lo.title,lo.skill,r.mastery,r.evidence_count AS evidenceCount
          FROM ranked r JOIN users u ON u.id=r.student_user_id
          JOIN learning_objectives lo ON lo.id=r.objective_id AND lo.tenant_id=r.tenant_id
          WHERE r.rn=1 AND (?=1 OR EXISTS (
            SELECT 1 FROM enrollments e JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id
            WHERE e.tenant_id=r.tenant_id AND e.student_user_id=r.student_user_id AND e.status='active' AND c.teacher_user_id=?
          )) ORDER BY u.display_name,lo.skill`)
        .bind(tenantId, admin ? 1 : 0, userId)
      : null;
    const recommendationsQuery = db.prepare(`SELECT lr.*,lo.title AS objectiveTitle,di.prompt AS reviewPrompt,
      di.options_json AS reviewOptionsJson
      FROM learning_recommendations lr
      LEFT JOIN learning_objectives lo ON lo.id=lr.objective_id AND lo.tenant_id=lr.tenant_id
      LEFT JOIN diagnostic_items di ON di.id=lr.source_id AND di.tenant_id=lr.tenant_id
      WHERE lr.tenant_id=? AND lr.student_user_id=? AND lr.archived_at IS NULL ORDER BY
      CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END,COALESCE(lr.due_at,'9999-12-31'),lr.created_at DESC`)
      .bind(tenantId, focusStudentId);
    const diagnosticItemsQuery = admin
      ? db.prepare(`SELECT di.*,lo.title AS objectiveTitle FROM diagnostic_items di
          JOIN learning_objectives lo ON lo.id=di.objective_id AND lo.tenant_id=di.tenant_id
          WHERE di.tenant_id=? ORDER BY di.level,di.sort_order,di.created_at`).bind(tenantId)
      : student
        ? db.prepare(`WITH ranked AS (
            SELECT di.id,di.tenant_id,di.objective_id,di.level,di.prompt,di.options_json,di.sort_order,di.created_at,
              ROW_NUMBER() OVER (PARTITION BY di.level ORDER BY di.sort_order,di.created_at,di.id) AS rn
            FROM diagnostic_items di WHERE di.tenant_id=? AND di.status='active'
          ) SELECT di.id,di.objective_id AS objectiveId,lo.title AS objectiveTitle,di.level,
            di.prompt,di.options_json AS optionsJson,di.sort_order AS sortOrder
            FROM ranked di JOIN learning_objectives lo ON lo.id=di.objective_id AND lo.tenant_id=di.tenant_id
            WHERE di.rn<=30 ORDER BY di.level,di.rn`).bind(tenantId)
        : null;
    const objectivesQuery = (admin || teacher)
      ? db.prepare("SELECT * FROM learning_objectives WHERE tenant_id=? ORDER BY level,skill,code").bind(tenantId)
      : db.prepare("SELECT id,code,title,skill,level FROM learning_objectives WHERE tenant_id=? AND status='active' ORDER BY level,skill,code").bind(tenantId);
    const enrollmentsQuery = (admin || teacher)
      ? db.prepare(`SELECT e.class_id AS classId,e.student_user_id AS studentUserId,e.status,
          c.name AS className,u.display_name AS studentName
          FROM enrollments e JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id
          JOIN users u ON u.id=e.student_user_id
          WHERE e.tenant_id=? AND (?=1 OR c.teacher_user_id=?) ORDER BY c.name,u.display_name`)
        .bind(tenantId, admin ? 1 : 0, userId)
      : null;

    const [
      classes, assignments, submissions, weeklyStats, submissionReviews, mastery, masteryMatrix, recommendations,
      diagnosticItems, learningObjectives, enrollments, documents, plans, notifications, consents,
      audits, invitations, members, guardianLinks, diagnosticSummary,
    ] = await Promise.all([
      classesQuery.all(), assignmentsQuery.all(), submissionsQuery.all(),
      weeklyStatsQuery.first<{ submittedCount: number | null; reviewedCount: number | null; averageScore: number | null }>(),
      submissionReviewsQuery ? submissionReviewsQuery.all() : Promise.resolve(empty),
      masteryQuery.all(), masteryMatrixQuery ? masteryMatrixQuery.all() : Promise.resolve(empty),
      recommendationsQuery.all(), diagnosticItemsQuery ? diagnosticItemsQuery.all() : Promise.resolve(empty),
      objectivesQuery.all(), enrollmentsQuery ? enrollmentsQuery.all() : Promise.resolve(empty),
      admin || teacher ? db.prepare(`SELECT d.*,d.processing_error AS processingError,COUNT(k.id) AS chunkCount,
        SUM(CASE WHEN k.published=1 THEN 1 ELSE 0 END) AS publishedChunkCount,
        (SELECT json_group_array(preview.content) FROM (
          SELECT content FROM knowledge_chunks pk WHERE pk.tenant_id=d.tenant_id AND pk.source_document_id=d.id ORDER BY pk.created_at LIMIT 3
        ) preview) AS previewChunksJson
        FROM source_documents d LEFT JOIN knowledge_chunks k ON k.source_document_id=d.id AND k.tenant_id=d.tenant_id
        WHERE d.tenant_id=? AND d.archived_at IS NULL GROUP BY d.id ORDER BY COALESCE(d.updated_at,d.created_at) DESC`).bind(tenantId).all() : Promise.resolve(empty),
      admin ? db.prepare("SELECT * FROM lesson_plans WHERE tenant_id=? AND archived_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 20").bind(tenantId).all()
        : teacher ? db.prepare("SELECT * FROM lesson_plans WHERE tenant_id=? AND created_by=? AND archived_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 20").bind(tenantId, userId).all()
          : Promise.resolve(empty),
      db.prepare("SELECT * FROM notifications WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId, userId).all(),
      db.prepare("SELECT * FROM consent_records WHERE tenant_id=? AND (student_user_id=? OR guardian_user_id=?) ORDER BY created_at DESC").bind(tenantId, focusStudentId, userId).all(),
      admin ? db.prepare(`SELECT a.*,u.display_name AS actorDisplayName
        FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
        WHERE a.tenant_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 30`).bind(tenantId).all() : Promise.resolve(empty),
      admin ? db.prepare("SELECT id,email,role,status,expires_at AS expiresAt,created_at AS createdAt FROM invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId).all() : Promise.resolve(empty),
      admin ? db.prepare(`SELECT u.id,u.email,u.display_name AS displayName,
        CASE WHEN u.status='active' AND SUM(CASE WHEN rm.status='active' THEN 1 ELSE 0 END) > 0 THEN 'active' ELSE 'disabled' END AS status,
        u.must_change_password AS mustChangePassword,group_concat(rm.role) AS roles
        FROM users u JOIN role_memberships rm ON rm.user_id=u.id
        WHERE rm.tenant_id=? GROUP BY u.id ORDER BY u.created_at DESC`).bind(tenantId).all() : Promise.resolve(empty),
      admin ? db.prepare("SELECT guardian_user_id AS guardianUserId,student_user_id AS studentUserId,status,verified_at AS verifiedAt FROM guardian_student_links WHERE tenant_id=? AND status='active' ORDER BY created_at DESC").bind(tenantId).all() : Promise.resolve(empty),
      db.prepare("SELECT id,level,score,completed_at AS completedAt FROM diagnostic_attempts WHERE tenant_id=? AND student_user_id=? ORDER BY completed_at DESC LIMIT 1").bind(tenantId, focusStudentId).first(),
    ]);

    const masteryAverage = mastery.results.length
      ? Math.round(mastery.results.reduce((sum, item) => sum + Number(item.mastery ?? 0), 0) / mastery.results.length * 100)
      : 0;
    const weeklyReport = {
      submittedCount: Number(weeklyStats?.submittedCount ?? 0),
      reviewedCount: Number(weeklyStats?.reviewedCount ?? 0),
      averageScore: weeklyStats?.averageScore === null || weeklyStats?.averageScore === undefined
        ? null
        : Math.round(Number(weeklyStats.averageScore)),
      masteryAverage,
      pendingRecommendations: recommendations.results.filter((item) => item.status === "pending").length,
    };
    const now = new Date();
    const planCandidates: Array<LearningPlanItem & Row> = [
      ...recommendations.results.filter((item) =>
        item.status === "pending"
        && (item.source_type !== "diagnostic"
          || isRecommendationDue(typeof item.due_at === "string" ? item.due_at : null, now))
      ).map((item) => ({
        ...item,
        id: String(item.id),
        kind: item.source_type === "teacher" ? "teacher" as const
          : item.source_type === "family" ? "family" as const
            : "review" as const,
        dueAt: typeof item.due_at === "string" ? item.due_at : null,
      })),
      ...assignments.results.filter((item) => item.status === "published" && Number(item.submittedByFocus ?? 0) === 0).map((item) => ({
        ...item,
        id: String(item.id),
        kind: "assignment" as const,
        dueAt: typeof item.due_at === "string" ? item.due_at : null,
      })),
    ];
    const settings = await loadPlatformSettings(db);
    return Response.json({
      workspace: { tenantId, name: "华文趣味试用学校", region: "sg", sampleData: true },
      user: { id: userId, email: userEmail, displayName, roles },
      classes: classes.results,
      assignments: assignments.results,
      submissions: submissions.results,
      submissionReviews: submissionReviews.results,
      mastery: mastery.results,
      masteryMatrix: masteryMatrix.results,
      learningObjectives: learningObjectives.results,
      diagnosticItems: diagnosticItems.results,
      diagnosticSummary: diagnosticSummary ?? null,
      recommendations: recommendations.results,
      learningPlan: rankLearningPlan(planCandidates),
      availableStudents: availableStudentsResult.results,
      selectedStudent,
      weeklyReport,
      qualityMetrics: admin ? await qualityMetrics(db, tenantId) : null,
      enrollments: enrollments.results,
      documents: documents.results.map((item) => {
        let previewChunks: string[] = [];
        try { previewChunks = JSON.parse(String(item.previewChunksJson ?? "[]")); } catch { previewChunks = []; }
        return { ...item, previewChunks, previews: previewChunks };
      }),
      lessonPlans: plans.results,
      notifications: notifications.results,
      consents: consents.results,
      audits: audits.results,
      invitations: invitations.results,
      members: members.results,
      guardianLinks: guardianLinks.results,
      platformSettings: admin ? publicPlatformSettings(settings) : undefined,
      services: {
        database: { status: "available", label: "D1 业务数据" },
        storage: { status: "available", label: "R2 文件存储" },
        retrieval: { status: "available", label: "已发布知识片段检索" },
        generation: settings.openAiKey || settings.aiKey ? { status: "configured", label: `外部模型已配置：${settings.aiModel}` } : { status: "template", label: "未配置外部模型，使用来源化教学模板" },
        speech: settings.speechKey ? { status: "configured", label: "语音评分已配置" } : { status: "manual", label: "录音真实保存，评分转教师复核" },
        moderation: settings.moderationKey ? { status: "configured", label: "内容审核服务已配置" } : { status: "rules", label: "未配置内容审核服务，使用基础规则" },
      },
      generatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformApiError(error);
  }
}
