import { submissionAccessClause } from "../../../../../lib/access-control";
import { ensurePlatformRuntime } from "../../../../../lib/platform-runtime";
import { platformApiError, platformContext } from "../../../../../lib/platform-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await platformContext(request);
    const { id } = await params;
    const access = submissionAccessClause(context, "s", "c");
    const submission = await context.db.prepare(`SELECT s.asset_key AS assetKey,s.student_user_id AS studentUserId
      FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
      JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      WHERE s.id=? AND s.tenant_id=? AND ${access.sql}`)
      .bind(id, context.tenantId, ...access.args).first<{ assetKey: string | null; studentUserId: string }>();
    if (!submission?.assetKey?.startsWith(`${context.tenantId}/submissions/`)) throw new Error("recording_not_found");
    const storage = (await ensurePlatformRuntime()).storage;
    if (!storage) return Response.json({ error: "storage_unavailable" }, { status: 503 });
    const object = await storage.get(submission.assetKey);
    if (!object || object.customMetadata.tenantId !== context.tenantId || object.customMetadata.studentUserId !== submission.studentUserId) throw new Error("recording_not_found");
    const contentType = object.httpMetadata.contentType ?? "audio/webm";
    if (!/^audio\//i.test(contentType)) throw new Error("recording_not_found");
    const headers = new Headers({ "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
    const range = request.headers.get("range");
    if (!range) return new Response(object.body, { headers });
    const bytes = await object.arrayBuffer();
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match?.[2]));
    const end = match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.byteLength) {
      headers.set("Content-Range", `bytes */${bytes.byteLength}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  } catch (error) { return platformApiError(error); }
}
