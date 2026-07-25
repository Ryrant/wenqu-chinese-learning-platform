import { env } from "cloudflare:workers";
import { platformApiError, platformContext } from "../../../lib/platform-store";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request, "student");
    const body = await request.json() as { assignmentId?: string; textAnswer?: string; assetKey?: string };
    if (!body.assignmentId || (!body.textAnswer?.trim() && !body.assetKey)) return Response.json({ error: "assignment_and_answer_required" }, { status: 400 });
    const assignment = await context.db.prepare("SELECT a.id FROM assignments a WHERE a.id=? AND a.tenant_id=? AND a.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=a.tenant_id AND e.class_id=a.class_id AND e.student_user_id=? AND e.status='active')").bind(body.assignmentId, context.tenantId, context.userId).first();
    if (!assignment) return Response.json({ error: "published_assignment_not_found" }, { status: 404 });
    const id = crypto.randomUUID();
    await context.db.batch([
      context.db.prepare("INSERT INTO submissions (id,tenant_id,assignment_id,student_user_id,text_answer,asset_key,confidence,review_status) VALUES (?,?,?,?,?,?,0,'human_review')").bind(id, context.tenantId, body.assignmentId, context.userId, body.textAnswer?.trim().slice(0, 10000) || null, body.assetKey || null),
      context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(), context.tenantId, context.userId, "submission.created", "submission", id, JSON.stringify({ medium: body.assetKey ? "asset" : "text" })),
    ]);
    void env;
    return Response.json({ id, reviewStatus: "human_review", message: "已提交教师复核；平台不会伪造自动分数。" }, { status: 201 });
  } catch (error) { return platformApiError(error); }
}
