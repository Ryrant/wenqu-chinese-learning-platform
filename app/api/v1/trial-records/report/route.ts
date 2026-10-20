import { platformContext } from "../../../../../lib/platform-store";
import { printReport, reportError, reportPasswordChangeGate } from "../../../../../lib/print-report";
import { readTrialEntries } from "../../../../../lib/trial-service";
import { internalTrialReport } from "../../../../../lib/unit-evidence-report";

export async function GET(request: Request) {
  try {
    const context = await platformContext(request, "teacher");
    const passwordChangeGate = reportPasswordChangeGate(context);
    if (passwordChangeGate) return passwordChangeGate;
    const sequenceId = new URL(request.url).searchParams.get("sequenceId");
    const admin = context.roles.includes("admin");
    let scope = admin ? "本机构试用记录" : "本班观察与本人工作量";
    if (sequenceId !== null) {
      if (!sequenceId.trim() || sequenceId.length > 120) throw new Error("invalid_sequence_id");
      const sequence = await context.db.prepare(`SELECT ls.title FROM learning_sequences ls
        JOIN assignments a ON a.id=ls.assignment_id AND a.tenant_id=ls.tenant_id JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
        WHERE ls.id=? AND ls.tenant_id=? AND (?=1 OR c.teacher_user_id=?)`)
        .bind(sequenceId, context.tenantId, admin ? 1 : 0, context.userId).first<{ title: string }>();
      if (!sequence) throw new Error("sequence_not_found");
      scope = `${sequence.title} · 内部试用记录`;
    }
    const entries = (await readTrialEntries(context.db, context)).filter((item) => sequenceId === null || item.sequenceId === sequenceId);
    const tenant = await context.db.prepare("SELECT name FROM tenants WHERE id=?").bind(context.tenantId).first<{ name: string }>();
    return printReport(scope, internalTrialReport(entries, tenant!.name, scope));
  } catch (error) { return reportError(error); }
}
