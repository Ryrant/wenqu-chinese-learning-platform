import { platformApiError, platformContext } from "../../../../../lib/platform-store";


export async function GET(request: Request) {
  try {
    const context = await platformContext(request, "admin");
    const url = new URL(request.url);
    const action = url.searchParams.get("action")?.trim().slice(0, 80) ?? "";
    const actorId = url.searchParams.get("actorId")?.trim().slice(0, 120) ?? "";
    const ip = url.searchParams.get("ip")?.trim().slice(0, 64) ?? "";
    const from = url.searchParams.get("from")?.trim().slice(0, 30) ?? "";
    const to = url.searchParams.get("to")?.trim().slice(0, 30) ?? "";
    const cursor = url.searchParams.get("cursor")?.trim().slice(0, 200) ?? "";
    const clauses = ["al.tenant_id=?"];
    const args: unknown[] = [context.tenantId];
    if (action) { clauses.push("al.action=?"); args.push(action); }
    if (actorId) { clauses.push("al.actor_user_id=?"); args.push(actorId); }
    if (ip) { clauses.push("CASE WHEN json_valid(al.detail_json) THEN json_extract(al.detail_json,'$.ip') END=?"); args.push(ip); }
    // 页面日期按北京时间筛选；审计表中的 CURRENT_TIMESTAMP 为 UTC。
    for (const [value, end] of [[from, false], [to, true]] as const) {
      if (!value) continue;
      const date = new Date(`${value}T00:00:00+08:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) return Response.json({ error: "invalid_audit_date" }, { status: 400 });
      if (end) date.setUTCDate(date.getUTCDate() + 1);
      clauses.push(end ? "al.created_at<?" : "al.created_at>=?");
      args.push(date.toISOString().slice(0, 19).replace("T", " "));
    }
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
      COALESCE(u.display_name,u.email,al.actor_user_id) AS actorDisplayName,u.email AS actorEmail
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
