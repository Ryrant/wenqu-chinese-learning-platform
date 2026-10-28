import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull().default(""),
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
  sessionVersion: integer("session_version").notNull().default(0),
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
  diagnosticMode: text("diagnostic_mode").notNull().default(""), diagnosticPrompt: text("diagnostic_prompt").notNull().default(""), diagnosticMediaId: text("diagnostic_media_id"),
}, (table) => [index("assignments_tenant_idx").on(table.tenantId), index("assignments_class_idx").on(table.classId)]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), assignmentId: text("assignment_id").notNull(), studentUserId: text("student_user_id").notNull(), textAnswer: text("text_answer"), assetKey: text("asset_key"), score: real("score"), confidence: real("confidence"), reviewStatus: text("review_status").notNull().default("auto"), feedback: text("feedback"), reviewedAt: text("reviewed_at"), submittedAt: createdAt(),
  familyTaskId: text("family_task_id"), familyHelpLevel: text("family_help_level"), familyConfirmedAt: text("family_confirmed_at"),
  familySnapshotJson: text("family_snapshot_json").notNull().default("{}"), familyConfirmedBy: text("family_confirmed_by"), familyConfirmationRole: text("family_confirmation_role"),
  sequenceId: text("sequence_id"), sequenceStage: text("sequence_stage"), sequenceSnapshotJson: text("sequence_snapshot_json").notNull().default("{}"),
  diagnosticSnapshotJson: text("diagnostic_snapshot_json").notNull().default("{}"),
}, (table) => [index("submissions_tenant_idx").on(table.tenantId), index("submissions_assignment_idx").on(table.assignmentId), uniqueIndex("family_submission_pending_idx").on(table.tenantId, table.familyTaskId).where(sql`${table.familyTaskId} IS NOT NULL AND ${table.reviewStatus}!='reviewed'`), uniqueIndex("sequence_submission_pending_idx").on(table.tenantId, table.sequenceId, table.sequenceStage).where(sql`${table.sequenceId} IS NOT NULL AND ${table.reviewStatus}!='reviewed'`)]);

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
  objectiveScoresJson: text("objective_scores_json").notNull().default("[]"),
  dimensionScoresJson: text("dimension_scores_json").notNull().default("[]"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  status: text("status", { enum: ["ai_suggested", "confirmed"] }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("submission_reviews_tenant_idx").on(table.tenantId),
  index("submission_reviews_submission_idx").on(table.tenantId, table.submissionId),
]);

export const submissionReviewConfirmations = sqliteTable("submission_review_confirmations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  submissionId: text("submission_id").notNull(),
  reviewerUserId: text("reviewer_user_id").notNull(),
  score: real("score").notNull(),
  comment: text("comment").notNull().default(""),
  confirmedAt: text("confirmed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("submission_review_confirmation_unique_idx").on(table.tenantId, table.submissionId),
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
  ability: text("ability").notNull().default("reading"),
  mediaId: text("media_id"),
  revision: integer("revision").notNull().default(1),
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
  evidenceJson: text("evidence_json").notNull().default("{}"),
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
  assignmentId: text("assignment_id"),
  familyPlanJson: text("family_plan_json").notNull().default("{}"),
  sourceType: text("source_type", { enum: ["diagnostic", "teacher", "family", "system"] }).notNull(),
  sourceId: text("source_id"),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  dueAt: text("due_at"),
  status: text("status", { enum: ["pending", "completed"] }).notNull().default("pending"),
  createdBy: text("created_by").notNull(),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at"),
  archivedAt: text("archived_at"),
  createdAt: createdAt(),
}, (table) => [
  index("learning_recommendations_student_idx").on(table.tenantId, table.studentUserId, table.status, table.dueAt),
  uniqueIndex("learning_recommendation_source_idx").on(table.tenantId, table.studentUserId, table.sourceType, table.sourceId),
]);

export const learningSequences = sqliteTable("learning_sequences", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), studentUserId: text("student_user_id").notNull(),
  assignmentId: text("assignment_id").notNull(), objectiveId: text("objective_id").notNull(), objectiveTitle: text("objective_title").notNull(),
  baselineSubmissionId: text("baseline_submission_id").notNull(), baselineSnapshotJson: text("baseline_snapshot_json").notNull(),
  title: text("title").notNull(), practicePrompt: text("practice_prompt").notNull(), transferPrompt: text("transfer_prompt").notNull(), transferContext: text("transfer_context").notNull(),
  rubricJson: text("rubric_json").notNull(), medium: text("medium").notNull(), createdBy: text("created_by").notNull(), createdAt: createdAt(),
  retestPrompt: text("retest_prompt").notNull().default(""), retestContext: text("retest_context").notNull().default(""),
  retestAvailableAt: text("retest_available_at"), retestReferenceId: text("retest_reference_id"),
}, (table) => [index("learning_sequences_student_idx").on(table.tenantId, table.studentUserId)]);

export const learningSequenceDecisions = sqliteTable("learning_sequence_decisions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), sequenceId: text("sequence_id").notNull(),
  referenceSubmissionId: text("reference_submission_id").notNull(), referenceSnapshotJson: text("reference_snapshot_json").notNull(),
  kind: text("kind").notNull(), rationale: text("rationale").notNull(), remaining: text("remaining").notNull(),
  nextSequenceId: text("next_sequence_id").notNull(), createdBy: text("created_by").notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex("sequence_decision_reference_idx").on(table.tenantId, table.sequenceId, table.referenceSubmissionId), uniqueIndex("sequence_decision_next_idx").on(table.tenantId, table.nextSequenceId)]);

export const learningTrialRecords = sqliteTable("learning_trial_records", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), sequenceId: text("sequence_id").notNull(),
  kind: text("kind").notNull(), method: text("method"), minutes: integer("minutes"), referenceSubmissionId: text("reference_submission_id"), referenceTitle: text("reference_title"),
  note: text("note").notNull(), createdBy: text("created_by").notNull(), createdAt: createdAt(),
  voidedAt: text("voided_at"), voidedBy: text("voided_by"), voidReason: text("void_reason"),
}, (table) => [index("trial_records_sequence_idx").on(table.tenantId, table.sequenceId, table.createdAt)]);

export const familyUsabilityFeedback = sqliteTable("family_usability_feedback", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), familyTaskId: text("family_task_id").notNull(),
  studentUserId: text("student_user_id").notNull(), assignmentId: text("assignment_id"), classId: text("class_id"),
  taskRevision: integer("task_revision").notNull(), taskSnapshotJson: text("task_snapshot_json").notNull(),
  participation: text("participation").notNull(), instructions: text("instructions").notNull(), operationHelp: text("operation_help").notNull(), alternative: text("alternative").notNull(),
  note: text("note").notNull().default(""), createdBy: text("created_by").notNull(), createdAt: createdAt(),
  voidedAt: text("voided_at"), voidedBy: text("voided_by"), voidReason: text("void_reason"),
  responseId: text("response_id"), followupOutcome: text("followup_outcome"),
}, (table) => [index("family_feedback_task_idx").on(table.tenantId, table.familyTaskId, table.createdAt), index("family_feedback_response_idx").on(table.tenantId, table.responseId, table.createdAt)]);

export const learningTrialBatches = sqliteTable("learning_trial_batches", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), classId: text("class_id").notNull(),
  title: text("title").notNull(), scopeJson: text("scope_json").notNull(), requestJson: text("request_json").notNull(),
  revision: integer("revision").notNull().default(1), createdBy: text("created_by").notNull(), createdAt: createdAt(),
  voidedAt: text("voided_at"), voidedBy: text("voided_by"), voidReason: text("void_reason"),
}, (table) => [index("trial_batches_class_idx").on(table.tenantId, table.classId, table.createdAt)]);

export const familyFeedbackResponses = sqliteTable("family_feedback_responses", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), feedbackId: text("feedback_id").notNull(),
  kind: text("kind").notNull(), detail: text("detail").notNull(), createdBy: text("created_by").notNull(), createdAt: createdAt(),
  voidedAt: text("voided_at"), voidedBy: text("voided_by"), voidReason: text("void_reason"),
}, (table) => [index("feedback_responses_source_idx").on(table.tenantId, table.feedbackId, table.createdAt)]);

export const masterySnapshots = sqliteTable("mastery_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }), tenantId: text("tenant_id").notNull(), studentUserId: text("student_user_id").notNull(), objectiveId: text("objective_id").notNull(), mastery: real("mastery").notNull(), evidenceCount: integer("evidence_count").notNull().default(0), measuredAt: createdAt(),
}, (table) => [index("mastery_student_idx").on(table.tenantId, table.studentUserId)]);

export const sourceDocuments = sqliteTable("source_documents", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), title: text("title").notNull(), objectKey: text("object_key"), mediaType: text("media_type").notNull(), rightsStatus: text("rights_status").notNull().default("pending"), processingStatus: text("processing_status").notNull().default("uploaded"), processingError: text("processing_error"), version: integer("version").notNull().default(1), createdBy: text("created_by").notNull(), updatedAt: text("updated_at"), archivedAt: text("archived_at"), createdAt: createdAt(),
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
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), title: text("title").notNull(), topic: text("topic").notNull(), level: text("level").notNull(), durationMinutes: integer("duration_minutes").notNull(), objectivesJson: text("objectives_json").notNull().default("[]"), activitiesJson: text("activities_json").notNull().default("[]"), citationsJson: text("citations_json").notNull().default("[]"), status: text("status").notNull().default("draft"), createdBy: text("created_by").notNull(), updatedAt: text("updated_at"), archivedAt: text("archived_at"), createdAt: createdAt(),
}, (table) => [index("lesson_plans_tenant_idx").on(table.tenantId, table.createdAt)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), title: text("title").notNull(), detail: text("detail").notNull(), kind: text("kind").notNull().default("info"), readAt: text("read_at"), scheduledFor: text("scheduled_for"), createdAt: createdAt(),
}, (table) => [index("notifications_user_idx").on(table.tenantId, table.userId, table.createdAt)]);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), email: text("email").notNull(), role: text("role").notNull(), token: text("token").notNull(), status: text("status").notNull().default("pending"), invitedBy: text("invited_by").notNull(), expiresAt: text("expires_at").notNull(), createdAt: createdAt(),
}, (table) => [index("invitations_tenant_idx").on(table.tenantId, table.createdAt), uniqueIndex("invitations_token_idx").on(table.token)]);

export const studentVocabulary = sqliteTable("student_vocabulary", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), lessonId: text("lesson_id").notNull(), lessonTitle: text("lesson_title").notNull(), word: text("word").notNull(), pinyin: text("pinyin").notNull(), meaning: text("meaning").notNull(), example: text("example").notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex("student_vocabulary_owner_idx").on(table.tenantId, table.userId, table.lessonId, table.word)]);

export const dialogueScenarios = sqliteTable("dialogue_scenarios", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), classId: text("class_id").notNull(), title: text("title").notNull(), contentJson: text("content_json").notNull(), status: text("status").notNull().default("published"), revision: integer("revision").notNull().default(1), createdBy: text("created_by").notNull(), createdAt: createdAt(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("dialogue_scenarios_class_idx").on(table.tenantId, table.classId, table.status)]);

export const practiceRecords = sqliteTable("practice_records", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), kind: text("kind").notNull(), referenceId: text("reference_id").notNull(), journeyRunId: text("journey_run_id"), title: text("title").notNull(), snapshotJson: text("snapshot_json").notNull(), payloadJson: text("payload_json").notNull(), resultJson: text("result_json").notNull(), createdAt: createdAt(),
}, (table) => [index("practice_records_owner_idx").on(table.tenantId, table.userId, table.kind, table.createdAt), index("practice_records_journey_idx").on(table.tenantId, table.userId, table.journeyRunId)]);

export const journeyRuns = sqliteTable("journey_runs", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), scenarioId: text("scenario_id").notNull(), classId: text("class_id").notNull(), snapshotJson: text("snapshot_json").notNull(), dialogueSessionId: text("dialogue_session_id").notNull(), stage: integer("stage").notNull().default(0), createdAt: createdAt(),
}, (table) => [index("journey_runs_owner_idx").on(table.tenantId, table.userId, table.createdAt), uniqueIndex("journey_runs_dialogue_idx").on(table.dialogueSessionId)]);

export const vocabularyReviewState = sqliteTable("vocabulary_review_state", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), vocabularyId: text("vocabulary_id").notNull(), stage: integer("stage").notNull().default(0), dueAt: text("due_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("vocabulary_review_word_idx").on(table.tenantId, table.userId, table.vocabularyId)]);

export const teacherReadingLessons = sqliteTable("teacher_reading_lessons", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), classId: text("class_id").notNull(), title: text("title").notNull(), level: text("level").notNull(), contentJson: text("content_json").notNull(), status: text("status").notNull().default("draft"), revision: integer("revision").notNull().default(1), createdBy: text("created_by").notNull(), createdAt: createdAt(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("teacher_reading_lessons_class_idx").on(table.tenantId, table.classId, table.status)]);

export const dictationSessions = sqliteTable("dictation_sessions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), sourceJson: text("source_json").notNull(), snapshotJson: text("snapshot_json").notNull(), payloadJson: text("payload_json").notNull(), stateJson: text("state_json").notNull(), revision: integer("revision").notNull().default(0), createdAt: createdAt(), completedAt: text("completed_at"),
}, (table) => [index("dictation_sessions_owner_idx").on(table.tenantId, table.userId, table.createdAt), uniqueIndex("dictation_sessions_active_idx").on(table.tenantId, table.userId).where(sql`completed_at IS NULL`)]);

export const vocabularyReviewSessions = sqliteTable("vocabulary_review_sessions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), mode: text("mode").notNull(), snapshotJson: text("snapshot_json").notNull(), stateJson: text("state_json").notNull(), revision: integer("revision").notNull().default(0), createdAt: createdAt(), completedAt: text("completed_at"),
}, (table) => [index("vocabulary_review_sessions_owner_idx").on(table.tenantId, table.userId, table.createdAt), uniqueIndex("vocabulary_review_active_idx").on(table.tenantId, table.userId).where(sql`completed_at IS NULL`)]);

export const dialogueSessions = sqliteTable("dialogue_sessions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), userId: text("user_id").notNull(), classId: text("class_id").notNull(), scenarioId: text("scenario_id").notNull(), snapshotJson: text("snapshot_json").notNull(), turnsJson: text("turns_json").notNull(), step: integer("step").notNull().default(0), hintCount: integer("hint_count").notNull().default(0), revision: integer("revision").notNull().default(1), pendingRequestId: text("pending_request_id"), pendingText: text("pending_text"), pendingAt: text("pending_at"), createdAt: createdAt(), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("dialogue_sessions_owner_idx").on(table.tenantId, table.userId, table.createdAt), index("dialogue_sessions_class_idx").on(table.tenantId, table.classId, table.createdAt)]);
