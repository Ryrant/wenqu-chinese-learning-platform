import { getDb } from "../../../../db";
import { auditLogs, feedback } from "../../../../db/schema";
import { apiError, requestContext } from "../../../lib/request-context";

export async function POST(request: Request) {
  try {
    const context = requestContext(request, { requireIdentity: true });
    const body = await request.json() as { targetType?: string; targetId?: string; rating?: number; correction?: string };
    if (!body.targetType || !body.targetId || ![-1, 1].includes(body.rating ?? 0)) return Response.json({ error: "invalid_feedback" }, { status: 400 });
    const id = crypto.randomUUID();
    const db = getDb();
    await db.batch([
      db.insert(feedback).values({ id, tenantId: context.tenantId, userId: context.userId, targetType: body.targetType, targetId: body.targetId, rating: body.rating!, correction: body.correction?.slice(0, 2000) }),
      db.insert(auditLogs).values({ id: crypto.randomUUID(), tenantId: context.tenantId, actorUserId: context.userId, action: "feedback.created", targetType: body.targetType, targetId: body.targetId, detailJson: JSON.stringify({ rating: body.rating }) }),
    ]);
    return Response.json({ id, status: "recorded" }, { status: 201 });
  } catch (error) { return apiError(error); }
}