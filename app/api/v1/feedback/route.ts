import { platformApiError, platformContext } from "../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    const body = await request.json() as { targetType?: string; targetId?: string; rating?: number; correction?: string };
    if (!body.targetType || !body.targetId || ![-1, 1].includes(body.rating ?? 0)) return Response.json({ error: "invalid_feedback" }, { status: 400 });
    const id = crypto.randomUUID();
    await context.db.batch([
      context.db.prepare("INSERT INTO feedback (id,tenant_id,user_id,target_type,target_id,rating,correction) VALUES (?,?,?,?,?,?,?)").bind(id, context.tenantId, context.userId, body.targetType, body.targetId, body.rating, body.correction?.slice(0, 2000) ?? null),
      context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, context.userId, "feedback.created", body.targetType, body.targetId, JSON.stringify({ rating: body.rating })),
    ]);
    return Response.json({ id, status: "recorded" }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
