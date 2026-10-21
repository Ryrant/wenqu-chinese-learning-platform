import type { PlatformDatabase } from "./platform-runtime";

export const LEARNING_ANALYTICS_SCOPE = "learning_analytics";
export type LearningAnalyticsStatus = "not_granted" | "granted" | "withdrawn" | "expired";
export type LearningAnalyticsState = { available: boolean; consentStatus: LearningAnalyticsStatus };

/** 参数只能是代码内的 SQL 表达式；把授权判定留在业务事务中，撤回后不再累计分析证据。 */
export function learningAnalyticsConsentSql(tenantExpression: string, studentExpression: string) {
  return `EXISTS (SELECT 1 FROM consent_records analytics_consent
    WHERE analytics_consent.rowid=(SELECT analytics_latest.rowid FROM consent_records analytics_latest
      WHERE analytics_latest.tenant_id=${tenantExpression} AND analytics_latest.student_user_id=${studentExpression}
        AND analytics_latest.scope='${LEARNING_ANALYTICS_SCOPE}'
      ORDER BY datetime(analytics_latest.created_at) DESC,analytics_latest.rowid DESC LIMIT 1)
      AND analytics_consent.status='granted'
      AND (analytics_consent.expires_at IS NULL OR julianday(analytics_consent.expires_at)>julianday('now')))`;
}

export function learningAnalyticsSubmissionSql(tenantExpression: string, studentExpression: string, submissionExpression: string) {
  return `EXISTS (SELECT 1 FROM submissions analytics_source
    WHERE analytics_source.id=${submissionExpression} AND analytics_source.tenant_id=${tenantExpression}
      AND analytics_source.student_user_id=${studentExpression}
      AND COALESCE(json_extract(analytics_source.diagnostic_snapshot_json,'$.analyticsAllowed'),1)=1)`;
}

export async function readLearningAnalyticsState(db: PlatformDatabase, tenantId: string, studentUserId: string): Promise<LearningAnalyticsState> {
  const record = await db.prepare(`SELECT status,
      expires_at IS NOT NULL AND (julianday(expires_at) IS NULL OR julianday(expires_at)<=julianday('now')) AS expired
    FROM consent_records WHERE tenant_id=? AND student_user_id=? AND scope=?
    ORDER BY datetime(created_at) DESC,rowid DESC LIMIT 1`)
    .bind(tenantId, studentUserId, LEARNING_ANALYTICS_SCOPE).first<{ status: string; expired: number }>();
  const consentStatus = !record ? "not_granted" : record.status === "withdrawn" ? "withdrawn"
    : record.status !== "granted" ? "not_granted" : record.expired ? "expired" : "granted";
  return { available: consentStatus === "granted", consentStatus };
}

export function learningAnalyticsMessage(status?: LearningAnalyticsStatus) {
  return status === "withdrawn" ? "学习分析授权已撤回，掌握度分析与成长报告已暂停。"
    : status === "expired" ? "学习分析授权已过期，掌握度分析与成长报告已暂停。"
      : "尚未同意学习分析，掌握度分析与成长报告暂不可用。";
}
