import { readSequenceWorkspace } from "../../../../../lib/learning-sequence-service";
import { platformContext } from "../../../../../lib/platform-store";
import { printReport, reportError, reportPasswordChangeGate } from "../../../../../lib/print-report";
import { unitEvidenceReport } from "../../../../../lib/unit-evidence-report";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await platformContext(request);
    const passwordChangeGate = reportPasswordChangeGate(context);
    if (passwordChangeGate) return passwordChangeGate;
    const { id } = await params;
    if (!id || id.length > 120) throw new Error("invalid_sequence_id");
    const data = await readSequenceWorkspace(context.db, context, null, id);
    const sequence = data.learningSequences.find((item) => item.id === id);
    if (!sequence) throw new Error("sequence_not_found");
    const tenant = await context.db.prepare("SELECT name FROM tenants WHERE id=?").bind(context.tenantId).first<{ name: string }>();
    return printReport(`${sequence.studentName} · ${sequence.title} · 单元证据报告`, unitEvidenceReport(sequence, tenant!.name));
  } catch (error) { return reportError(error); }
}
