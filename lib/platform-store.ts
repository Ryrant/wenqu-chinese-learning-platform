import { sessionCookieName, verifySessionToken } from "./auth-token";
import { ensurePlatformRuntime, type PlatformDatabase } from "./platform-runtime";
import { createInitialAdminAccount } from "./standard-login";
import { cleanupLegacyDemoRoles } from "./legacy-demo-roles";
import { cleanupLegacyWorkspaceMetadata } from "./legacy-workspace-metadata";

export { cleanupLegacyDemoRoles } from "./legacy-demo-roles";

export type PlatformRole = "student" | "teacher" | "guardian" | "admin";
export type AuthMode = "standard" | "local";
export type PlatformContext = { db: PlatformDatabase; tenantId: string; userId: string; userEmail: string; displayName: string; roles: PlatformRole[]; mustChangePassword?: boolean };
const ROLE_SET = new Set<PlatformRole>(["student", "teacher", "guardian", "admin"]);
const schemaReady = new WeakMap<PlatformDatabase, Promise<void>>();

export function getAuthMode(): AuthMode {
  return process.env.NODE_ENV === "development" ? "local" : "standard";
}

function localIdentity(request: Request) {
  const email = request.headers.get("x-huawen-zhixing-dev-user")?.trim().toLowerCase()
    ?? "dev@huawen-zhixing.local";
  return { email, displayName: email.split("@")[0] };
}

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  // Session cookie: huawen_zhixing_session.
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
  if (!match) return "";
  try {
    return decodeURIComponent(match.slice(sessionCookieName.length + 1));
  } catch {
    return "";
  }
}

async function standardIdentity(request: Request, db: PlatformDatabase) {
  const token = tokenFromRequest(request);
  if (!token) throw new Error("authentication_required");
  const session = await verifySessionToken(token, await ensureSiteJwtSecret(db));
  if (!session) throw new Error("authentication_required");
  return { email: session.email.trim().toLowerCase(), displayName: session.displayName, sessionVersion: session.sessionVersion ?? 0 };
}

async function identity(request: Request, db: PlatformDatabase) {
  const mode = getAuthMode();
  if (mode === "standard") return standardIdentity(request, db);
  return localIdentity(request);
}

async function trySchema(db: PlatformDatabase, sql: string) {
  try {
    await db.prepare(sql).run();
  } catch (error) {
    if (error instanceof Error && /duplicate column name|already exists/i.test(error.message)) return;
    throw error;
  }
}

async function ensureCoreSchema(db: PlatformDatabase) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'zh-CN', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS role_memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS memberships_tenant_idx ON role_memberships (tenant_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS membership_unique_idx ON role_memberships (tenant_id,user_id,role)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS guardian_student_links (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, guardian_user_id TEXT NOT NULL, student_user_id TEXT NOT NULL, verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS guardian_links_tenant_idx ON guardian_student_links (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL, teacher_user_id TEXT NOT NULL, academic_year TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS classes_tenant_idx ON classes (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, class_id TEXT NOT NULL, student_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS enrollments_tenant_idx ON enrollments (tenant_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS enrollment_unique_idx ON enrollments (tenant_id,class_id,student_user_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS learning_objectives (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL, skill TEXT NOT NULL, level TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS objectives_tenant_idx ON learning_objectives (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, class_id TEXT NOT NULL, title TEXT NOT NULL, activity_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', due_at TEXT, rubric_json TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL, published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS assignments_tenant_idx ON assignments (tenant_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS assignments_class_idx ON assignments (class_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, assignment_id TEXT NOT NULL, student_user_id TEXT NOT NULL, text_answer TEXT, asset_key TEXT, score REAL, confidence REAL, review_status TEXT NOT NULL DEFAULT 'auto', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS submissions_tenant_idx ON submissions (tenant_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS submissions_assignment_idx ON submissions (assignment_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS mastery_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, student_user_id TEXT NOT NULL, objective_id TEXT NOT NULL, mastery REAL NOT NULL, evidence_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS mastery_student_idx ON mastery_snapshots (tenant_id,student_user_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS source_documents (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, object_key TEXT, media_type TEXT NOT NULL, rights_status TEXT NOT NULL DEFAULT 'pending', processing_status TEXT NOT NULL DEFAULT 'uploaded', version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, updated_at TEXT, archived_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS source_documents_tenant_idx ON source_documents (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_chunks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source_document_id TEXT NOT NULL, content TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS chunks_tenant_source_idx ON knowledge_chunks (tenant_id,source_document_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS knowledge_entities (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, entity_type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS entities_tenant_idx ON knowledge_entities (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_sessions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, purpose TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS ai_sessions_tenant_idx ON ai_sessions (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS citations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ai_session_id TEXT NOT NULL, knowledge_chunk_id TEXT NOT NULL, quote TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS citations_session_idx ON citations (tenant_id,ai_session_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS consent_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_user_id TEXT NOT NULL, guardian_user_id TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS consent_student_idx ON consent_records (tenant_id,student_user_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, rating INTEGER NOT NULL, correction TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS feedback_tenant_idx ON feedback (tenant_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS audit_tenant_created_idx ON audit_logs (tenant_id,created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
  ]);
  for (const statement of [
    "ALTER TABLE users ADD COLUMN password_hash TEXT",
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE users ADD COLUMN last_login_at TEXT",
    "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE role_memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE guardian_student_links ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE source_documents ADD COLUMN processing_error TEXT",
    "ALTER TABLE source_documents ADD COLUMN updated_at TEXT",
    "ALTER TABLE source_documents ADD COLUMN archived_at TEXT",
    "ALTER TABLE submissions ADD COLUMN feedback TEXT",
    "ALTER TABLE submissions ADD COLUMN reviewed_at TEXT",
    "ALTER TABLE learning_objectives ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE assignments ADD COLUMN rubric_json TEXT NOT NULL DEFAULT '[]'",
  ]) await trySchema(db, statement);
}

export async function ensurePlatformSchema(db: PlatformDatabase) {
  const cached = schemaReady.get(db);
  if (cached) {
    await cached;
    return;
  }
  const pending = (async () => {
    await ensureCoreSchema(db);
    await ensureExtendedSchema(db);
    await cleanupLegacyDemoRoles(db);
    await cleanupLegacyWorkspaceMetadata(db);
  })().catch((error) => {
    schemaReady.delete(db);
    throw error;
  });
  schemaReady.set(db, pending);
  await pending;
}

export async function isInitialSetupRequired(db: PlatformDatabase) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return Number(row?.count ?? 0) === 0;
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ensureSiteJwtSecret(db: PlatformDatabase) {
  const stored = await db.prepare("SELECT value FROM app_settings WHERE key='jwt_secret'").first<{ value: string }>();
  if (stored?.value) return stored.value;
  const generated = randomSecret();
  await db.prepare("INSERT OR IGNORE INTO app_settings (key,value) VALUES ('jwt_secret',?)").bind(generated).run();
  const saved = await db.prepare("SELECT value FROM app_settings WHERE key='jwt_secret'").first<{ value: string }>();
  return saved?.value ?? generated;
}
async function ensureExtendedSchema(db: PlatformDatabase) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS lesson_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, topic TEXT NOT NULL, level TEXT NOT NULL, duration_minutes INTEGER NOT NULL, objectives_json TEXT NOT NULL DEFAULT '[]', activities_json TEXT NOT NULL DEFAULT '[]', citations_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', created_by TEXT NOT NULL, updated_at TEXT, archived_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS lesson_plans_tenant_idx ON lesson_plans (tenant_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info', read_at TEXT, scheduled_for TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (tenant_id, user_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', invited_by TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS invitations_tenant_idx ON invitations (tenant_id,created_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token)"),
  ]);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS submission_reviews (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, submission_id TEXT NOT NULL, reviewer_user_id TEXT NOT NULL, final_score REAL, final_comment TEXT, ai_suggested_score REAL, ai_comment TEXT, weakness_tags_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS submission_reviews_tenant_idx ON submission_reviews (tenant_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS submission_reviews_submission_idx ON submission_reviews (tenant_id,submission_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS submission_review_confirmations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, submission_id TEXT NOT NULL, reviewer_user_id TEXT NOT NULL, score REAL NOT NULL, comment TEXT NOT NULL DEFAULT '', confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS submission_review_confirmation_unique_idx ON submission_review_confirmations (tenant_id,submission_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS assignment_objectives (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, assignment_id TEXT NOT NULL, objective_id TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS assignment_objectives_assignment_idx ON assignment_objectives (tenant_id,assignment_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS assignment_objective_unique_idx ON assignment_objectives (tenant_id,assignment_id,objective_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS diagnostic_items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, objective_id TEXT NOT NULL, level TEXT NOT NULL, prompt TEXT NOT NULL, options_json TEXT NOT NULL, correct_option INTEGER NOT NULL, explanation TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS diagnostic_items_tenant_idx ON diagnostic_items (tenant_id,level,status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS diagnostic_items_objective_idx ON diagnostic_items (tenant_id,objective_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS diagnostic_attempts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_user_id TEXT NOT NULL, level TEXT NOT NULL, score REAL NOT NULL, status TEXT NOT NULL DEFAULT 'completed', completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS diagnostic_attempts_student_idx ON diagnostic_attempts (tenant_id,student_user_id,completed_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS diagnostic_answers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, attempt_id TEXT NOT NULL, item_id TEXT NOT NULL, selected_option INTEGER NOT NULL, is_correct INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS diagnostic_answers_attempt_idx ON diagnostic_answers (tenant_id,attempt_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS diagnostic_answer_unique_idx ON diagnostic_answers (tenant_id,attempt_id,item_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS learning_recommendations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_user_id TEXT NOT NULL, objective_id TEXT, source_type TEXT NOT NULL, source_id TEXT, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', due_at TEXT, status TEXT NOT NULL DEFAULT 'pending', created_by TEXT NOT NULL, completed_at TEXT, updated_at TEXT, archived_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS learning_recommendations_student_idx ON learning_recommendations (tenant_id,student_user_id,status,due_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS learning_recommendation_source_idx ON learning_recommendations (tenant_id,student_user_id,source_type,source_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS learning_sequences (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_user_id TEXT NOT NULL, assignment_id TEXT NOT NULL, objective_id TEXT NOT NULL, objective_title TEXT NOT NULL, baseline_submission_id TEXT NOT NULL, baseline_snapshot_json TEXT NOT NULL, title TEXT NOT NULL, practice_prompt TEXT NOT NULL, transfer_prompt TEXT NOT NULL, transfer_context TEXT NOT NULL, rubric_json TEXT NOT NULL, medium TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS learning_sequences_student_idx ON learning_sequences (tenant_id,student_user_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS learning_sequence_decisions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sequence_id TEXT NOT NULL, reference_submission_id TEXT NOT NULL, reference_snapshot_json TEXT NOT NULL, kind TEXT NOT NULL, rationale TEXT NOT NULL, remaining TEXT NOT NULL, next_sequence_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS sequence_decision_reference_idx ON learning_sequence_decisions (tenant_id,sequence_id,reference_submission_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS sequence_decision_next_idx ON learning_sequence_decisions (tenant_id,next_sequence_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS learning_trial_records (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sequence_id TEXT NOT NULL, kind TEXT NOT NULL, method TEXT, minutes INTEGER, reference_submission_id TEXT, reference_title TEXT, note TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_at TEXT, voided_by TEXT, void_reason TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS trial_records_sequence_idx ON learning_trial_records (tenant_id,sequence_id,created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS family_usability_feedback (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, family_task_id TEXT NOT NULL, student_user_id TEXT NOT NULL, assignment_id TEXT, class_id TEXT, task_revision INTEGER NOT NULL, task_snapshot_json TEXT NOT NULL, participation TEXT NOT NULL, instructions TEXT NOT NULL, operation_help TEXT NOT NULL, alternative TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_at TEXT, voided_by TEXT, void_reason TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS family_feedback_task_idx ON family_usability_feedback (tenant_id,family_task_id,created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS learning_trial_batches (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, class_id TEXT NOT NULL, title TEXT NOT NULL, scope_json TEXT NOT NULL, request_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_at TEXT, voided_by TEXT, void_reason TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS trial_batches_class_idx ON learning_trial_batches (tenant_id,class_id,created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS family_feedback_responses (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, feedback_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_at TEXT, voided_by TEXT, void_reason TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS feedback_responses_source_idx ON family_feedback_responses (tenant_id,feedback_id,created_at)"),
  ]);
  for (const statement of [
    "ALTER TABLE lesson_plans ADD COLUMN updated_at TEXT",
    "ALTER TABLE lesson_plans ADD COLUMN archived_at TEXT",
    "ALTER TABLE learning_recommendations ADD COLUMN updated_at TEXT",
    "ALTER TABLE learning_recommendations ADD COLUMN archived_at TEXT",
    "ALTER TABLE submission_reviews ADD COLUMN objective_scores_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE submission_reviews ADD COLUMN dimension_scores_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE learning_recommendations ADD COLUMN assignment_id TEXT",
    "ALTER TABLE submissions ADD COLUMN family_task_id TEXT",
    "ALTER TABLE submissions ADD COLUMN family_help_level TEXT",
    "ALTER TABLE submissions ADD COLUMN family_confirmed_at TEXT",
    "ALTER TABLE diagnostic_items ADD COLUMN ability TEXT NOT NULL DEFAULT 'reading'",
    "ALTER TABLE diagnostic_items ADD COLUMN media_id TEXT",
    "ALTER TABLE diagnostic_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE diagnostic_answers ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE assignments ADD COLUMN diagnostic_mode TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE assignments ADD COLUMN diagnostic_prompt TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE assignments ADD COLUMN diagnostic_media_id TEXT",
    "ALTER TABLE submissions ADD COLUMN diagnostic_snapshot_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE learning_recommendations ADD COLUMN family_plan_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE submissions ADD COLUMN family_snapshot_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE submissions ADD COLUMN family_confirmed_by TEXT",
    "ALTER TABLE submissions ADD COLUMN family_confirmation_role TEXT",
    "ALTER TABLE submissions ADD COLUMN sequence_id TEXT",
    "ALTER TABLE submissions ADD COLUMN sequence_stage TEXT",
    "ALTER TABLE submissions ADD COLUMN sequence_snapshot_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE submission_reviews ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE learning_sequences ADD COLUMN retest_prompt TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE learning_sequences ADD COLUMN retest_context TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE learning_sequences ADD COLUMN retest_available_at TEXT",
    "ALTER TABLE learning_sequences ADD COLUMN retest_reference_id TEXT",
    "ALTER TABLE family_usability_feedback ADD COLUMN response_id TEXT",
    "ALTER TABLE family_usability_feedback ADD COLUMN followup_outcome TEXT",
  ]) await trySchema(db, statement);
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS family_feedback_response_idx ON family_usability_feedback (tenant_id,response_id,created_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS family_submission_pending_idx ON submissions (tenant_id,family_task_id) WHERE family_task_id IS NOT NULL AND review_status!='reviewed'"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS sequence_submission_pending_idx ON submissions (tenant_id,sequence_id,sequence_stage) WHERE sequence_id IS NOT NULL AND review_status!='reviewed'"),
    db.prepare("UPDATE lesson_plans SET updated_at=created_at WHERE updated_at IS NULL"),
    db.prepare("UPDATE learning_recommendations SET updated_at=created_at WHERE updated_at IS NULL"),
    db.prepare("UPDATE source_documents SET updated_at=created_at WHERE updated_at IS NULL"),
  ]);
}

export async function platformContext(request: Request, requiredRole?: PlatformRole, options: { allowPasswordChange?: boolean } = {}): Promise<PlatformContext> {
  const db = (await ensurePlatformRuntime()).database;
  if (!db) throw new Error("database_unavailable");
  await ensurePlatformSchema(db);
  const principal = await identity(request, db);
  const { email, displayName } = principal;
  // 仅空库的默认本地测试身份可初始化管理员，其他请求不能自动创建账号或授权。
  if (getAuthMode() === "local" && email === "dev@huawen-zhixing.local" && await isInitialSetupRequired(db)) {
    await createInitialAdminAccount({ db, email, displayName, password: randomSecret() });
  }
  const account = await db.prepare(`SELECT id,email,display_name AS displayName,
    must_change_password AS mustChangePassword,session_version AS sessionVersion,status FROM users WHERE lower(email)=? LIMIT 1`)
    .bind(email).first<{ id: string; email: string; displayName: string; mustChangePassword: number; sessionVersion: number; status: string }>();
  if (!account || account.status !== "active") throw new Error("account_access_denied");
  // 旧令牌按版本 0 兼容；改密或重置后递增版本，撤销该账号此前签发的全部会话。
  if ("sessionVersion" in principal && principal.sessionVersion !== account.sessionVersion) throw new Error("authentication_required");
  const memberships = await db.prepare(`SELECT rm.tenant_id AS tenantId,rm.role
    FROM role_memberships rm JOIN tenants t ON t.id=rm.tenant_id AND t.status='active'
    WHERE rm.user_id=? AND rm.status='active' AND rm.role IN ('student','teacher','guardian','admin')
    ORDER BY rm.created_at ASC,rm.id ASC`).bind(account.id).all<{ tenantId: string; role: PlatformRole }>();
  const tenantId = memberships.results[0]?.tenantId;
  if (!tenantId) throw new Error("account_access_denied");
  const roles = memberships.results.filter((item) => item.tenantId === tenantId)
    .map((item) => item.role).filter((role) => ROLE_SET.has(role));
  if (!roles.length) throw new Error("account_access_denied");
  if (getAuthMode() === "standard" && account.mustChangePassword === 1 && !options.allowPasswordChange) throw new Error("password_change_required");
  if (requiredRole && !roles.includes(requiredRole) && !roles.includes("admin")) throw new Error("forbidden");
  return { db, tenantId, userId: account.id, userEmail: account.email, displayName: account.displayName,
    roles, mustChangePassword: account.mustChangePassword === 1 };
}

export function platformApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  const status = ["family_feedback_response_unavailable", "family_response_id_conflict", "family_response_source_changed", "family_response_already_voided", "trial_batch_id_conflict", "trial_batch_changed", "trial_batch_scope_changed", "trial_batch_already_voided", "family_feedback_id_conflict", "family_feedback_task_changed", "family_feedback_already_voided"].includes(message) ? 409 : message === "authentication_required"
    ? 401
    : message === "forbidden" || message === "account_access_denied" || message === "password_change_required"
      ? 403
      : message.endsWith("_not_found")
        ? 404
        : message === "cannot_disable_self" || message === "review_not_due" || message === "submission_already_reviewed" || message === "member_account_external" || message === "member_email_conflict" || message === "shared_account_password_reset" || message === "enrollment_conflict" || message === "document_version_conflict"
          ? 409
          : ["family_confirmation_required", "family_review_required", "family_submission_pending", "family_task_has_submissions", "family_task_changed", "submission_id_conflict", "support_evidence_changed", "sequence_practice_required", "sequence_submission_pending", "sequence_id_conflict", "sequence_retest_required", "sequence_retest_not_open", "sequence_retest_already_scheduled", "sequence_decision_id_conflict", "sequence_decision_already_published", "trial_record_id_conflict", "trial_record_already_voided"].includes(message) ? 409
          : message === "review_item_changed" || message === "diagnostic_attempt_id_conflict" ? 409
          : message.startsWith("invalid_") ? 400
      : message === "authentication_config_missing"
          ? 500
          : 500;
  if (status >= 500) console.error("platform_api_error", { message });
  return Response.json({ error: message }, { status });
}
