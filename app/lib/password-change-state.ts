export type PasswordChangeSession = { mustChangePassword?: boolean };

export function needsPasswordChange(session: PasswordChangeSession) {
  return session.mustChangePassword === true;
}

export function sessionPasswordChangeState(session: PasswordChangeSession) {
  return { mustChangePassword: needsPasswordChange(session) };
}

export function workspacePasswordChangeGate(authMode: string, session: PasswordChangeSession) {
  if (authMode !== "standard" || !needsPasswordChange(session)) return null;
  return Response.json({ error: "password_change_required" }, { status: 403, headers: { "cache-control": "no-store" } });
}
