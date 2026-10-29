import { RetainedFeature, RetainedTabsContent } from "../workspace/retained-feature";
import { initialFollowupView } from "../../lib/teaching-followup-view";
import type { FollowupAction } from "@/lib/teaching-followup-types";
import { readSequenceWork } from "@/lib/learning-sequence-types";
import { lazy, useEffect, useRef, useState } from "react";
import { numberValue, stringValue } from "@/lib/platform-types";
import { ProgressRing } from "@/components/progress-ring";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatCard, EmptyState, SectionHeading, MetricGrid } from "@/components/workspace/workspace-ui";
import { type ReviewDraft } from "@/components/teacher/submission-review";
import type { BaseProps } from "@/lib/staff-display";
import { localDate, jsonArray } from "@/lib/staff-display";

const TeacherLearningSequences = lazy(() => import("@/components/learning/learning-sequences").then(module => ({ default: module.TeacherLearningSequences })));
const FamilyPortfolio = lazy(() => import("@/components/family/family-portfolio").then(module => ({ default: module.FamilyPortfolio })));
const StudentCaseTimeline = lazy(() => import("@/components/learning/student-case-timeline").then(module => ({ default: module.StudentCaseTimeline })));
const FamilyFeedbackPanel = lazy(() => import("@/components/family/family-feedback").then(module => ({ default: module.FamilyFeedbackPanel })));
const TrialBatches = lazy(() => import("@/components/trial/trial-batches").then(module => ({ default: module.TrialBatches })));
const TeachingFollowups = lazy(() => import("@/components/teacher/teaching-followups").then(module => ({ default: module.TeachingFollowups })));
const TeacherAbilityProfiles = lazy(() => import("@/components/diagnostic-evidence").then(module => ({ default: module.TeacherAbilityProfiles })));
const TeacherAssignmentCreator = lazy(() => import("@/components/teacher/assignment-creator").then(module => ({ default: module.TeacherAssignmentCreator })));
const TeacherIntervention = lazy(() => import("@/components/teacher/intervention").then(module => ({ default: module.TeacherIntervention })));
const TeacherMasteryHeatmap = lazy(() => import("@/components/teacher/mastery-heatmap").then(module => ({ default: module.TeacherMasteryHeatmap })));
const SubmissionReview = lazy(() => import("@/components/teacher/submission-review").then(module => ({ default: module.SubmissionReview })));
const TeacherDialogueScenarios = lazy(() => import("./dialogue-scenarios"));
const TeacherPracticeDashboard = lazy(() => import("./practice-dashboard"));
const TeacherReadingWorkshop = lazy(() => import("./reading-workshop"));

export function TeacherView({ nav, data: workspace, act, notify, refresh, navigate, active = true }: BaseProps & { refresh: () => Promise<void>; navigate: (nav: string) => void; active?: boolean }) {
  const [overviewTab, setOverviewTab] = useState("learning");
  const classes = workspace.classes.filter((item) => workspace.user.roles.includes("admin") || item.teacher_user_id === workspace.user.id);
  const classIds = new Set(classes.map((item) => String(item.id)));
  const assignments = workspace.assignments.filter((item) => classIds.has(String(item.class_id)));
  const assignmentIds = new Set(assignments.map((item) => String(item.id)));
  const data = { ...workspace, classes, assignments, submissions: workspace.submissions.filter((item) => assignmentIds.has(String(item.assignment_id))),
    enrollments: workspace.enrollments.filter((item) => classIds.has(String(item.classId))),
    learningSequences: workspace.learningSequences.filter((item) => assignmentIds.has(item.assignmentId)),
    sequenceSources: workspace.sequenceSources.filter((item) => assignmentIds.has(item.assignmentId)) };
  const [followupView, setFollowupView] = useState(initialFollowupView);
  const [followupFocus, setFollowupFocus] = useState<FollowupAction | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const navigationIntent = useRef({ value: 0 });
  useEffect(() => { const intent = navigationIntent.current; intent.value++; return () => { intent.value++; }; }, [nav, active]);
  useEffect(() => { if (nav === "教学总览" && followupFocus) document.getElementById("teacher-followups")?.scrollIntoView({ block: "start" }); }, [nav, followupFocus]);
  async function openFollowup(action: FollowupAction) {
    const intent = navigationIntent.current.value;
    await refresh();
    if (navigationIntent.current.value !== intent) return;
    setFollowupFocus(action);
    setFocusRequest((value) => value + 1);
    setSelectedSubmissionId(action.kind === "review" ? action.submissionId : "");
    navigate(action.kind === "assignment" ? "班级管理" : "作业批阅");
  }
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [level, setLevel] = useState("A2");
  const [duration, setDuration] = useState(40);
  const [generated, setGenerated] = useState<Record<string, unknown> | null>(null);
  const [editingPlan, setEditingPlan] = useState<Record<string, unknown> | null>(null);
  const [objectives, setObjectives] = useState<string[]>([]);
  const [activities, setActivities] = useState<Array<Record<string, unknown>>>([]);
  const [className, setClassName] = useState("");
  const [classLevel, setClassLevel] = useState("A2");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const pending = data.submissions.filter((item) => item.review_status !== "reviewed");
  const selectedSubmission = selectedSubmissionId ? pending.find((item) => String(item.id) === selectedSubmissionId) ?? null
    : followupFocus?.kind === "source" || followupFocus?.kind === "sequence" ? null : pending[0] ?? null;
  const latestReviewBySubmission = data.submissionReviews.reduce((reviews, item) => {
    const submissionId = String(item.submission_id);
    if (!reviews.has(submissionId)) reviews.set(submissionId, item);
    return reviews;
  }, new Map<string, (typeof data.submissionReviews)[number]>());
  const published = data.assignments.filter((item) => item.status === "published");
  const mastery = data.masteryMatrix.length ? Math.round(data.masteryMatrix.reduce((sum, item) => sum + numberValue(item.mastery) * 100, 0) / data.masteryMatrix.length) : null;

  async function generate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await act("generate_lesson", { topic, level, duration });
      setGenerated(result); notify("教案草稿已保存", `已引用 ${(result.citations as unknown[])?.length ?? 0} 条已发布来源。`);
    } catch (reason) { notify("备课失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  function startEdit(plan: Record<string, unknown>) {
    setEditingPlan(plan);
    setLessonTitle(stringValue(plan.title, ""));
    setTopic(stringValue(plan.topic, ""));
    setLevel(stringValue(plan.level, "A2"));
    setDuration(numberValue(plan.duration_minutes, 40));
    setObjectives(jsonArray<string>(plan.objectives_json));
    setActivities(jsonArray<Record<string, unknown>>(plan.activities_json));
  }

  async function saveLesson(event: React.FormEvent) {
    event.preventDefault(); if (!editingPlan) return; setBusy(true);
    try {
      await act("update_lesson_plan", { id: editingPlan.id, title: lessonTitle, topic, level, duration, objectives, activities });
      setEditingPlan(null); notify("草稿已更新", "教学目标和环节已保存，引用来源保持不变。");
    } catch (reason) { notify("保存失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  async function createClass(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await act("create_class", { name: className, level: classLevel }); setClassName(""); notify("班级已创建", "可以为这个班级分配成员和任务。"); }
    catch (reason) { notify("创建失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  const renderPage0 = () => {
    const selectedId = selectedSubmission ? String(selectedSubmission.id) : "";
    const review = selectedId ? latestReviewBySubmission.get(selectedId) : undefined;
    return <section>
      <PageHeader title="作业批阅" description={`${pending.length} 份待审核；教师确认评分后才更新掌握度。`}/>
      {followupFocus && <p><Button type="button" variant="outline" disabled={reviewBusy} onClick={() => navigate("教学总览")}>返回班级证据待办</Button></p>}
      <section className="review-top-grid"><TeacherIntervention data={data} act={act} notify={notify}/><StatCard label="等待批阅" value={pending.length} detail="选择学生作品，填写评价并保存反馈。"/></section>
      <section className="review-workspace">
        <Card className="panel review-queue"><div className="panel-heading"><div><span className="eyebrow">待办摘要</span><h3>选择待批阅作品</h3></div><span>{pending.length} 份</span></div>{pending.length ? pending.map((item) => <Button type="button" variant="ghost" aria-pressed={String(item.id) === selectedId} className={String(item.id) === selectedId ? "review-queue-item active" : "review-queue-item"} key={String(item.id)} disabled={reviewBusy} onClick={() => setSelectedSubmissionId(String(item.id))}><span><strong>{stringValue(item.studentName)}</strong><small>{readSequenceWork(item.sequence_snapshot_json)?.title ?? stringValue(item.assignmentTitle)}</small></span><em>{item.asset_key ? "语音" : "文字"}</em></Button>) : <EmptyState title="批阅已完成" description="新的学生作品会显示在这里。"/>}</Card>
        <Card className="panel review-editor">{selectedSubmission ? <SubmissionReview submission={selectedSubmission} review={review} data={data} savedDraft={reviewDrafts[selectedId]} setDraft={(draft) => setReviewDrafts((current) => ({ ...current, [selectedId]: draft }))} busy={reviewBusy} setBusy={setReviewBusy} act={act} notify={notify} onReviewed={() => { setSelectedSubmissionId(""); if (followupFocus?.kind === "review") navigate("教学总览"); }}/> : <p className="empty-state">{selectedSubmissionId ? "指定作品已处理或不在当前任教范围，请返回待办刷新，或从左侧重新选择。" : "选择左侧作品后，可在这里查看内容、生成建议并完成教师确认。"}</p>}</Card>
      </section>
      <TeacherLearningSequences data={data} act={act} notify={notify} focusRequest={focusRequest} focus={followupFocus?.kind === "source" || followupFocus?.kind === "sequence" ? followupFocus : undefined}/>
    </section>;
  };

  return <>
<RetainedFeature active={nav === "教学总览"}>{<section>
    <PageHeader title="教学总览" description="从待办开始，关注每个班级的学习进展。" actions={<Button type="button" onClick={() => navigate("班级管理")}>管理班级与任务</Button>}/>
    <MetricGrid items={[["班级", data.classes.length], ["已发布任务", published.length], ["待批阅", pending.length], ["平均掌握度", mastery === null ? "待评估" : `${mastery}%`]]}/>
    <TeachingFollowups revision={data.generatedAt} view={followupView} onView={(view) => { navigationIntent.current.value++; setFollowupView(view); }} onOpen={openFollowup}/>
    {/* 切换页签只隐藏内容，保留家庭反馈草稿及试用操作的幂等请求标识。 */}
    <Tabs value={overviewTab} onValueChange={setOverviewTab} className="mt-8 space-y-5">
      <TabsList><TabsTrigger value="learning">学生学情</TabsTrigger><TabsTrigger value="family">家庭协同</TabsTrigger><TabsTrigger value="trials">试用观察</TabsTrigger></TabsList>
      <RetainedTabsContent active={overviewTab === "learning"} value="learning" className="space-y-6 data-[state=inactive]:hidden"><TeacherMasteryHeatmap data={data}/><TeacherAbilityProfiles data={data}/><StudentCaseTimeline view="teaching" revision={data.generatedAt}/></RetainedTabsContent>
      <RetainedTabsContent active={overviewTab === "family"} value="family" className="space-y-6 data-[state=inactive]:hidden"><FamilyFeedbackPanel view="teaching" revision={data.generatedAt} notify={notify}/><FamilyPortfolio revision={data.generatedAt}/></RetainedTabsContent>
      <RetainedTabsContent active={overviewTab === "trials"} value="trials" className="data-[state=inactive]:hidden"><TrialBatches revision={data.generatedAt} notify={notify}/></RetainedTabsContent>
    </Tabs>
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "班级管理"}>{<section>
    <PageHeader title="班级管理" description="管理教学班，围绕学习目标安排任务。"/>
    {followupFocus?.kind === "assignment" && <p><Button type="button" variant="outline" onClick={() => navigate("教学总览")}>返回班级证据待办</Button></p>}
    <section className="teacher-class-grid">
      <form className="panel form-card compact-form" onSubmit={createClass}><h3>新建班级</h3><p>先建立教学班，再在右侧配置目标任务。</p><label>班级名称<Input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="例如：五年级甲班" required/></label><label>级别<NativeSelect className="w-full" value={classLevel} onChange={(event) => setClassLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option></NativeSelect></label><Button type="submit" variant="default" disabled={busy}>创建班级</Button></form>
      <TeacherAssignmentCreator data={data} act={act} notify={notify} focusRequest={focusRequest} focus={followupFocus?.kind === "assignment" ? followupFocus : undefined}/>
    </section>
    <Card className="panel assignment-table"><h3>班级列表</h3><div className="table-wrap"><Table><TableHeader><TableRow><TableHead>班级</TableHead><TableHead>级别</TableHead><TableHead>学年</TableHead><TableHead>学生数</TableHead></TableRow></TableHeader><TableBody>{data.classes.map((item) => <TableRow key={String(item.id)}><TableCell>{stringValue(item.name)}</TableCell><TableCell>{stringValue(item.level)}</TableCell><TableCell>{stringValue(item.academic_year)}</TableCell><TableCell>{numberValue(item.studentCount)}</TableCell></TableRow>)}</TableBody></Table></div></Card>
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "作业批阅"}>{renderPage0()}</RetainedFeature>
<RetainedFeature active={nav === "来源化备课"}>{<section>
    <PageHeader title="来源化备课" description="选择主题与学习水平，准备下一节课。"/>
    <section className="teacher-grid lesson-grid">
      <form className="panel form-card" onSubmit={editingPlan ? saveLesson : generate}><h3>{editingPlan ? "编辑教学草稿" : "生成教学草稿"}</h3>{editingPlan && <label>草稿标题<Input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} required/></label>}<label>主题<Input placeholder="例如：中秋节与团圆" value={topic} onChange={(event) => setTopic(event.target.value)} required/></label><div className="field-row"><label>水平<NativeSelect className="w-full" value={level} onChange={(event) => setLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option></NativeSelect></label><label>课时<Input type="number" min="20" max="90" value={duration} onChange={(event) => setDuration(Number(event.target.value))}/></label></div>{editingPlan && <><label>教学目标<Textarea value={objectives.join("\n")} onChange={(event) => setObjectives(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} required/></label><label>教学环节<Textarea value={activities.map((item) => stringValue(item.detail)).join("\n")} onChange={(event) => setActivities(event.target.value.split("\n").filter(Boolean).map((detail, index) => ({ title: `教学环节 ${index + 1}`, minutes: Math.max(5, Math.round(duration / Math.max(1, event.target.value.split("\n").filter(Boolean).length))), detail })))} required/></label></>}<div className="form-actions">{editingPlan && <Button type="button" variant="outline" onClick={() => setEditingPlan(null)}>取消编辑</Button>}<Button type="submit" variant="default" disabled={busy}>{busy ? "保存中…" : editingPlan ? "保存草稿修改" : "生成并保存草稿"}</Button></div></form>
      <Card className="panel lesson-drafts"><div className="panel-heading"><div><span className="eyebrow">最近更新</span><h3>最近草稿</h3></div><span>{data.lessonPlans.length} 份</span></div>{data.lessonPlans.length ? data.lessonPlans.map((plan) => <div className="history-row draft-row" key={String(plan.id)}><div><strong>{stringValue(plan.title)}</strong><small>{numberValue(plan.duration_minutes)} 分钟 · {stringValue(plan.level)} · 更新于 {localDate(plan.updated_at ?? plan.created_at)}</small></div><div className="row-actions"><Button type="button" variant="outline" onClick={() => { startEdit(plan); setGenerated(plan); }}>查看 / 编辑草稿</Button><Button type="button" variant="ghost" className="text-destructive" onClick={async () => { if (!window.confirm("归档后该草稿将从列表隐藏，是否继续？")) return; try { await act("archive_lesson_plan", { id: plan.id }); notify("草稿已归档", "历史数据和审计记录仍然保留。"); } catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>归档草稿</Button></div></div>) : <EmptyState title="尚无教案草稿" description="填写主题，开始准备第一份教案。"/>}</Card>
    </section>
    {generated && <Card className="panel result-card"><Badge variant="secondary">教案草稿</Badge><h2>{stringValue(generated.title)}</h2><h4>教学目标</h4><ul>{jsonArray<string>(generated.objectives ?? generated.objectives_json).map((item) => <li key={item}>{item}</li>)}</ul><h4>教学环节</h4>{jsonArray<Record<string, unknown>>(generated.activities ?? generated.activities_json).map((item, index) => <div className="citation" key={String(item.title ?? index)}><strong>{stringValue(item.title)} · {numberValue(item.minutes)} 分钟</strong><p>{stringValue(item.detail)}</p></div>)}<h4>引用来源（只读）</h4>{jsonArray<Record<string, unknown>>(generated.citations ?? generated.citations_json).map((item) => <div className="citation" key={String(item.id)}><strong>{stringValue(item.title)}</strong><p>{stringValue(item.excerpt)}</p></div>)}</Card>}
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "情境任务"}><TeacherDialogueScenarios notify={notify}/></RetainedFeature>
<RetainedFeature active={nav === "班级练习"}><TeacherPracticeDashboard notify={notify}/></RetainedFeature>
<RetainedFeature active={nav === "课文工作台"}><TeacherReadingWorkshop key={data.workspace.tenantId + ":" + data.user.id} tenantId={data.workspace.tenantId} userId={data.user.id} notify={notify}/></RetainedFeature>
<RetainedFeature active={nav !== "教学总览" && nav !== "班级管理" && nav !== "作业批阅" && nav !== "来源化备课" && nav !== "情境任务" && nav !== "课文工作台" && nav !== "班级练习"}>{<section className="space-y-6"><PageHeader title="近期教学" description={`${data.classes.length} 个班级，${published.length} 项已发布任务。`}/><MetricGrid items={[["已发布任务", published.length], ["待批阅作业", pending.length], ["平均掌握度", mastery === null ? "待评估" : `${mastery}%`], ["教案草稿", data.lessonPlans.length]]}/><section className="teacher-grid"><Card className="panel p-6"><SectionHeading title="近期任务"/>{data.assignments.length ? data.assignments.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.className)} · {numberValue(item.submissionCount)} 份提交</small></div>{item.status === "published" ? <Badge variant="secondary">进行中</Badge> : <Button type="button" variant="outline" onClick={async () => { try { await act("publish_assignment", { id: item.id }); notify("任务已发布", "学生现在可以提交作品。"); } catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>审核并发布</Button>}</div>) : <EmptyState title="尚无教学任务"/>}</Card><Card className="panel p-6"><SectionHeading title="班级掌握度"/><div className="progress-content"><ProgressRing value={mastery} label="平均掌握度"/></div></Card></section></section>}</RetainedFeature>
</>;
}

export default TeacherView;
