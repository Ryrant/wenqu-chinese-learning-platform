import { readSequenceWorkspace } from "../../../../../../lib/learning-sequence-service";
import { platformContext } from "../../../../../../lib/platform-store";
import { printReport, reportError, reportPasswordChangeGate } from "../../../../../../lib/print-report";
import { unitEvidenceReport } from "../../../../../../lib/unit-evidence-report";
import { readLearningAnalyticsState, learningAnalyticsMessage } from "../../../../../../lib/learning-analytics";

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
    const analytics = await readLearningAnalyticsState(context.db, context.tenantId, sequence.studentUserId);
    if (!analytics.available) return printReport("学习分析暂不可用", `<h1>学习分析暂不可用</h1><p>${learningAnalyticsMessage(analytics.consentStatus)}</p><p>原始作品和教师反馈继续保留，可返回工作区查看。</p>`, undefined, 403);
    const tenant = await context.db.prepare("SELECT name FROM tenants WHERE id=?").bind(context.tenantId).first<{ name: string }>();
    return printReport(`${sequence.studentName} · ${sequence.title} · 单元证据报告`, unitEvidenceReport(sequence, tenant!.name));
  } catch (error) { return reportError(error); }
}
