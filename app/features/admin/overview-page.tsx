import { lazy, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RetainedTabsContent } from "../shared/retained-feature";
import { numberValue, stringValue } from "@/app/lib/platform-types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, SectionHeading } from "@/app/components/workspace-ui";
import type { AdminProps } from "@/app/features/shared/staff-display";
import { MetricGrid } from "@/app/features/shared/staff-display";

const AdminQualityDashboard = lazy(() => import("./quality-dashboard"));
const StudentCaseTimeline = lazy(() => import("@/app/student-case-timeline").then(module => ({ default: module.StudentCaseTimeline })));
const UnitReportIndex = lazy(() => import("@/app/unit-report-links").then(module => ({ default: module.UnitReportIndex })));
const TrialOverview = lazy(() => import("@/app/trial-records").then(module => ({ default: module.TrialOverview })));
const TrialBatches = lazy(() => import("@/app/trial-batches").then(module => ({ default: module.TrialBatches })));
const FamilyFeedbackPanel = lazy(() => import("@/app/family-feedback").then(module => ({ default: module.FamilyFeedbackPanel })));
const FamilyPortfolio = lazy(() => import("@/app/family-portfolio").then(module => ({ default: module.FamilyPortfolio })));

const PROCESSING_LABELS: Record<string, string> = {
  uploaded: "已上传",
  processed: "待发布审核",
  published: "已发布",
  rejected: "未通过",
  failed: "处理失败",
  archived: "已归档",
};

export function OverviewPage({ data, act, notify }: AdminProps) {
  const [tab, setTab] = useState("quality");
const published = data.documents.filter((item) => item.processing_status === "published").length;
return <section className="space-y-6"><PageHeader title="机构总览" description={data.workspace.name}/><MetricGrid items={[["教学班级", data.classes.length], ["机构成员", data.members.length], ["已发布资料", published], ["待审核资料", data.documents.filter((item) => item.processing_status !== "published").length]]}/><Card className="panel p-6"><SectionHeading title="教学资料" description={`${data.documents.reduce((sum, item) => sum + numberValue(item.chunkCount), 0)} 个知识片段`}/>{data.documents.length ? data.documents.slice(0, 5).map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{numberValue(item.chunkCount)} 个片段</small></div><Badge variant={item.processing_status === "published" ? "secondary" : "outline"}>{PROCESSING_LABELS[stringValue(item.processing_status)] ?? stringValue(item.processing_status)}</Badge></div>) : <EmptyState title="教学资料库待建立" description="在内容中心上传资料，审核后用于备课与知识检索。"/>}</Card>
<Tabs value={tab} onValueChange={setTab} className="space-y-5">
  <TabsList><TabsTrigger value="quality">教学质量</TabsTrigger><TabsTrigger value="trials">试用观察</TabsTrigger><TabsTrigger value="family">家庭协同</TabsTrigger></TabsList>
  <RetainedTabsContent active={tab === "quality"} value="quality" className="space-y-6">
    <AdminQualityDashboard data={data}/><StudentCaseTimeline view="teaching" revision={data.generatedAt}/><UnitReportIndex sequences={data.learningSequences ?? []}/>
  </RetainedTabsContent>
  <RetainedTabsContent active={tab === "trials"} value="trials" className="space-y-6">
    <Card className="panel p-6"><TrialOverview entries={data.trialEntries ?? []} sequences={data.learningSequences ?? []} controls={{ act, notify }}/></Card>
    <TrialBatches revision={data.generatedAt} notify={notify}/>
  </RetainedTabsContent>
  <RetainedTabsContent active={tab === "family"} value="family" className="space-y-6">
    <FamilyFeedbackPanel view="teaching" revision={data.generatedAt} notify={notify}/><FamilyPortfolio revision={data.generatedAt}/>
  </RetainedTabsContent>
</Tabs></section>;
}

export default OverviewPage;
