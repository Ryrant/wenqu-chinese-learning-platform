import { platformApiError, platformContext } from "../../../../lib/platform-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request, "admin");
    const url = new URL(request.url);
    const action = url.searchParams.get("action")?.trim().slice(0, 80) ?? "";
    const actorId = url.searchParams.get("actorId")?.trim().slice(0, 120) ?? "";
    const from = url.searchParams.get("from")?.trim().slice(0, 30) ?? "";
    const to = url.searchParams.get("to")?.trim().slice(0, 30) ?? "";
    const cursor = url.searchParams.get("cursor")?.trim().slice(0, 200) ?? "";
    const clauses = ["al.tenant_id=?"];
    const args: unknown[] = [context.tenantId];
    if (action) { clauses.push("al.action=?"); args.push(action); }
    if (actorId) { clauses.push("al.actor_user_id=?"); args.push(actorId); }
    if (from) { clauses.push("al.created_at>=?"); args.push(`${from} 00:00:00`); }
    if (to) { clauses.push("al.created_at<=?"); args.push(`${to} 23:59:59`); }
    const separator = cursor.lastIndexOf("|");
    if (separator > 0) {
      const cursorTime = cursor.slice(0, separator);
      const cursorId = cursor.slice(separator + 1);
      clauses.push("(al.created_at<? OR (al.created_at=? AND al.id<?))");
      args.push(cursorTime, cursorTime, cursorId);
    }
    const limit = 30;
    const rows = await context.db.prepare(`SELECT al.id,al.action,al.target_type AS targetType,al.target_id AS targetId,
      al.detail_json AS detailJson,al.created_at AS createdAt,al.actor_user_id AS actorId,
      COALESCE(u.display_name,u.email,al.actor_user_id) AS actorDisplayName
      FROM audit_logs al LEFT JOIN users u ON u.id=al.actor_user_id
      WHERE ${clauses.join(" AND ")} ORDER BY al.created_at DESC,al.id DESC LIMIT ?`)
      .bind(...args, limit + 1).all<Record<string, unknown>>();
    const events = rows.results.slice(0, limit);
    const last = events.at(-1);
    return Response.json({
      events,
      nextCursor: rows.results.length > limit && last ? `${last.createdAt}|${last.id}` : null,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformApiError(error);
  }
}
