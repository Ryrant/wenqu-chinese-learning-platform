import { hashPassword, verifyPassword } from "./auth-password";

export type StandardLoginAccount = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string | null;
  mustChangePassword: number;
  status: string;
};

export type StandardLoginInput = {
  db: D1Database;
  email: string;
  password: string;
};

export type InitialAdminInput = {
  db: D1Database;
  email: string;
  password: string;
  displayName?: string;
};

function idPart(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

async function findAccount(db: D1Database, email: string) {
  return db.prepare(`
    SELECT u.id,u.email,u.display_name AS displayName,u.password_hash AS passwordHash,
           u.must_change_password AS mustChangePassword,u.status AS status
    FROM users u
    WHERE lower(u.email)=?
    LIMIT 1
  `).bind(email).first<StandardLoginAccount>();
}

async function hasAnyUser(db: D1Database) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

export async function createInitialAdminAccount({ db, email, password, displayName: configuredDisplayName }: InitialAdminInput) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password || await hasAnyUser(db)) return null;

  const userId = `usr_${idPart(normalizedEmail)}`;
  const tenantId = `tenant_${idPart(normalizedEmail)}`;
  const displayName = configuredDisplayName?.trim() || normalizedEmail.split("@")[0];
  const passwordHash = await hashPassword(password);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenants (id,name,region,status) VALUES (?,?,'sg','active')").bind(tenantId, "华文趣味试用学校"),
    db.prepare("INSERT OR IGNORE INTO users (id,email,display_name,password_hash,must_change_password,status) VALUES (?,?,?,?,0,'active')").bind(userId, normalizedEmail, displayName, passwordHash),
    ...(["student", "teacher", "guardian", "admin"] as const).map((role) => db.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role,status) VALUES (?,?,?,'active')").bind(tenantId, userId, role)),
  ]);
  const account = await findAccount(db, normalizedEmail);
  if (!account || account.status !== "active" || !(await verifyPassword(password, account.passwordHash ?? ""))) return null;
  return account;
}

export async function authenticateStandardAccount({ db, email, password }: StandardLoginInput) {
  const account = await findAccount(db, email);
  if (!account || account.status !== "active" || !(await verifyPassword(password, account.passwordHash ?? ""))) return null;
  return account;
}
