import { platformContext } from "../../../../../lib/platform-store";
import { printReport, reportError, reportPasswordChangeGate } from "../../../../../lib/print-report";
import { readTrialBatch } from "../../../../../lib/trial-batch-service";
import { trialBatchReport } from "../../../../../lib/trial-batch-report";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await platformContext(request, "teacher"); const gate = reportPasswordChangeGate(context); if (gate) return gate;
    const { id } = await params; if (!id || id.length > 120) throw new Error("invalid_trial_batch_id");
    const report = await readTrialBatch(context, id);
    const tenant = await context.db.prepare("SELECT name FROM tenants WHERE id=?").bind(context.tenantId).first<{ name: string }>();
    return printReport(`${report.batch.title} · 试用批次报告`, trialBatchReport(report, tenant!.name), report.generatedAt);
  } catch (error) { return reportError(error); }
}
