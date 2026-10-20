import { StatCard } from "@/components/workspace/workspace-ui";
import type { LoopProps } from "@/lib/learning-display";

export function GuardianWeeklyReport({ data }: Pick<LoopProps, "data">) {
  const report = data.weeklyReport;
  return <section>
    <div className="panel-heading"><div><h3>{data.selectedStudent?.displayName ?? "孩子"}的本周成长报告</h3></div><span className="text-muted-foreground">最近 7 天</span></div>
    <section className="metric-grid">
      <StatCard label="提交作业" value={report.submittedCount}/>
      <StatCard label="已获评价" value={report.reviewedCount}/>
      <StatCard label="作业均分" value={report.averageScore ?? "—"}/>
      <StatCard label="最新掌握度" value={report.masteryAverage === null ? "待评估" : `${report.masteryAverage}%`} detail={`${report.pendingRecommendations} 项待复习`}/>
    </section>
  </section>;
}

export default GuardianWeeklyReport;
