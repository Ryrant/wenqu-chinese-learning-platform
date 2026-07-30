export type PasswordChangeSession = { mustChangePassword?: boolean };

export function needsPasswordChange(session: PasswordChangeSession) {
  return session.mustChangePassword === true;
}
