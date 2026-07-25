import { getDb } from "../../../../db";
import { auditLogs, submissions } from "../../../../db/schema";
import { apiError, requestContext } from "../../../lib/request-context";

export async function POST(request: Request) {
  try {
    const context = requestContext(request, { requireIdentity: true });
    const body = await request.json() as { assignmentId?: string; textAnswer?: string; assetKey?: string; score?: number; confidence?: number };
    if (!body.assignmentId || (!body.textAnswer && !body.assetKey)) return Response.json({ error: "assignment_and_answer_required" }, { status: 400 });
    const id = crypto.randomUUID();
    const confidence = Math.max(0, Math.min(body.confidence ?? 0.9, 1));
    const reviewStatus = confidence < 0.7 ? "human_review" : "auto";
    const db = getDb();
    await db.insert(submissions).values({ id, tenantId: context.tenantId, assignmentId: body.assignmentId, studentUserId: context.userId, textAnswer: body.textAnswer?.slice(0, 10000), assetKey: body.assetKey, score: body.score, confidence, reviewStatus });
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), tenantId: context.tenantId, actorUserId: context.userId, action: "submission.created", targetType: "submission", targetId: id, detailJson: JSON.stringify({ reviewStatus }) });
    return Response.json({ id, reviewStatus }, { status: 201 });
  } catch (error) { return apiError(error); }
}