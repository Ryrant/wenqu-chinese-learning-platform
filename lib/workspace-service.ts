import { classAccessClause, submissionAccessClause } from "./access-control";
import { assertGuardianStudentAccess } from "./learning-loop-service";
import { readLearningPlan } from "./learning-plan-service";
import { getPlatformRuntime, type PlatformDatabase, type PlatformRuntime } from "./platform-runtime";
import { loadPlatformSettings, publicPlatformSettings } from "./platform-settings";
import type { PlatformContext } from "./platform-store";
import { WORKSPACE_SECTIONS, type Row, type WorkspacePatch, type WorkspaceSection } from "./platform-types";
import { readSequenceWorkspace } from "./learning-sequence-service";
import { readTrialEntries } from "./trial-service";
import { learningAnalyticsConsentSql, readLearningAnalyticsState } from "./learning-analytics";

const empty = { results: [] as Row[] };

// 缺省保留完整响应，便于已有客户端逐步切换；bootstrap 只读取身份及当前机构。
export function parseWorkspaceSections(include: string | null): ReadonlySet<WorkspaceSection> {
  if (include === null) return new Set(WORKSPACE_SECTIONS);
  const values = include.split(",").map((item) => item.trim());
  if (!values.length || values.some((value) => value !== "bootstrap" && !WORKSPACE_SECTIONS.includes(value as WorkspaceSection))) {
    throw new Error("invalid_workspace_include");
  }
  return new Set(values.filter((value) => value !== "bootstrap") as WorkspaceSection[]);
}

async function qualityMetrics(db: PlatformDatabase, tenantId: string) {
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
      FROM mastery_snapshots WHERE tenant_id=? AND ${learningAnalyticsConsentSql("mastery_snapshots.tenant_id", "mastery_snapshots.student_user_id")}
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
      FROM mastery_snapshots WHERE tenant_id=? AND ${learningAnalyticsConsentSql("mastery_snapshots.tenant_id", "mastery_snapshots.student_user_id")}
    ) SELECT COUNT(*) AS count FROM latest WHERE rn=1`).bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM source_documents WHERE tenant_id=? AND archived_at IS NULL AND processing_status IN ('uploaded','processed')").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM source_documents WHERE tenant_id=? AND archived_at IS NULL").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM ai_sessions WHERE tenant_id=? AND created_at>=datetime('now','-7 days')").bind(tenantId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM role_memberships WHERE tenant_id=? AND role='student' AND status='active'").bind(tenantId).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT rm.user_id) AS count FROM role_memberships rm
      WHERE rm.tenant_id=? AND rm.role='student' AND rm.status='active'
        AND ${learningAnalyticsConsentSql("rm.tenant_id", "rm.user_id")}`)
      .bind(tenantId).first<{ count: number }>(),
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
      FROM mastery_snapshots ms WHERE ms.tenant_id=? AND ${learningAnalyticsConsentSql("ms.tenant_id", "ms.student_user_id")}
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
    pendingReviews: metric("待批阅作业", Number(reviews?.count ?? 0), Number(submissions?.count ?? 0), "count", "等待教师评价的提交", reviewDetails.results),
    lowMasteryObjectives: { ...metric("低掌握度目标", Number(weak?.count ?? 0), Number(masteryTotal?.count ?? 0), "count", consentCount ? "仅统计有效授权学生，最新快照低于 60%" : "无有效学习分析授权，累计分析暂不可用", weakDetails.results), available: consentCount > 0 },
    pendingContent: metric("内容待审核", Number(content?.count ?? 0), Number(documents?.count ?? 0), "count", "未发布且未归档内容", contentDetails.results),
    consentCoverage: metric("授权覆盖", consentCount, activeStudents, "percent", "学习分析有效授权", []),
    aiSessions7d: metric("AI 使用情况", Number(ai?.count ?? 0), 7, "count", "最近 7 天会话", aiDetails.results),
  };
}

async function readMetadata(context: PlatformContext, requestedStudentId: string) {
  const { db, tenantId, userId, displayName, roles } = context;
  const guardian = roles.includes("guardian");
  const student = roles.includes("student");
  const [tenant, availableStudentsResult] = await Promise.all([
    db.prepare("SELECT id,name,region FROM tenants WHERE id=? AND status='active'").bind(tenantId)
      .first<{ id: string; name: string; region: string }>(),
    guardian ? db.prepare(`SELECT DISTINCT u.id,u.display_name AS displayName
      FROM guardian_student_links gl JOIN users u ON u.id=gl.student_user_id AND u.status='active'
      WHERE gl.tenant_id=? AND gl.guardian_user_id=? AND gl.status='active' ORDER BY u.display_name`)
      .bind(tenantId, userId).all<{ id: string; displayName: string }>()
      : Promise.resolve({ results: [] as Array<{ id: string; displayName: string }> }),
  ]);
  if (!tenant) throw new Error("forbidden");
  let selectedStudentId: string | null = student ? userId : null;
  if (guardian && requestedStudentId) {
    if (!student || requestedStudentId !== userId) await assertGuardianStudentAccess(db, context, requestedStudentId);
    selectedStudentId = requestedStudentId;
  } else if (guardian && !selectedStudentId) {
    selectedStudentId = availableStudentsResult.results[0]?.id ?? null;
  }
  const focusStudentId = selectedStudentId ?? userId;
  const selectedStudent = availableStudentsResult.results.find((item) => item.id === selectedStudentId)
    ?? (student && focusStudentId === userId ? { id: userId, displayName } : null);
  return {
    focusStudentId,
    metadata: {
      workspace: { tenantId: tenant.id, name: tenant.name, region: tenant.region },
      user: { id: userId, email: context.userEmail, displayName, roles },
      availableStudents: availableStudentsResult.results,
      selectedStudent,
      generatedAt: new Date().toISOString(),
    },
  };
}

async function readTeaching(context: PlatformContext, focusStudentId: string) {
  const { db, tenantId, userId, roles } = context;
  const admin = roles.includes("admin");
  const teacher = roles.includes("teacher");
  const classAccess = classAccessClause(context, "c");
  // 草稿权限属于具体任教班级，复合角色不能借关联孩子的班级扩大草稿可见范围。
  const assignmentStatusFilter = admin ? "" : teacher ? " AND (a.status='published' OR c.teacher_user_id=?)" : " AND a.status='published'";
  const assignmentStatusArgs = !admin && teacher ? [userId] : [];
  const guardianSubmissionFilter = roles.includes("guardian") && !admin && !teacher && !roles.includes("student") ? " AND s.student_user_id=?" : "";
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
    WHERE a.tenant_id=? AND ${classAccess.sql}${assignmentStatusFilter}${guardianSubmissionFilter ? " AND EXISTS (SELECT 1 FROM enrollments fe WHERE fe.tenant_id=a.tenant_id AND fe.class_id=a.class_id AND fe.student_user_id=? AND fe.status='active')" : ""} GROUP BY a.id ORDER BY a.created_at DESC`)
    .bind(focusStudentId, tenantId, ...classAccess.args, ...assignmentStatusArgs, ...guardianSubmissionArgs);
  const enrollmentsQuery = (admin || teacher)
    ? db.prepare(`SELECT e.class_id AS classId,e.student_user_id AS studentUserId,e.status,
        c.name AS className,u.display_name AS studentName
        FROM enrollments e JOIN classes c ON c.id=e.class_id AND c.tenant_id=e.tenant_id
        JOIN users u ON u.id=e.student_user_id
        WHERE e.tenant_id=? AND (?=1 OR c.teacher_user_id=?) ORDER BY c.name,u.display_name`)
      .bind(tenantId, admin ? 1 : 0, userId)
    : null;
  const [classes, assignments, enrollments] = await Promise.all([
    classesQuery.all(), assignmentsQuery.all(), enrollmentsQuery ? enrollmentsQuery.all() : Promise.resolve(empty),
  ]);
  return { classes: classes.results, assignments: assignments.results, enrollments: enrollments.results };
}

async function readObjectives(context: PlatformContext) {
  const { db, tenantId, roles } = context;
  const admin = roles.includes("admin");
  const teacher = roles.includes("teacher");
  const objectivesQuery = (admin || teacher)
    ? db.prepare("SELECT * FROM learning_objectives WHERE tenant_id=? ORDER BY level,skill,code").bind(tenantId)
    : db.prepare("SELECT id,code,title,skill,level FROM learning_objectives WHERE tenant_id=? AND status='active' ORDER BY level,skill,code").bind(tenantId);
  return (await objectivesQuery.all()).results;
}

async function readCurriculum(context: PlatformContext, objectives: () => Promise<Row[]>) {
  const { db, tenantId, roles } = context;
  const admin = roles.includes("admin");
  const student = roles.includes("student");
  const diagnosticItemsQuery = admin
    ? db.prepare(`SELECT di.*,lo.title AS objectiveTitle FROM diagnostic_items di
        JOIN learning_objectives lo ON lo.id=di.objective_id AND lo.tenant_id=di.tenant_id
        WHERE di.tenant_id=? ORDER BY di.level,di.sort_order,di.created_at`).bind(tenantId)
    : student
      ? db.prepare(`WITH ranked AS (
          SELECT di.id,di.tenant_id,di.objective_id,di.level,di.prompt,di.options_json,di.sort_order,di.created_at,di.ability,di.media_id,di.revision,
            ROW_NUMBER() OVER (PARTITION BY di.level ORDER BY di.sort_order,di.created_at,di.id) AS rn
          FROM diagnostic_items di WHERE di.tenant_id=? AND di.status='active'
        ) SELECT di.id,di.objective_id AS objectiveId,lo.title AS objectiveTitle,di.level,
          di.prompt,di.options_json AS optionsJson,di.sort_order AS sortOrder,di.ability,di.media_id AS mediaId,di.revision
          FROM ranked di JOIN learning_objectives lo ON lo.id=di.objective_id AND lo.tenant_id=di.tenant_id
          WHERE di.rn<=30 ORDER BY di.level,di.rn`).bind(tenantId)
      : null;
  const [diagnosticItems, learningObjectives] = await Promise.all([
    diagnosticItemsQuery ? diagnosticItemsQuery.all() : Promise.resolve(empty), objectives(),
  ]);
  return { diagnosticItems: diagnosticItems.results, learningObjectives };
}

async function readProgress(context: PlatformContext, focusStudentId: string, selectedStudentId: string | null, objectives: () => Promise<Row[]>) {
  const { db, tenantId, userId, roles } = context;
  const analytics = await readLearningAnalyticsState(db, tenantId, focusStudentId);
  const admin = roles.includes("admin");
  const teacher = roles.includes("teacher");
  const submissionAccess = submissionAccessClause(context, "s", "c");
  const guardianSubmissionFilter = roles.includes("guardian") && !admin && !teacher && !roles.includes("student") ? " AND s.student_user_id=?" : "";
  const guardianSubmissionArgs = guardianSubmissionFilter ? [focusStudentId] : [];
  const submissionsQuery = db.prepare(`SELECT * FROM (SELECT s.*,a.title AS assignmentTitle,u.display_name AS studentName,ft.title AS familyTaskTitle,fc.display_name AS familyConfirmedName,
    ROW_NUMBER() OVER (ORDER BY s.created_at DESC,s.rowid DESC) AS submissionRank,
    group_concat(DISTINCT lo.title) AS objectiveTitles
    FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
    LEFT JOIN users u ON u.id=s.student_user_id
    LEFT JOIN users fc ON fc.id=s.family_confirmed_by
    LEFT JOIN learning_recommendations ft ON ft.id=s.family_task_id AND ft.tenant_id=s.tenant_id AND ft.source_type='family'
    LEFT JOIN assignment_objectives ao ON ao.assignment_id=a.id AND ao.tenant_id=a.tenant_id
    LEFT JOIN learning_objectives lo ON lo.id=ao.objective_id AND lo.tenant_id=ao.tenant_id
    WHERE s.tenant_id=? AND ${submissionAccess.sql}${guardianSubmissionFilter}
    GROUP BY s.id) WHERE submissionRank<=50 OR review_status!='reviewed'
    ORDER BY created_at DESC,submissionRank`)
    .bind(tenantId, ...submissionAccess.args, ...guardianSubmissionArgs);
  const weeklyStatsQuery = db.prepare(`SELECT
    SUM(CASE WHEN created_at>=datetime('now','-7 days') THEN 1 ELSE 0 END) AS submittedCount,
    SUM(CASE WHEN review_status='reviewed'
      AND COALESCE((SELECT json_extract(sr.evidence_json,'$.analyticsAllowed') FROM submission_reviews sr WHERE sr.tenant_id=submissions.tenant_id AND sr.submission_id=submissions.id AND sr.status='confirmed' ORDER BY sr.rowid DESC LIMIT 1),1)=1
      AND COALESCE(reviewed_at,created_at)>=datetime('now','-7 days') THEN 1 ELSE 0 END) AS reviewedCount,
    AVG(CASE WHEN review_status='reviewed'
      AND COALESCE((SELECT json_extract(sr.evidence_json,'$.analyticsAllowed') FROM submission_reviews sr WHERE sr.tenant_id=submissions.tenant_id AND sr.submission_id=submissions.id AND sr.status='confirmed' ORDER BY sr.rowid DESC LIMIT 1),1)=1
      AND COALESCE(reviewed_at,created_at)>=datetime('now','-7 days') THEN score END) AS averageScore
    FROM submissions WHERE tenant_id=? AND student_user_id=?
      AND COALESCE(json_extract(diagnostic_snapshot_json,'$.analyticsAllowed'),1)=1
      AND ${learningAnalyticsConsentSql("submissions.tenant_id", "submissions.student_user_id")}`)
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
      AND ${learningAnalyticsConsentSql("ms.tenant_id", "ms.student_user_id")}
  ) SELECT r.student_user_id AS studentUserId,r.objective_id AS objectiveId,lo.title,lo.skill,
    r.mastery,r.evidence_count AS evidenceCount,r.created_at AS measuredAt
    FROM ranked r JOIN learning_objectives lo ON lo.id=r.objective_id AND lo.tenant_id=?
    WHERE r.rn=1 ORDER BY lo.skill`)
    .bind(tenantId, focusStudentId, tenantId);
  const masteryMatrixQuery = (admin || teacher)
    ? db.prepare(`WITH ranked AS (
        SELECT ms.*,ROW_NUMBER() OVER (PARTITION BY ms.student_user_id,ms.objective_id ORDER BY ms.id DESC) AS rn
        FROM mastery_snapshots ms WHERE ms.tenant_id=? AND ${learningAnalyticsConsentSql("ms.tenant_id", "ms.student_user_id")}
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
    di.options_json AS reviewOptionsJson,di.ability AS reviewAbility,di.media_id AS reviewMediaId,di.revision AS reviewRevision,fs.review_status AS familyReviewStatus,fs.family_confirmed_at AS familyConfirmedAt
    FROM learning_recommendations lr
    LEFT JOIN learning_objectives lo ON lo.id=lr.objective_id AND lo.tenant_id=lr.tenant_id
    LEFT JOIN diagnostic_items di ON di.id=lr.source_id AND di.tenant_id=lr.tenant_id
    LEFT JOIN submissions fs ON fs.id=(SELECT latest.id FROM submissions latest WHERE latest.tenant_id=lr.tenant_id AND latest.family_task_id=lr.id ORDER BY latest.created_at DESC,latest.rowid DESC LIMIT 1)
    WHERE lr.tenant_id=? AND lr.student_user_id=? AND lr.archived_at IS NULL
      AND (lr.source_type!='diagnostic' OR lr.objective_id=di.objective_id) ORDER BY
    CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END,COALESCE(lr.due_at,'9999-12-31'),lr.created_at DESC`)
    .bind(tenantId, focusStudentId);
  const [submissions, weeklyStats, submissionReviews, mastery, masteryMatrix, recommendations, diagnosticSummary, sequenceWorkspace, learningObjectives] = await Promise.all([
    submissionsQuery.all(),
    weeklyStatsQuery.first<{ submittedCount: number | null; reviewedCount: number | null; averageScore: number | null }>(),
    submissionReviewsQuery ? submissionReviewsQuery.all() : Promise.resolve(empty),
    masteryQuery.all(), masteryMatrixQuery ? masteryMatrixQuery.all() : Promise.resolve(empty), recommendationsQuery.all(),
    db.prepare("SELECT id,level,score,completed_at AS completedAt FROM diagnostic_attempts WHERE tenant_id=? AND student_user_id=? ORDER BY completed_at DESC LIMIT 1").bind(tenantId, focusStudentId).first(),
    readSequenceWorkspace(db, context, admin || teacher ? null : focusStudentId), objectives(),
  ]);
  const masteryAverage = mastery.results.length
    ? Math.round(mastery.results.reduce((sum, item) => sum + Number(item.mastery ?? 0), 0) / mastery.results.length * 100)
    : null;
  const weeklyReport = {
    ...analytics,
    submittedCount: analytics.available ? Number(weeklyStats?.submittedCount ?? 0) : null,
    reviewedCount: analytics.available ? Number(weeklyStats?.reviewedCount ?? 0) : null,
    averageScore: !analytics.available || weeklyStats?.averageScore === null || weeklyStats?.averageScore === undefined ? null : Math.round(Number(weeklyStats.averageScore)),
    masteryAverage: analytics.available ? masteryAverage : null,
    pendingRecommendations: analytics.available ? recommendations.results.filter((item) => item.status === "pending").length : null,
  };
  const learningPlan = await readLearningPlan(context, selectedStudentId, sequenceWorkspace.learningSequences, learningObjectives);
  return {
    submissions: submissions.results, submissionReviews: submissionReviews.results,
    mastery: mastery.results, masteryMatrix: masteryMatrix.results, recommendations: recommendations.results,
    diagnosticSummary: diagnosticSummary ?? null, learningPlan, ...sequenceWorkspace, weeklyReport,
  };
}

async function readContent(context: PlatformContext) {
  const { db, tenantId, roles } = context;
  if (!roles.includes("admin") && !roles.includes("teacher")) return { documents: [] };
  const documents = await db.prepare(`SELECT d.*,d.processing_error AS processingError,COUNT(k.id) AS chunkCount,
    SUM(CASE WHEN k.published=1 THEN 1 ELSE 0 END) AS publishedChunkCount,
    (SELECT json_group_array(preview.content) FROM (
      SELECT content FROM knowledge_chunks pk WHERE pk.tenant_id=d.tenant_id AND pk.source_document_id=d.id ORDER BY pk.created_at LIMIT 3
    ) preview) AS previewChunksJson
    FROM source_documents d LEFT JOIN knowledge_chunks k ON k.source_document_id=d.id AND k.tenant_id=d.tenant_id
    WHERE d.tenant_id=? AND d.archived_at IS NULL GROUP BY d.id ORDER BY COALESCE(d.updated_at,d.created_at) DESC`).bind(tenantId).all();
  return { documents: documents.results.map((item) => {
    let previewChunks: string[] = [];
    try { previewChunks = JSON.parse(String(item.previewChunksJson ?? "[]")); } catch { previewChunks = []; }
    return { ...item, previewChunks, previews: previewChunks };
  }) };
}

async function readLessons(context: PlatformContext) {
  const { db, tenantId, userId, roles } = context;
  const plans = roles.includes("admin")
    ? await db.prepare("SELECT * FROM lesson_plans WHERE tenant_id=? AND archived_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 20").bind(tenantId).all()
    : roles.includes("teacher")
      ? await db.prepare("SELECT * FROM lesson_plans WHERE tenant_id=? AND created_by=? AND archived_at IS NULL ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 20").bind(tenantId, userId).all()
      : empty;
  return { lessonPlans: plans.results };
}

async function readMembers(context: PlatformContext) {
  if (!context.roles.includes("admin")) return { members: [], guardianLinks: [], invitations: [] };
  const { db, tenantId } = context;
  const [members, guardianLinks, invitations] = await Promise.all([
    db.prepare(`SELECT u.id,u.email,u.display_name AS displayName,
      CASE WHEN u.status='active' AND SUM(CASE WHEN rm.status='active' THEN 1 ELSE 0 END) > 0 THEN 'active' ELSE 'disabled' END AS status,
      u.must_change_password AS mustChangePassword,group_concat(rm.role) AS roles
      FROM users u JOIN role_memberships rm ON rm.user_id=u.id
      WHERE rm.tenant_id=? GROUP BY u.id ORDER BY u.created_at DESC`).bind(tenantId).all(),
    db.prepare("SELECT guardian_user_id AS guardianUserId,student_user_id AS studentUserId,status,verified_at AS verifiedAt FROM guardian_student_links WHERE tenant_id=? AND status='active' ORDER BY created_at DESC").bind(tenantId).all(),
    db.prepare("SELECT id,email,role,status,expires_at AS expiresAt,created_at AS createdAt FROM invitations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20").bind(tenantId).all(),
  ]);
  return { members: members.results, guardianLinks: guardianLinks.results, invitations: invitations.results };
}

async function readNotifications(context: PlatformContext) {
  const result = await context.db.prepare("SELECT * FROM notifications WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20")
    .bind(context.tenantId, context.userId).all();
  return { notifications: result.results };
}

async function readConsents(context: PlatformContext, focusStudentId: string) {
  const { db, tenantId, userId, roles } = context;
  if (roles.includes("admin")) {
    const result = await db.prepare("SELECT * FROM consent_records WHERE tenant_id=? AND (student_user_id=? OR guardian_user_id=?) ORDER BY created_at DESC")
      .bind(tenantId, focusStudentId, userId).all();
    return { consents: result.results };
  }
  // 授权记录的签署人是历史事实，不能作为监护关系撤销后的持续读取凭据。
  const access = roles.includes("student") && focusStudentId === userId
    ? { sql: "1=1", args: [] }
    : roles.includes("guardian")
      ? { sql: "EXISTS (SELECT 1 FROM guardian_student_links gl WHERE gl.tenant_id=cr.tenant_id AND gl.student_user_id=cr.student_user_id AND gl.guardian_user_id=? AND gl.status='active')", args: [userId] }
      : { sql: "1=0", args: [] };
  const result = await db.prepare(`SELECT cr.* FROM consent_records cr WHERE cr.tenant_id=? AND cr.student_user_id=? AND ${access.sql} ORDER BY cr.created_at DESC`)
    .bind(tenantId, focusStudentId, ...access.args).all();
  return { consents: result.results };
}

async function readAudits(context: PlatformContext) {
  if (!context.roles.includes("admin")) return { audits: [] };
  const result = await context.db.prepare(`SELECT a.*,u.display_name AS actorDisplayName
    FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE a.tenant_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 30`).bind(context.tenantId).all();
  return { audits: result.results };
}

export function workspaceServices(runtime: PlatformRuntime, settings: Awaited<ReturnType<typeof loadPlatformSettings>>) {
  const kind = runtime.kind;
  const databaseLabel = kind === "cloudflare" ? "D1 业务数据库" : kind === "node" ? "SQLite 业务数据库" : "SQL 业务数据库";
  const storageLabel = kind === "cloudflare" ? "R2 文件存储" : kind === "node" ? "本地文件存储" : "文件存储";
  return {
    // 成功读取工作区只证明数据库可读；文件绑定和凭据保存不代表服务探测成功。
    database: { status: runtime.database ? "available" : "unconfigured", label: runtime.database ? databaseLabel : "未配置数据库" },
    storage: { status: runtime.storage ? "configured_unverified" : "unconfigured", label: runtime.storage ? storageLabel + " · 已配置，未验证读写" : "未配置文件存储" },
    retrieval: { status: "built_in", label: "内置知识片段检索" },
    generation: settings.openAiKey || settings.aiKey
      ? { status: "configured_unverified", label: "外部模型凭据已保存，连通性未验证：" + settings.aiModel }
      : { status: "template", label: "来源化教学模板" },
    speech: { status: "manual", label: settings.speechKey ? "语音凭据已保存，评分仍由教师人工评价" : "教师人工评价" },
    moderation: { status: "rules", label: settings.moderationKey ? "审核凭据已保存，当前使用内置基础规则" : "内置基础规则" },
  };
}

async function readSettings(context: PlatformContext) {
  const settings = await loadPlatformSettings(context.db);
  return {
    ...(context.roles.includes("admin") ? { platformSettings: publicPlatformSettings(settings) } : {}),
    services: workspaceServices(getPlatformRuntime(), settings),
  };
}

export async function readWorkspace(context: PlatformContext, options: { sections: ReadonlySet<WorkspaceSection>; studentId?: string }): Promise<WorkspacePatch> {
  const { metadata, focusStudentId } = await readMetadata(context, options.studentId?.trim() ?? "");
  // curriculum 和 progress 共享目标读取；未请求的分组不执行对应查询，也不填空数组覆盖客户端缓存。
  let objectivePromise: Promise<Row[]> | undefined;
  const objectives = () => objectivePromise ??= readObjectives(context);
  const loaders: Record<WorkspaceSection, () => Promise<object>> = {
    teaching: () => readTeaching(context, focusStudentId),
    curriculum: () => readCurriculum(context, objectives),
    progress: () => readProgress(context, focusStudentId, metadata.selectedStudent?.id ?? null, objectives),
    lessons: () => readLessons(context),
    content: () => readContent(context),
    members: () => readMembers(context),
    notifications: () => readNotifications(context),
    consents: () => readConsents(context, focusStudentId),
    audits: () => readAudits(context),
    quality: async () => ({ qualityMetrics: context.roles.includes("admin") ? await qualityMetrics(context.db, context.tenantId) : null }),
    trials: async () => ({ trialEntries: await readTrialEntries(context.db, context) }),
    settings: () => readSettings(context),
  };
  const sections = await Promise.all([...options.sections].map((section) => loaders[section]()));
  return Object.assign(metadata, ...sections);
}
