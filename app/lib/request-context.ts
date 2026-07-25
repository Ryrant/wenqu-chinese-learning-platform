export type RequestContext = { tenantId: string; userEmail: string; userId: string };

export function requestContext(request: Request, options: { requireIdentity?: boolean } = {}): RequestContext {
  const authenticatedEmail = request.headers.get("oai-authenticated-user-email");
  if (options.requireIdentity && !authenticatedEmail) throw new Error("authentication_required");
  const userEmail = authenticatedEmail ?? "demo-admin@wenqu.local";
  const tenantId = "demo-nanyang";
  return { tenantId, userEmail, userId: userEmail.toLowerCase() };
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  const status = message === "authentication_required" ? 401 : 500;
  return Response.json({ error: message }, { status });
}