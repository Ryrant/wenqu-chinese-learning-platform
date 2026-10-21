import { hashPassword, verifyPassword } from "./auth-password";
import type { PlatformDatabase } from "./platform-runtime";

export type StandardLoginAccount = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string | null;
  mustChangePassword: number;
  status: string;
  sessionVersion: number;
};

export type StandardLoginInput = {
  db: PlatformDatabase;
  email: string;
  password: string;
};

export type InitialAdminInput = {
  db: PlatformDatabase;
  email: string;
  password: string;
  displayName?: string;
  workspaceName?: string;
};

export const DEFAULT_WORKSPACE_NAME = "我的工作区";

function idPart(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

async function findAccount(db: PlatformDatabase, email: string) {
  return db.prepare(`
    SELECT u.id,u.email,u.display_name AS displayName,u.password_hash AS passwordHash,
           u.must_change_password AS mustChangePassword,u.status AS status,u.session_version AS sessionVersion
    FROM users u
    WHERE lower(u.email)=?
    LIMIT 1
  `).bind(email).first<StandardLoginAccount>();
}

async function hasAnyUser(db: PlatformDatabase) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

export async function createInitialAdminAccount({ db, email, password, displayName: configuredDisplayName, workspaceName: configuredWorkspaceName }: InitialAdminInput) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || await hasAnyUser(db)) return null;

  if (configuredWorkspaceName !== undefined && (typeof configuredWorkspaceName !== "string" || configuredWorkspaceName.trim().length > 120)) {
    throw new Error("invalid_workspace_name");
  }

  const userId = `usr_${idPart(normalizedEmail)}`;
  const tenantId = `tenant_${idPart(normalizedEmail)}`;
  const displayName = configuredDisplayName?.trim() || normalizedEmail.split("@")[0];
  const workspaceName = configuredWorkspaceName?.trim() || DEFAULT_WORKSPACE_NAME;
  const passwordHash = await hashPassword(password);
  const claim = crypto.randomUUID();
  // 数据库中的唯一声明与账号写入同事务，不能靠散落在异步哈希两侧的空库检查抢首管。
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO app_settings (key,value) SELECT 'initial_admin_claim',? WHERE NOT EXISTS (SELECT 1 FROM users)").bind(claim),
    db.prepare("INSERT INTO tenants (id,name,region,status) SELECT ?,?,'','active' WHERE EXISTS (SELECT 1 FROM app_settings WHERE key='initial_admin_claim' AND value=?)").bind(tenantId, workspaceName, claim),
    db.prepare("INSERT INTO users (id,email,display_name,password_hash,must_change_password,status) SELECT ?,?,?,?,0,'active' WHERE EXISTS (SELECT 1 FROM app_settings WHERE key='initial_admin_claim' AND value=?)").bind(userId, normalizedEmail, displayName, passwordHash, claim),
    db.prepare("INSERT INTO role_memberships (tenant_id,user_id,role,status) SELECT ?,?,?,'active' WHERE EXISTS (SELECT 1 FROM app_settings WHERE key='initial_admin_claim' AND value=?)").bind(tenantId, userId, "admin", claim),
  ]);
  const winner = await db.prepare("SELECT value FROM app_settings WHERE key='initial_admin_claim'").first<{ value: string }>();
  if (winner?.value !== claim) return null;
  const account = await findAccount(db, normalizedEmail);
  if (!account || account.status !== "active" || !(await verifyPassword(password, account.passwordHash ?? ""))) return null;
  return account;
}

export async function authenticateStandardAccount({ db, email, password }: StandardLoginInput) {
  const account = await findAccount(db, email);
  if (!account || account.status !== "active" || !(await verifyPassword(password, account.passwordHash ?? ""))) return null;
  return account;
}
