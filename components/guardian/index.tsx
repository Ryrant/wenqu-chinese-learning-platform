import { lazy, useState } from "react";
import { RetainedFeature, RetainedTabsContent } from "../workspace/retained-feature";
import { readSequenceWork } from "@/lib/learning-sequence-types";
import { GuardianStudentSwitcher } from "@/components/guardian/student-switcher";
import { numberValue, stringValue, type WorkspaceData } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, EmptyState, SectionHeading, MetricGrid } from "@/components/workspace/workspace-ui";
import type { GuardianProps } from "@/lib/staff-display";
import { localDate, textSummary } from "@/lib/staff-display";

const SequenceReports = lazy(() => import("@/components/learning/learning-sequences").then(module => ({ default: module.SequenceReports })));
const FamilyPortfolio = lazy(() => import("@/components/family/family-portfolio").then(module => ({ default: module.FamilyPortfolio })));
const StudentCaseTimeline = lazy(() => import("@/components/learning/student-case-timeline").then(module => ({ default: module.StudentCaseTimeline })));
const AbilityEvidenceProfile = lazy(() => import("@/components/diagnostic-evidence").then(module => ({ default: module.AbilityEvidenceProfile })));
const GuardianFamilyTasks = lazy(() => import("@/components/guardian/family-tasks").then(module => ({ default: module.GuardianFamilyTasks })));
const GuardianWeeklyReport = lazy(() => import("@/components/guardian/weekly-report").then(module => ({ default: module.GuardianWeeklyReport })));

function FamilyTaskSessions({ active, data, act, notify }: Pick<GuardianProps, "data" | "act" | "notify"> & { active: boolean }) {
  const [sessions, setSessions] = useState<Record<string, WorkspaceData>>({});
  const studentId = data.selectedStudent?.id;
  const allowed = new Set(data.availableStudents.map((student) => student.id));
  const obsolete = Object.keys(sessions).some((id) => !allowed.has(id));
  const updateCurrent = active && studentId && allowed.has(studentId) && sessions[studentId] !== data;
  if (obsolete || updateCurrent) {
    const next = Object.fromEntries(Object.entries(sessions).filter(([id]) => allowed.has(id)));
    if (updateCurrent) next[studentId] = data;
    setSessions(next);
  }
  // 每个孩子的编辑器只接收该孩子的快照；隐藏后保留草稿，暂停其读取 Effects。
  return <>
    {Object.entries(sessions).filter(([id]) => allowed.has(id)).map(([id, snapshot]) => <RetainedFeature key={id} active={active && id === studentId}>
      <GuardianFamilyTasks data={snapshot} act={act} notify={notify}/>
    </RetainedFeature>)}
    {!studentId && <EmptyState title="尚未绑定孩子" description="请联系机构管理员建立监护关系。"/>}
  </>;
}

export function GuardianView({ nav, data, act, notify, selectStudent }: GuardianProps) {
  const [reportTab, setReportTab] = useState("weekly");
  const average = data.mastery.length ? Math.round(data.mastery.reduce((sum, item) => sum + numberValue(item.mastery) * 100, 0) / data.mastery.length) : null;
  const reviewed = data.submissions.filter((item) => item.student_user_id === data.selectedStudent?.id && item.review_status === "reviewed");
  const childSwitch = <GuardianStudentSwitcher data={data} selectStudent={selectStudent}/>;

  const pendingTasks = data.recommendations.filter((item) => item.status === "pending").length;
  const latestFeedback = reviewed[0];
  return <>
<RetainedFeature active={nav === "成长报告"}>{<section>
    <PageHeader title="成长报告" description="回顾本周作品、教师反馈与能力变化。" actions={childSwitch}/>
    <Tabs value={reportTab} onValueChange={setReportTab} className="space-y-6">
      <TabsList className="max-w-full overflow-x-auto"><TabsTrigger value="weekly">本周报告</TabsTrigger><TabsTrigger value="ability">能力与证据</TabsTrigger><TabsTrigger value="portfolio">成长档案</TabsTrigger><TabsTrigger value="sequence">任务进展</TabsTrigger></TabsList>
      <RetainedTabsContent active={reportTab === "weekly"} value="weekly" className="space-y-6 data-[state=inactive]:hidden"><GuardianWeeklyReport data={data}/>
    <Card className="panel reviewed-work-list"><h3>已审核作品</h3>{reviewed.length ? reviewed.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{readSequenceWork(item.sequence_snapshot_json)?.title ?? stringValue(item.assignmentTitle)}</strong><small>{localDate(item.reviewed_at ?? item.created_at)} · 学习目标：{readSequenceWork(item.sequence_snapshot_json)?.objectiveTitle ?? stringValue(item.objectiveTitles, "未关联目标")}</small><p>教师反馈：{textSummary(item.feedback, "教师暂未填写文字反馈")}</p></div><span className="status published">{numberValue(item.score)} 分</span></div>) : <p className="empty-state">当前孩子最近还没有教师确认的作品。</p>}</Card></RetainedTabsContent>
      <RetainedTabsContent active={reportTab === "ability"} value="ability" className="space-y-6 data-[state=inactive]:hidden"><AbilityEvidenceProfile key={`profile:${data.selectedStudent?.id}`} studentId={data.selectedStudent?.id ?? ""} revision={data.generatedAt}/><StudentCaseTimeline key={`case:${data.selectedStudent?.id}`} view="guardian" studentId={data.selectedStudent?.id ?? ""} revision={data.generatedAt}/></RetainedTabsContent>
      <RetainedTabsContent active={reportTab === "portfolio"} value="portfolio" className="data-[state=inactive]:hidden"><FamilyPortfolio key={`portfolio:${data.selectedStudent?.id}`} studentId={data.selectedStudent?.id ?? ""} revision={data.generatedAt}/></RetainedTabsContent>
      <RetainedTabsContent active={reportTab === "sequence"} value="sequence" className="data-[state=inactive]:hidden"><SequenceReports sequences={(data.learningSequences ?? []).filter((item) => item.studentUserId === data.selectedStudent?.id)}/></RetainedTabsContent>
    </Tabs>
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "家庭任务"}>{<section><PageHeader title="家庭任务" description="孩子提交作品后，家长记录交流与帮助情况，由教师评价完成任务。" actions={childSwitch}/><FamilyTaskSessions active={nav === "家庭任务"} data={data} act={act} notify={notify}/></section>}</RetainedFeature>
<RetainedFeature active={nav === "授权管理"}>{<section><PageHeader title="授权管理" description="管理孩子的学习数据使用授权。" actions={childSwitch}/><Card className="panel "><div className="consent-row"><div><strong>学习分析授权</strong><p>用于生成掌握度快照和家长报告；不授权给模型供应商训练。</p></div>{(() => { const item = data.consents.find((row) => row.scope === "learning_analytics" && (!data.selectedStudent || row.student_user_id === data.selectedStudent.id)); const granted = item?.status === "granted"; return <Button type="button" variant={granted ? "outline" : "default"} disabled={!data.selectedStudent} onClick={async () => { try { await act("update_consent", { studentUserId: data.selectedStudent?.id, scope: "learning_analytics", status: granted ? "withdrawn" : "granted" }); notify("授权状态已更新", granted ? "已撤回学习分析授权。" : "已记录监护人同意。"); } catch (reason) { notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>{granted ? "撤回授权" : "重新同意"}</Button>; })()}</div></Card></section>}</RetainedFeature>
<RetainedFeature active={nav !== "成长报告" && nav !== "家庭任务" && nav !== "授权管理"}>{<section>
    <PageHeader title={`${data.selectedStudent?.displayName ?? "孩子"}的学习概览`} description="关注孩子最近的学习表现与下一步任务。" actions={childSwitch}/>
    <MetricGrid items={[["平均掌握度", average === null ? "待评估" : `${average}%`], ["当前待办", pendingTasks], ["教师已确认", reviewed.length], ["薄弱目标", data.mastery.filter((item) => numberValue(item.mastery) < 0.6).length]]}/>
    <section className="guardian-overview-grid"><Card className="panel "><SectionHeading title="能力目标"/>{!data.mastery.length && <EmptyState title="尚无目标评价" description="教师评价作品后，可查看各项目标表现。"/>}{data.mastery.map((item) => <div className="history-row" key={String(item.objectiveId ?? item.skill)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.skill)} · {numberValue(item.evidenceCount)} 条证据</small></div><span className={numberValue(item.mastery) < 0.6 ? "status warning" : "status published"}>{Math.round(numberValue(item.mastery) * 100)}%</span></div>)}</Card><Card className="panel "><h3>最近教师反馈</h3>{latestFeedback ? <div className="feedback-highlight"><strong>{stringValue(latestFeedback.assignmentTitle)}</strong><p>{stringValue(latestFeedback.feedback, "教师已确认成绩，暂未填写文字反馈。")}</p><small>{localDate(latestFeedback.reviewed_at ?? latestFeedback.created_at)} · {numberValue(latestFeedback.score)} 分</small></div> : <p className="empty-state">教师确认作业后，反馈会显示在这里。</p>}</Card></section>
  </section>}</RetainedFeature>
</>;
}

export default GuardianView;
