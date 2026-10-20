import { classAccessClause, studentAccessClause, submissionAccessClause } from "../../../../../lib/access-control";
import { diagnosticMediaKey } from "../../../../../lib/diagnostic-media";
import { ensurePlatformRuntime } from "../../../../../lib/platform-runtime";
import { platformApiError, platformContext } from "../../../../../lib/platform-store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await platformContext(request);
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("diagnostic_media_not_found");
    const object = await (await ensurePlatformRuntime()).storage?.get(diagnosticMediaKey(context.tenantId, id));
    if (!object || object.customMetadata.tenantId !== context.tenantId) throw new Error("diagnostic_media_not_found");
    if (!context.roles.includes("admin") && object.customMetadata.createdBy !== context.userId) {
      const classes = classAccessClause(context, "c");
      const students = studentAccessClause(context, "dt.student_user_id", "dt.tenant_id");
      const workStudents = submissionAccessClause(context, "s", "c");
      const reviewStudents = studentAccessClause(context, "lr.student_user_id", "lr.tenant_id");
      const reference = await context.db.prepare(`SELECT 1 WHERE
        EXISTS (SELECT 1 FROM diagnostic_items WHERE tenant_id=? AND media_id=? AND status='active')
        OR EXISTS (SELECT 1 FROM assignments a JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
          WHERE a.tenant_id=? AND a.diagnostic_media_id=? AND a.status='published' AND ${classes.sql})
        OR EXISTS (SELECT 1 FROM diagnostic_answers da JOIN diagnostic_attempts dt ON dt.id=da.attempt_id AND dt.tenant_id=da.tenant_id
          WHERE da.tenant_id=? AND json_extract(da.evidence_json,'$.mediaId')=? AND ${students.sql})
        OR EXISTS (SELECT 1 FROM submissions s JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
          JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
          WHERE s.tenant_id=? AND json_extract(s.diagnostic_snapshot_json,'$.mediaId')=? AND ${workStudents.sql})
        OR EXISTS (SELECT 1 FROM learning_recommendations lr JOIN diagnostic_items di ON di.tenant_id=lr.tenant_id AND di.id=lr.source_id
          WHERE lr.tenant_id=? AND lr.source_type='diagnostic' AND lr.status='pending' AND di.media_id=? AND ${reviewStudents.sql})`)
        .bind(context.tenantId, id, context.tenantId, id, ...classes.args, context.tenantId, id, ...students.args, context.tenantId, id, ...workStudents.args, context.tenantId, id, ...reviewStudents.args).first();
      if (!reference) throw new Error("diagnostic_media_not_found");
    }
    return new Response(object.body, { headers: {
      "Content-Type": object.httpMetadata.contentType ?? "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return platformApiError(error); }
}
