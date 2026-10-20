import { useState } from "react";
import { stringValue } from "@/app/lib/platform-types";
import { ABILITY_LABELS } from "@/app/lib/diagnostic-types";
import { HELP_LEVEL_LABELS, sequenceTime } from "@/app/lib/learning-sequence-types";
import { UnitReportLink } from "@/app/unit-report-links";
import planStyles from "@/app/learning-plan.module.css";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { LoopProps } from "@/app/features/shared/learning-display";
import { dueLabel } from "@/app/features/shared/learning-display";

export function StudentTodayPlan({ data, act, notify, navigate, onStartTask }: LoopProps & { navigate: (target: string) => void; onStartTask?: (id: string) => void }) {
  const [busyId, setBusyId] = useState("");
  const kindLabels: Record<string, string> = { teacher: "老师安排", review: "错题复习", family: "家庭任务", assignment: "学习作业", sequence: "阶段练习" };
  async function handle(item: Record<string, unknown>) {
    const id = String(item.id);
    const kind = stringValue(item.kind, "");
    if (kind === "review") return navigate("成长档案");
    if (kind === "assignment" || kind === "family" || kind === "sequence") return onStartTask ? onStartTask(kind === "family" ? `family:${id}` : id) : navigate("学习任务");
    setBusyId(id);
    try {
      await act("update_recommendation_status", { id, status: "completed" });
      notify("计划已完成", "这项任务已从今日计划中移除。");
    } catch (reason) {
      notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusyId("");
    }
  }
  return <Card className="panel loop-panel">
    <div className="panel-heading">
      <div><h3>接下来做什么</h3></div>
      <span className="text-muted-foreground">{data.learningPlan.length} 项</span>
    </div>
    {data.learningPlan.length ? data.learningPlan.map((item, index) => <div className={`plan-row ${planStyles.row}`} key={String(item.id)}>
      <span className="plan-order">{index + 1}</span>
      <div><strong>{stringValue(item.title)}</strong><small>{kindLabels[stringValue(item.kind, "")] ?? "普通作业"} · {dueLabel(item.dueAt ?? item.due_at)}</small>
        <details className={planStyles.basis}><summary>为什么安排这一项</summary>
          <p className={planStyles.reason}>{item.selectionReason}</p>
          {item.basis.length ? item.basis.map((basis) => <section key={basis.objectiveId}><h4>{basis.title}</h4><p>{basis.note}</p>
            {basis.records.length ? <ul>{basis.records.map((record) => <li key={record.id}><strong>{record.ability ? `${ABILITY_LABELS[record.ability]} · ` : ""}{record.title} · {record.id.slice(0, 8)}</strong>
              <span>评价：{record.measuredAt ? sequenceTime(record.measuredAt) : "时间未记录"} · {record.score === null ? "目标未评价" : record.kind === "choice" ? `正确率 ${record.score}%` : `目标评分 ${record.score}/100`}</span>
              {record.kind === "work" && <span>帮助程度：{HELP_LEVEL_LABELS[record.helpLevel ?? "unknown"]}{record.promptCount !== undefined ? ` · 提示次数：${record.promptCount ?? "未记录"}` : ""}</span>}
            </li>)}</ul> : <p>当前没有可用于本次排序的目标评价记录。</p>}
          </section>) : <p>暂无关联评价记录。</p>}
          {item.sequenceId ? <UnitReportLink sequenceId={item.sequenceId}>查看任务组原始作品与教师安排</UnitReportLink> : item.basis.some((basis) => basis.records.length) && <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" onClick={() => navigate("成长档案")}>查看能力画像与原始作品</Button>}
        </details>
        {item.kind === "teacher" && !!item.detail && <details className="support-evidence"><summary>练习要求</summary><p className="generated-copy">{String(item.detail)}</p></details>}
      </div>
      {item.kind === "sequence" && item.waitingReview ? <span className="status draft">待教师评价</span> : item.kind === "family" && item.familyReviewStatus && item.familyReviewStatus !== "reviewed" ? <span className="status draft">{item.familyConfirmedAt ? "待教师评价" : "待家长确认"}</span> : <Button variant="outline" className="h-auto min-h-10 whitespace-normal" type="button" disabled={busyId === String(item.id)} onClick={() => handle(item)}>
        {stringValue(item.kind, "") === "review" ? "进入复习" : item.kind === "assignment" || item.kind === "family" || item.kind === "sequence" ? "进入作业" : busyId === String(item.id) ? "更新中…" : "标记完成"}
      </Button>}
    </div>) : <p className="empty-state">当前没有可安排的任务；教师发布任务或复测开放后可在这里查看。</p>}
  </Card>;
}

export default StudentTodayPlan;
