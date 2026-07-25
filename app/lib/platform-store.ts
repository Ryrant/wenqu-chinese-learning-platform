import { env } from "cloudflare:workers";

export type PlatformRole = "student" | "teacher" | "guardian" | "admin";
export type PlatformContext = { db: D1Database; tenantId: string; userId: string; userEmail: string; displayName: string; roles: PlatformRole[] };
const ROLE_SET = new Set<PlatformRole>(["student", "teacher", "guardian", "admin"]);

function idPart(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function identity(request: Request) {
  const forwarded = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  const development = process.env.NODE_ENV !== "production" ? request.headers.get("x-wenqu-dev-user")?.trim().toLowerCase() : null;
  const email = forwarded ?? development;
  if (!email) throw new Error("authentication_required");
  let displayName = email.split("@")[0];
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (encoded && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { displayName = decodeURIComponent(encoded); } catch { /* fall back to email prefix */ }
  }
  return { email, displayName };
}

async function ensureExtendedSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS lesson_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, topic TEXT NOT NULL, level TEXT NOT NULL, duration_minutes INTEGER NOT NULL, objectives_json TEXT NOT NULL DEFAULT '[]', activities_json TEXT NOT NULL DEFAULT '[]', citations_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS lesson_plans_tenant_idx ON lesson_plans (tenant_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'info', read_at TEXT, scheduled_for TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (tenant_id, user_id, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', invited_by TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_idx ON invitations (token)"),
  ]);
}

async function seedWorkspace(context: Omit<PlatformContext, "roles">) {
  const { db, tenantId, userId, userEmail, displayName } = context;
  const classId = `${tenantId}-class-a2`;
  const objectives = [
    [`${tenantId}-obj-speak`, "A2-S1", "完整描述家庭活动", "口语表达", 0.72],
    [`${tenantId}-obj-listen`, "A2-L1", "理解节日对话", "听力理解", 0.78],
    [`${tenantId}-obj-write`, "A2-W1", "书写家庭主题词语", "汉字书写", 0.63],
    [`${tenantId}-obj-culture`, "A2-C1", "理解团圆文化", "文化理解", 0.88],
  ] as const;
  const due = new Date(Date.now() + 7 * 86400000).toISOString();
  const festivalDoc = `${tenantId}-doc-festival`, textbookDoc = `${tenantId}-doc-textbook`;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenants (id,name,region,status) VALUES (?,?,?,?)").bind(tenantId, "华文趣味试用学校", "sg", "active"),
    db.prepare("INSERT OR IGNORE INTO users (id,email,display_name,locale) VALUES (?,?,?,?)").bind(userId, userEmail, displayName, "zh-CN"),
    ...(["student", "teacher", "guardian", "admin"] as PlatformRole[]).map((role) => db.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role) VALUES (?,?,?)").bind(tenantId, userId, role)),
    db.prepare("INSERT OR IGNORE INTO classes (id,tenant_id,name,level,teacher_user_id,academic_year) VALUES (?,?,?,?,?,?)").bind(classId, tenantId, "四年级乙班", "A2", userId, "2026"),
    db.prepare("INSERT OR IGNORE INTO enrollments (tenant_id,class_id,student_user_id,status) VALUES (?,?,?,?)").bind(tenantId, classId, userId, "active"),
    db.prepare("INSERT OR IGNORE INTO guardian_student_links (tenant_id,guardian_user_id,student_user_id,verified_at) VALUES (?,?,?,CURRENT_TIMESTAMP)").bind(tenantId, userId, userId),
    ...objectives.map(([id, code, title, skill]) => db.prepare("INSERT OR IGNORE INTO learning_objectives (id,tenant_id,code,title,skill,level) VALUES (?,?,?,?,?,?)").bind(id, tenantId, code, title, skill, "A2")),
    db.prepare("INSERT OR IGNORE INTO assignments (id,tenant_id,class_id,title,activity_type,status,due_at,created_by,published_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(`${tenantId}-asg-moon`, tenantId, classId, "月饼里的团圆", "故事闯关 · 口语", "published", due, userId),
    db.prepare("INSERT OR IGNORE INTO assignments (id,tenant_id,class_id,title,activity_type,status,due_at,created_by,published_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(`${tenantId}-asg-food`, tenantId, classId, "我的家乡味道", "看图说话 · 写作", "published", due, userId),
    db.prepare("INSERT OR IGNORE INTO assignments (id,tenant_id,class_id,title,activity_type,status,created_by) VALUES (?,?,?,?,?,?,?)").bind(`${tenantId}-asg-school`, tenantId, classId, "校园里的一天", "情境对话 · 听力", "review", userId),
    db.prepare("INSERT OR IGNORE INTO source_documents (id,tenant_id,title,media_type,rights_status,processing_status,version,created_by) VALUES (?,?,?,?,?,?,?,?)").bind(festivalDoc, tenantId, "中华节日文化故事集", "text/plain", "owned", "published", 1, userId),
    db.prepare("INSERT OR IGNORE INTO source_documents (id,tenant_id,title,media_type,rights_status,processing_status,version,created_by) VALUES (?,?,?,?,?,?,?,?)").bind(textbookDoc, tenantId, "四年级华文教材摘录", "text/plain", "licensed", "published", 1, userId),
    db.prepare("INSERT OR IGNORE INTO knowledge_chunks (id,tenant_id,source_document_id,content,metadata_json,published) VALUES (?,?,?,?,?,1)").bind(`${tenantId}-chunk-festival`, tenantId, festivalDoc, "中秋节常以圆月和月饼象征家人团聚，团圆是节日的重要文化主题。", JSON.stringify({ level: "A2", topic: "中秋节" })),
    db.prepare("INSERT OR IGNORE INTO knowledge_chunks (id,tenant_id,source_document_id,content,metadata_json,published) VALUES (?,?,?,?,?,1)").bind(`${tenantId}-chunk-sentence`, tenantId, textbookDoc, "句型：我们一家人一起……。学习者可以用它描述共同参与的家庭活动。", JSON.stringify({ level: "A2", skill: "口语表达" })),
    db.prepare("INSERT OR IGNORE INTO knowledge_chunks (id,tenant_id,source_document_id,content,metadata_json,published) VALUES (?,?,?,?,?,1)").bind(`${tenantId}-chunk-method`, tenantId, textbookDoc, "看图说话时，可以从人物、食物和动作三个线索组织完整句子。", JSON.stringify({ level: "A2", skill: "看图说话" })),
    db.prepare("INSERT OR IGNORE INTO consent_records (id,tenant_id,student_user_id,guardian_user_id,scope,status) VALUES (?,?,?,?,?,?)").bind(`${tenantId}-consent-learning`, tenantId, userId, userId, "learning_analytics", "granted"),
    db.prepare("INSERT OR IGNORE INTO notifications (id,tenant_id,user_id,title,detail,kind) VALUES (?,?,?,?,?,?)").bind(`${tenantId}-notice-welcome`, tenantId, userId, "试用工作区已就绪", "这里的课程、作业、审核与上传操作都会真实保存。", "success"),
  ]);
  const mastery = await db.prepare("SELECT COUNT(*) AS count FROM mastery_snapshots WHERE tenant_id=? AND student_user_id=?").bind(tenantId, userId).first<{ count: number }>();
  if (!mastery?.count) await db.batch(objectives.map(([id,,, , score], index) => db.prepare("INSERT INTO mastery_snapshots (tenant_id,student_user_id,objective_id,mastery,evidence_count) VALUES (?,?,?,?,?)").bind(tenantId, userId, id, score, index + 3)));
}

export async function platformContext(request: Request, requiredRole?: PlatformRole): Promise<PlatformContext> {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("database_unavailable");
  await ensureExtendedSchema(db);
  const { email, displayName } = identity(request);
  const userId = `usr_${idPart(email)}`;
  const memberships = await db.prepare(`SELECT rm.tenant_id AS tenantId, rm.role AS role FROM role_memberships rm JOIN users u ON u.id=rm.user_id WHERE lower(u.email)=? ORDER BY rm.created_at ASC`).bind(email).all<{ tenantId: string; role: string }>();
  let tenantId = memberships.results[0]?.tenantId ?? `tenant_${idPart(email)}`;
  if (!memberships.results.length) {
    const invitation = await db.prepare("SELECT id,tenant_id AS tenantId,role FROM invitations WHERE lower(email)=? AND status='pending' AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at DESC LIMIT 1").bind(email).first<{ id: string; tenantId: string; role: PlatformRole }>();
    if (invitation) {
      tenantId = invitation.tenantId;
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO users (id,email,display_name,locale) VALUES (?,?,?,'zh-CN')").bind(userId, email, displayName),
        db.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role) VALUES (?,?,?)").bind(tenantId, userId, invitation.role),
        db.prepare("UPDATE invitations SET status='accepted' WHERE id=? AND tenant_id=?").bind(invitation.id, tenantId),
        db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), tenantId, userId, "invitation.accepted", "invitation", invitation.id, JSON.stringify({ email, role: invitation.role })),
      ]);
    } else {
      await seedWorkspace({ db, tenantId, userId, userEmail: email, displayName });
    }
  }
  const rows = await db.prepare("SELECT role FROM role_memberships WHERE tenant_id=? AND user_id=?").bind(tenantId, userId).all<{ role: string }>();
  const roles = rows.results.map((item) => item.role).filter((role): role is PlatformRole => ROLE_SET.has(role as PlatformRole));
  if (requiredRole && !roles.includes(requiredRole) && !roles.includes("admin")) throw new Error("forbidden");
  return { db, tenantId, userId, userEmail: email, displayName, roles };
}

export function platformApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  const status = message === "authentication_required" ? 401 : message === "forbidden" ? 403 : 500;
  return Response.json({ error: message }, { status });
}
