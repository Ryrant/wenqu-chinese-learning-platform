import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { changeAccountPassword } from "../../../../lib/password-change";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return Response.json({ error: "weak_password" }, { status: 400 });
    }
    const changed = await changeAccountPassword({
      db: context.db,
      tenantId: context.tenantId,
      userId: context.userId,
      currentPassword,
      newPassword,
    });
    if (!changed) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }
    return Response.json({ changed: true });
  } catch (error) {
    return platformApiError(error);
  }
}
