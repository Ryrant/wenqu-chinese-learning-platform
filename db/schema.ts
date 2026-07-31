import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull().default("sg"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  locale: text("locale").notNull().default("zh-CN"),
  passwordHash: text("password_hash"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  lastLoginAt: text("last_login_at"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("users_email_idx").on(table.email)]);

export const roleMemberships = sqliteTable("role_memberships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["student", "teacher", "guardian", "admin", "reviewer"] }).notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: createdAt(),
}, (table) => [index("memberships_tenant_idx").on(table.tenantId), uniqueIndex("membership_unique_idx").on(table.tenantId, table.userId, table.role)]);

export const guardianStudentLinks = sqliteTable("guardian_student_links", {
  id: integer("id").primaryKey({ autoIncrement: true }), tenantId: text("tenant_id").notNull(), guardianUserId: text("guardian_user_id").notNull(), studentUserId: text("student_user_id").notNull(), verifiedAt: text("verified_at"), status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"), createdAt: createdAt(),
}, (table) => [index("guardian_links_tenant_idx").on(table.tenantId)]);

export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), name: text("name").notNull(), level: text("level").notNull(), teacherUserId: text("teacher_user_id").notNull(), academicYear: text("academic_year").notNull(), createdAt: createdAt(),
}, (table) => [index("classes_tenant_idx").on(table.tenantId)]);

export const enrollments = sqliteTable("enrollments", {
  id: integer("id").primaryKey({ autoIncrement: true }), tenantId: text("tenant_id").notNull(), classId: text("class_id").notNull(), studentUserId: text("student_user_id").notNull(), status: text("status").notNull().default("active"), createdAt: createdAt(),
}, (table) => [index("enrollments_tenant_idx").on(table.tenantId), uniqueIndex("enrollment_unique_idx").on(table.tenantId, table.classId, table.studentUserId)]);

export const learningObjectives = sqliteTable("learning_objectives", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), code: text("code").notNull(), title: text("title").notNull(), skill: text("skill").notNull(), level: text("level").notNull(), status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"), createdAt: createdAt(),
}, (table) => [index("objectives_tenant_idx").on(table.tenantId)]);

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), classId: text("class_id").notNull(), title: text("title").notNull(), activityType: text("activity_type").notNull(), status: text("status", { enum: ["draft", "review", "published", "closed"] }).notNull().default("draft"), dueAt: text("due_at"), rubricJson: text("rubric_json").notNull().default("[]"), createdBy: text("created_by").notNull(), publishedAt: text("published_at"), createdAt: createdAt(),
}, (table) => [index("assignments_tenant_idx").on(table.tenantId), index("assignments_class_idx").on(table.classId)]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), assignmentId: text("assignment_id").notNull(), studentUserId: text("student_user_id").notNull(), textAnswer: text("text_answer"), assetKey: text("asset_key"), score: real("score"), confidence: real("confidence"), reviewStatus: text("review_status").notNull().default("auto"), feedback: text("feedback"), reviewedAt: text("reviewed_at"), submittedAt: createdAt(),
}, (table) => [index("submissions_tenant_idx").on(table.tenantId), index("submissions_assignment_idx").on(table.assignmentId)]);

export const submissionReviews = sqliteTable("submission_reviews", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  submissionId: text("submission_id").notNull(),
  reviewerUserId: text("reviewer_user_id").notNull(),
  finalScore: real("final_score"),
  finalComment: text("final_comment"),
  aiSuggestedScore: real("ai_suggested_score"),
  aiComment: text("ai_comment"),
  weaknessTagsJson: text("weakness_tags_json").notNull().default("[]"),
  status: text("status", { enum: ["ai_suggested", "confirmed"] }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("submission_reviews_tenant_idx").on(table.tenantId),
  index("submission_reviews_submission_idx").on(table.tenantId, table.submissionId),
]);

export const assignmentObjectives = sqliteTable("assignment_objectives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  assignmentId: text("assignment_id").notNull(),
  objectiveId: text("objective_id").notNull(),
  weight: real("weight").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [
  index("assignment_objectives_assignment_idx").on(table.tenantId, table.assignmentId),
  uniqueIndex("assignment_objective_unique_idx").on(table.tenantId, table.assignmentId, table.objectiveId),
]);

export const diagnosticItems = sqliteTable("diagnostic_items", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  objectiveId: text("objective_id").notNull(),
  level: text("level").notNull(),
  prompt: text("prompt").notNull(),
  optionsJson: text("options_json").notNull(),
  correctOption: integer("correct_option").notNull(),
  explanation: text("explanation").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("diagnostic_items_tenant_idx").on(table.tenantId, table.level, table.status),
  index("diagnostic_items_objective_idx").on(table.tenantId, table.objectiveId),
]);

export const diagnosticAttempts = sqliteTable("diagnostic_attempts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  studentUserId: text("student_user_id").notNull(),
  level: text("level").notNull(),
  score: real("score").notNull(),
  status: text("status", { enum: ["completed"] }).notNull().default("completed"),
  completedAt: text("completed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: createdAt(),
}, (table) => [index("diagnostic_attempts_student_idx").on(table.tenantId, table.studentUserId, table.completedAt)]);

export const diagnosticAnswers = sqliteTable("diagnostic_answers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  itemId: text("item_id").notNull(),
  selectedOption: integer("selected_option").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("diagnostic_answers_attempt_idx").on(table.tenantId, table.attemptId),
  uniqueIndex("diagnostic_answer_unique_idx").on(table.tenantId, table.attemptId, table.itemId),
]);

export const learningRecommendations = sqliteTable("learning_recommendations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  studentUserId: text("student_user_id").notNull(),
  objectiveId: text("objective_id"),
  sourceType: text("source_type", { enum: ["diagnostic", "teacher", "family", "system"] }).notNull(),
  sourceId: text("source_id"),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  dueAt: text("due_at"),
  status: text("status", { enum: ["pending", "completed"] }).notNull().default("pending"),
  createdBy: text("created_by").notNull(),
  completedAt: text("completed_at"),
  createdAt: createdAt(),
}, (table) => [
  index("learning_recommendations_student_idx").on(table.tenantId, table.studentUserId, table.status, table.dueAt),
  uniqueIndex("learning_recommendation_source_idx").on(table.tenantId, table.studentUserId, table.sourceType, table.sourceId),
]);

export const masterySnapshots = sqliteTable("mastery_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }), tenantId: text("tenant_id").notNull(), studentUserId: text("student_user_id").notNull(), objectiveId: text("objective_id").notNull(), mastery: real("mastery").notNull(), evidenceCount: integer("evidence_count").notNull().default(0), measuredAt: createdAt(),
}, (table) => [index("mastery_student_idx").on(table.tenantId, table.studentUserId)]);

export const sourceDocuments = sqliteTable("source_documents", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), title: text("title").notNull(), objectKey: text("object_key"), mediaType: text("media_type").notNull(), rightsStatus: text("rights_status").notNull().default("pending"), processingStatus: text("processing_status").notNull().default("uploaded"), processingError: text("processing_error"), version: integer("version").notNull().default(1), createdBy: text("created_by").notNull(), createdAt: createdAt(),
}, (table) => [index("source_documents_tenant_idx").on(table.tenantId)]);

export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), sourceDocumentId: text("source_document_id").notNull(), content: text("content").notNull(), metadataJson: text("metadata_json").notNull().default("{}"), published: integer("published", { mode: "boolean" }).notNull().default(false), createdAt: createdAt(),
}, (table) => [index("chunks_tenant_source_idx").on(table.tenantId, table.sourceDocumentId)]);

export const knowledgeEntities = sqliteTable("knowledge_entities", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), name: text("name").notNull(), entityType: text("entity_type").notNull(), description: text("description").notNull().default(""), createdAt: createdAt(),
}, (table) => [index("entities_tenant_idx").on(table.tenantId)]);

export const citations = sqliteTable("citations", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), aiSessionId: text("ai_session_id").notNull(), knowledgeChunkId: text("knowledge_chunk_id").notNull(), quote: text("quote").notNull(), createdAt: createdAt(),
}, (table) => [index("citations_session_idx").on(table.tenantId, table.aiSessionId)]);

export const aiSessions = sqliteTable("ai_sessions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), purpose: text("purpose").notNull(), provider: text("provider").notNull(), model: text("model").notNull(), status: text("status").notNull(), inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), createdAt: createdAt(),
}, (table) => [index("ai_sessions_tenant_idx").on(table.tenantId)]);

export const consentRecords = sqliteTable("consent_records", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), studentUserId: text("student_user_id").notNull(), guardianUserId: text("guardian_user_id").notNull(), scope: text("scope").notNull(), status: text("status").notNull(), expiresAt: text("expires_at"), createdAt: createdAt(),
}, (table) => [index("consent_student_idx").on(table.tenantId, table.studentUserId)]);

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), targetType: text("target_type").notNull(), targetId: text("target_id").notNull(), rating: integer("rating").notNull(), correction: text("correction"), createdAt: createdAt(),
}, (table) => [index("feedback_tenant_idx").on(table.tenantId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), actorUserId: text("actor_user_id").notNull(), action: text("action").notNull(), targetType: text("target_type").notNull(), targetId: text("target_id").notNull(), detailJson: text("detail_json").notNull().default("{}"), createdAt: createdAt(),
}, (table) => [index("audit_tenant_created_idx").on(table.tenantId, table.createdAt)]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const lessonPlans = sqliteTable("lesson_plans", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), title: text("title").notNull(), topic: text("topic").notNull(), level: text("level").notNull(), durationMinutes: integer("duration_minutes").notNull(), objectivesJson: text("objectives_json").notNull().default("[]"), activitiesJson: text("activities_json").notNull().default("[]"), citationsJson: text("citations_json").notNull().default("[]"), status: text("status").notNull().default("draft"), createdBy: text("created_by").notNull(), createdAt: createdAt(),
}, (table) => [index("lesson_plans_tenant_idx").on(table.tenantId, table.createdAt)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), title: text("title").notNull(), detail: text("detail").notNull(), kind: text("kind").notNull().default("info"), readAt: text("read_at"), scheduledFor: text("scheduled_for"), createdAt: createdAt(),
}, (table) => [index("notifications_user_idx").on(table.tenantId, table.userId, table.createdAt)]);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), email: text("email").notNull(), role: text("role").notNull(), token: text("token").notNull(), status: text("status").notNull().default("pending"), invitedBy: text("invited_by").notNull(), expiresAt: text("expires_at").notNull(), createdAt: createdAt(),
}, (table) => [index("invitations_tenant_idx").on(table.tenantId, table.createdAt), uniqueIndex("invitations_token_idx").on(table.token)]);
