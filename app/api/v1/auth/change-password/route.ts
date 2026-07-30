import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { hashPassword, verifyPassword } from "../../../../lib/auth-password";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return Response.json({ error: "weak_password" }, { status: 400 });
    }
    const account = await context.db.prepare("SELECT password_hash AS passwordHash FROM users WHERE id=? AND status='active'")
      .bind(context.userId)
      .first<{ passwordHash: string | null }>();
    if (!account?.passwordHash || !(await verifyPassword(currentPassword, account.passwordHash))) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }
    const passwordHash = await hashPassword(newPassword);
    await context.db.prepare("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?")
      .bind(passwordHash, context.userId)
      .run();
    await context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.tenantId, context.userId, "password.changed", "user", context.userId, "{}")
      .run();
    return Response.json({ changed: true });
  } catch (error) {
    return platformApiError(error);
  }
}
