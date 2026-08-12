"use client";

import { useState } from "react";
import {
  AdminEnrollmentEditor,
  AdminObjectiveLibrary,
  AdminQualityDashboard,
  GuardianFamilyTasks,
  GuardianStudentSwitcher,
  GuardianWeeklyReport,
  TeacherAssignmentCreator,
  TeacherIntervention,
  TeacherMasteryHeatmap,
} from "./learning-loop-views";
import type { Act, Notify, WorkspaceData } from "./lib/platform-types";
import { numberValue, stringValue } from "./lib/platform-types";
import { ProgressRing } from "./student-view";
import { MemberManagementView } from "./member-management-view";

type BaseProps = { nav: string; data: WorkspaceData; act: Act; notify: Notify };
type GuardianProps = BaseProps & { selectStudent: (studentId: string) => Promise<void> };
type AdminProps = BaseProps & { refresh: () => Promise<void> };
type AuditEvent = Record<string, unknown>;

const SERVICE_NAMES: Record<string, string> = {
  database: "数据库",
  storage: "文件存储",
  retrieval: "知识检索",
  generation: "内容生成",
  speech: "语音评测",
  moderation: "内容审核",
};
const SERVICE_STATUS: Record<string, { label: string; tone: string }> = {
  available: { label: "正常", tone: "healthy" },
  configured: { label: "正常", tone: "healthy" },
  template: { label: "内置模式", tone: "builtin" },
  manual: { label: "人工复核", tone: "manual" },
  rules: { label: "基础规则", tone: "builtin" },
  error: { label: "异常", tone: "error" },
};
const PROCESSING_LABELS: Record<string, string> = {
  uploaded: "已上传",
  processed: "待发布审核",
  published: "已发布",
  rejected: "未通过",
  failed: "处理失败",
  archived: "已归档",
};
const RIGHTS_LABELS: Record<string, string> = { pending: "待权属核验", owned: "机构自有", licensed: "已获授权", approved: "权属已确认" };
const TARGET_LABELS: Record<string, string> = {
  class: "班级",
  submission: "学生作业",
  lesson_plan: "教案草稿",
  diagnostic_attempt: "入学诊断",
  user: "成员账号",
  learning_recommendation: "学习与家庭任务",
  source_document: "内容资料",
  invitation: "成员邀请",
  consent: "监护授权",
};
const AUDIT_LABELS: Record<string, string> = {
  "class.enrollments_updated": "更新班级名单",
  "submission.reviewed": "教师确认作业",
  "submission.ai_review_suggested": "生成作业批阅建议",
  "submission.created": "学生提交作业",
  "lesson_plan.generated": "生成教案草稿",
  "lesson_plan.updated": "编辑教案草稿",
  "lesson_plan.archived": "归档教案草稿",
  "diagnostic.completed": "完成入学诊断",
  "member.status_changed": "更新成员状态",
  "member.created": "创建成员",
  "family_task.created": "创建家庭任务",
  "family_task.updated": "编辑家庭任务",
  "family_task.archived": "归档家庭任务",
  "source.reviewed": "审核内容资料",
  "source.reprocessed": "重新处理内容资料",
  "source.archived": "归档内容资料",
  "invitation.created": "创建成员邀请",
  "consent.updated": "更新监护授权",
};

function localDate(value: unknown) {
  const raw = stringValue(value, "");
  if (!raw) return "时间未记录";
  const date = new Date(raw.includes("T") || raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

function generationMode(value: Record<string, unknown>) {
  const provider = stringValue(value.provider ?? value.engine, "");
  return provider.includes("template") ? "内置来源模板" : provider ? "已配置外部模型" : "来源化生成";
}

function textSummary(value: unknown, fallback: string, maxLength = 110) {
  const text = stringValue(value, fallback).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <section className="welcome-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{action}</section>;
}

function MetricGrid({ items }: { items: Array<[string, string | number, string, string]> }) {
  return <section className="metric-grid">{items.map(([label, value, note, tone]) => <article className={`metric-card ${tone}`} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>;
}

export function TeacherView({ nav, data, act, notify }: BaseProps) {
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("中秋节与团圆");
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
  const [reviewScores, setReviewScores] = useState<Record<string, string>>({});
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const pending = data.submissions.filter((item) => item.review_status !== "reviewed");
  const selectedSubmission = data.submissions.find((item) => String(item.id) === selectedSubmissionId) ?? pending[0] ?? null;
  const latestReviewBySubmission = data.submissionReviews.reduce((reviews, item) => {
    const submissionId = String(item.submission_id);
    if (!reviews.has(submissionId)) reviews.set(submissionId, item);
    return reviews;
  }, new Map<string, (typeof data.submissionReviews)[number]>());
  const published = data.assignments.filter((item) => item.status === "published");
  const completion = published.length ? Math.round(data.submissions.length / Math.max(published.length, 1) * 100) : 0;
  const mastery = data.masteryMatrix.length ? Math.round(data.masteryMatrix.reduce((sum, item) => sum + numberValue(item.mastery) * 100, 0) / data.masteryMatrix.length) : 0;

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
    try { await act("create_class", { name: className, level: classLevel }); setClassName(""); notify("班级已创建", "班级已写入当前租户。"); }
    catch (reason) { notify("创建失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  if (nav === "教学总览") return <section>
    <PageTitle eyebrow="最新学习证据 · 班级范围" title="教学总览" detail="按学生与目标读取最新掌握度，避免历史快照重复计入。"/>
    <MetricGrid items={[["班级", data.classes.length, "当前教师可访问", "green"], ["已发布任务", published.length, "目标与量规可追溯", "blue"], ["待批阅", pending.length, "等待教师确认", "orange"], ["平均掌握度", `${mastery}%`, "仅最新快照", "purple"]]}/>
    <TeacherMasteryHeatmap data={data}/>
  </section>;

  if (nav === "班级管理") return <section>
    <PageTitle eyebrow="班级、目标与任务闭环" title="班级管理" detail="每个任务必须关联学习目标，并使用三维评分量规。"/>
    <section className="teacher-class-grid">
      <form className="panel form-card compact-form" onSubmit={createClass}><h3>新建班级</h3><p>先建立教学班，再在右侧配置目标任务。</p><label>班级名称<input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="例如：五年级甲班" required/></label><label>级别<select value={classLevel} onChange={(event) => setClassLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option></select></label><button className="primary-button" disabled={busy}>创建班级</button></form>
      <TeacherAssignmentCreator data={data} act={act} notify={notify}/>
    </section>
    <article className="panel assignment-table"><h3>班级列表</h3><div className="table-wrap"><table><thead><tr><th>班级</th><th>级别</th><th>学年</th><th>学生数</th></tr></thead><tbody>{data.classes.map((item) => <tr key={String(item.id)}><td>{stringValue(item.name)}</td><td>{stringValue(item.level)}</td><td>{stringValue(item.academic_year)}</td><td>{numberValue(item.studentCount)}</td></tr>)}</tbody></table></div></article>
  </section>;

  if (nav === "作业批阅") {
    const selectedId = selectedSubmission ? String(selectedSubmission.id) : "";
    const review = selectedId ? latestReviewBySubmission.get(selectedId) : undefined;
    return <section>
      <PageTitle eyebrow="人工复核与分层支持" title="作业批阅" detail={`${pending.length} 份待审核；教师确认评分后才更新掌握度。`}/>
      <section className="review-top-grid"><TeacherIntervention data={data} act={act} notify={notify}/><article className="panel review-summary"><span className="eyebrow">待处理队列</span><h3>教师确认</h3><p>AI 建议仅供参考，最终成绩和反馈由教师保存。</p><strong>{pending.length} 份待批阅</strong></article></section>
      <section className="review-workspace">
        <article className="panel review-queue"><div className="panel-heading"><div><span className="eyebrow">待办摘要</span><h3>选择待批阅作品</h3></div><span>{pending.length} 份</span></div>{pending.length ? pending.map((item) => <button type="button" className={String(item.id) === selectedId ? "review-queue-item active" : "review-queue-item"} key={String(item.id)} onClick={() => setSelectedSubmissionId(String(item.id))}><span><strong>{stringValue(item.studentName)}</strong><small>{stringValue(item.assignmentTitle)}</small></span><em>{item.asset_key ? "语音" : "文字"}</em></button>) : <p className="empty-state">当前没有待批阅作品。新的学生提交会显示在这里。</p>}</article>
        <article className="panel review-editor">{selectedSubmission ? <><div className="panel-heading"><div><span className="eyebrow">教师批阅面板</span><h3>{stringValue(selectedSubmission.assignmentTitle)}</h3><p>{stringValue(selectedSubmission.studentName)} · {selectedSubmission.asset_key ? "语音文件已保存" : "文字作业"}</p></div><span className="status draft">待审核</span></div><section className="submission-content"><h4>学生提交内容</h4><p>{selectedSubmission.asset_key ? "录音已保存到 R2，请播放原文件后人工确认。" : stringValue(selectedSubmission.text_answer)}</p></section>{selectedSubmission.text_answer && <button type="button" className="soft-button" onClick={async () => { try { const result = await act("suggest_text_review", { id: selectedSubmission.id }); setReviewScores({ ...reviewScores, [selectedId]: String(result.suggestedScore ?? 80) }); setReviewComments({ ...reviewComments, [selectedId]: stringValue(result.comment, "") }); notify("AI 建议已生成", "请核对建议后再确认评分。"); } catch (reason) { notify("生成建议失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>生成 AI 建议</button>}{review?.status === "ai_suggested" && <div className="ai-review-box"><strong>AI 建议：{numberValue(review.ai_suggested_score)} 分</strong><p>{stringValue(review.ai_comment, "暂无文字建议")}</p><small>该建议不会自动写入学生成绩。</small></div>}<form className="review-confirm-form" onSubmit={async (event) => { event.preventDefault(); try { await act("confirm_submission_review", { id: selectedSubmission.id, score: Number(reviewScores[selectedId] ?? review?.ai_suggested_score ?? 80), comment: reviewComments[selectedId] ?? "" }); setSelectedSubmissionId(""); notify("评分已保存", "作业状态和关联目标掌握度已更新。"); } catch (reason) { notify("评分失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}><label>教师确认分数<input type="number" min="0" max="100" value={reviewScores[selectedId] ?? String(review?.ai_suggested_score ?? 80)} onChange={(event) => setReviewScores({ ...reviewScores, [selectedId]: event.target.value })}/></label><label>给学生的反馈<textarea value={reviewComments[selectedId] ?? ""} onChange={(event) => setReviewComments({ ...reviewComments, [selectedId]: event.target.value })} placeholder="说明优点、改进点与下一步建议" maxLength={2000} required/></label><button className="primary-button">教师确认并保存</button></form></> : <p className="empty-state">选择左侧作品后，可在这里查看内容、生成建议并完成教师确认。</p>}</article>
      </section>
    </section>;
  }

  if (nav === "来源化备课") return <section>
    <PageTitle eyebrow="已发布知识内容 → 教案草稿" title="来源化备课" detail="草稿使用已发布来源生成；所有草稿必须由教师审核。"/>
    <section className="teacher-grid lesson-grid">
      <form className="panel form-card" onSubmit={editingPlan ? saveLesson : generate}><h3>{editingPlan ? "编辑教学草稿" : "生成教学草稿"}</h3>{editingPlan && <label>草稿标题<input value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} required/></label>}<label>主题<input value={topic} onChange={(event) => setTopic(event.target.value)} required/></label><div className="field-row"><label>水平<select value={level} onChange={(event) => setLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option></select></label><label>课时<input type="number" min="20" max="90" value={duration} onChange={(event) => setDuration(Number(event.target.value))}/></label></div>{editingPlan && <><label>教学目标<textarea value={objectives.join("\n")} onChange={(event) => setObjectives(event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} required/></label><label>教学环节<textarea value={activities.map((item) => stringValue(item.detail)).join("\n")} onChange={(event) => setActivities(event.target.value.split("\n").filter(Boolean).map((detail, index) => ({ title: `教学环节 ${index + 1}`, minutes: Math.max(5, Math.round(duration / Math.max(1, event.target.value.split("\n").filter(Boolean).length))), detail })))} required/></label></>}<div className="form-actions">{editingPlan && <button type="button" className="soft-button" onClick={() => setEditingPlan(null)}>取消编辑</button>}<button className="primary-button" disabled={busy}>{busy ? "保存中…" : editingPlan ? "保存草稿修改" : "生成并保存草稿"}</button></div></form>
      <article className="panel lesson-drafts"><div className="panel-heading"><div><span className="eyebrow">最近更新</span><h3>最近草稿</h3></div><span>{data.lessonPlans.length} 份</span></div>{data.lessonPlans.length ? data.lessonPlans.map((plan) => <div className="history-row draft-row" key={String(plan.id)}><div><strong>{stringValue(plan.title)}</strong><small>{numberValue(plan.duration_minutes)} 分钟 · {stringValue(plan.level)} · 更新于 {localDate(plan.updated_at ?? plan.created_at)}</small></div><div className="row-actions"><button type="button" className="soft-button" onClick={() => { startEdit(plan); setGenerated(plan); }}>查看 / 编辑草稿</button><button type="button" className="danger-link" onClick={async () => { if (!window.confirm("归档后该草稿将从列表隐藏，是否继续？")) return; try { await act("archive_lesson_plan", { id: plan.id }); notify("草稿已归档", "历史数据和审计记录仍然保留。"); } catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>归档草稿</button></div></div>) : <p className="empty-state">还没有教案草稿。填写左侧主题后即可生成第一份来源化教案。</p>}</article>
    </section>
    {generated && <article className="panel result-card"><span className="safe-chip">已保存 · 等待教师审核 · {generationMode(generated)}</span><h2>{stringValue(generated.title)}</h2><h4>教学目标</h4><ul>{jsonArray<string>(generated.objectives ?? generated.objectives_json).map((item) => <li key={item}>{item}</li>)}</ul><h4>教学环节</h4>{jsonArray<Record<string, unknown>>(generated.activities ?? generated.activities_json).map((item, index) => <div className="citation" key={String(item.title ?? index)}><strong>{stringValue(item.title)} · {numberValue(item.minutes)} 分钟</strong><p>{stringValue(item.detail)}</p></div>)}<h4>引用来源（只读）</h4>{jsonArray<Record<string, unknown>>(generated.citations ?? generated.citations_json).map((item) => <div className="citation" key={String(item.id)}><strong>{stringValue(item.title)}</strong><p>{stringValue(item.excerpt)}</p></div>)}</article>}
  </section>;

  return <><PageTitle eyebrow="教学总览 · 实时数据" title="教学总览" detail={`${data.classes.length} 个班级，${published.length} 项任务正在进行。`}/><MetricGrid items={[["已发布任务", published.length, "来自 assignments 表", "green"], ["待批阅作业", pending.length, "低置信度全部转人工", "orange"], ["平均掌握度", mastery, "来自掌握度快照", "blue"], ["已保存教案", data.lessonPlans.length, "均处于教师审核状态", "purple"]]}/><section className="teacher-grid"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">任务状态</span><h3>近期任务</h3></div></div>{data.assignments.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.className)} · {numberValue(item.submissionCount)} 份提交</small></div>{item.status === "published" ? <span className="status published">进行中</span> : <button className="soft-button" onClick={async () => { try { await act("publish_assignment", { id: item.id }); notify("任务已发布", "学生端现在可以提交。"); } catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>审核并发布</button>}</div>)}</article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">班级证据</span><h3>平均掌握度</h3></div></div><div className="progress-content"><ProgressRing value={mastery} label="掌握度"/><div><strong>{completion}%</strong><p>每项指标都由当前工作区记录计算，不再使用固定演示数字。</p></div></div></article></section></>;
}

export function GuardianView({ nav, data, act, notify, selectStudent }: GuardianProps) {
  const average = data.mastery.length ? Math.round(data.mastery.reduce((sum, item) => sum + numberValue(item.mastery) * 100, 0) / data.mastery.length) : 0;
  const reviewed = data.submissions.filter((item) => item.review_status === "reviewed");
  const childSwitch = <GuardianStudentSwitcher data={data} selectStudent={selectStudent}/>;

  if (nav === "成长报告") return <section>
    <PageTitle eyebrow="可追溯学情" title="成长报告" detail="周报只使用最近 7 天真实作业、教师确认成绩、最新掌握度和待复习项。" action={childSwitch}/>
    <GuardianWeeklyReport data={data}/>
    <article className="panel reviewed-work-list"><h3>已审核作品</h3>{reviewed.length ? reviewed.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.assignmentTitle)}</strong><small>{localDate(item.reviewed_at ?? item.created_at)} · 学习目标：{stringValue(item.objectiveTitles, "未关联目标")}</small><p>教师反馈：{textSummary(item.feedback, "教师暂未填写文字反馈")}</p></div><span className="status published">{numberValue(item.score)} 分</span></div>) : <p className="empty-state">当前孩子最近还没有教师确认的作品。</p>}</article>
  </section>;

  if (nav === "家庭任务") return <section><PageTitle eyebrow="家庭陪伴任务" title="家庭任务" detail="任务会进入孩子的今日计划，并可由家长更新完成状态。" action={childSwitch}/><GuardianFamilyTasks data={data} act={act} notify={notify}/></section>;

  if (nav === "授权管理") return <section><PageTitle eyebrow="未成年人数据控制" title="授权管理" detail="撤回与重新同意都会写入审计日志。" action={childSwitch}/><article className="panel"><div className="consent-row"><div><strong>学习分析授权</strong><p>用于生成掌握度快照和家长报告；不授权给模型供应商训练。</p></div>{(() => { const item = data.consents.find((row) => row.scope === "learning_analytics" && (!data.selectedStudent || row.student_user_id === data.selectedStudent.id)); const granted = item?.status === "granted"; return <button className={granted ? "soft-button" : "primary-button"} disabled={!data.selectedStudent} onClick={async () => { try { await act("update_consent", { studentUserId: data.selectedStudent?.id, scope: "learning_analytics", status: granted ? "withdrawn" : "granted" }); notify("授权状态已更新", granted ? "已撤回学习分析授权。" : "已记录监护人同意。"); } catch (reason) { notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>{granted ? "撤回授权" : "重新同意"}</button>; })()}</div></article></section>;

  const pendingTasks = data.recommendations.filter((item) => item.status === "pending").length;
  const latestFeedback = reviewed[0];
  return <section>
    <PageTitle eyebrow="孩子概览 · 当前状态" title={`${data.selectedStudent?.displayName ?? "孩子"}的学习概览`} detail="查看掌握度、薄弱目标、当前待办和最近教师反馈。" action={childSwitch}/>
    <section className="guardian-hero"><div><span className="eyebrow">本周重点</span><h2>先看证据，再给建议</h2><p>平台不展示虚构时长或提升百分比；建议来自真实作业审核、最新掌握度与待复习项。</p></div><ProgressRing value={average} label="平均掌握度"/></section>
    <MetricGrid items={[["平均掌握度", `${average}%`, `${data.mastery.length} 个能力目标`, "green"], ["当前待办", pendingTasks, "任务与复习项", "orange"], ["教师已确认", reviewed.length, "真实批阅记录", "blue"], ["薄弱目标", data.mastery.filter((item) => numberValue(item.mastery) < 0.6).length, "掌握度低于 60%", "purple"]]}/>
    <section className="guardian-overview-grid"><article className="panel"><h3>能力目标</h3>{data.mastery.map((item) => <div className="history-row" key={String(item.objectiveId ?? item.skill)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.skill)} · {numberValue(item.evidenceCount)} 条证据</small></div><span className={numberValue(item.mastery) < 0.6 ? "status warning" : "status published"}>{Math.round(numberValue(item.mastery) * 100)}%</span></div>)}</article><article className="panel"><h3>最近教师反馈</h3>{latestFeedback ? <div className="feedback-highlight"><strong>{stringValue(latestFeedback.assignmentTitle)}</strong><p>{stringValue(latestFeedback.feedback, "教师已确认成绩，暂未填写文字反馈。")}</p><small>{localDate(latestFeedback.reviewed_at ?? latestFeedback.created_at)} · {numberValue(latestFeedback.score)} 分</small></div> : <p className="empty-state">教师确认作业后，反馈会显示在这里。</p>}</article></section>
  </section>;
}

export function AdminView(props: AdminProps) {
  const { nav, data, act, notify } = props;
  if (nav === "内容中心") return <><LegacyAdminView {...props}/><AdminObjectiveLibrary data={data} act={act} notify={notify}/></>;
  if (nav === "成员管理") return <><LegacyAdminView {...props}/><section className="loop-section enrollment-section"><AdminEnrollmentEditor data={data} act={act} notify={notify}/></section></>;
  if (nav === "机构总览") return <><LegacyAdminView {...props}/><AdminQualityDashboard data={data}/></>;
  return <LegacyAdminView {...props}/>;
}

export function LegacyAdminView({ nav, data, act, refresh, notify }: AdminProps) {
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState("pending");
  const [query, setQuery] = useState("中秋节 团圆");
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedSearchResultId, setSelectedSearchResultId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("teacher");
  const [inviteResult, setInviteResult] = useState<Record<string, unknown> | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [jwtTtlSeconds, setJwtTtlSeconds] = useState(String(data.platformSettings?.jwtTtlSeconds ?? 604800));
  const [aiModel, setAiModel] = useState(data.platformSettings?.aiModel ?? "gpt-5.6-luna");
  const [aiKey, setAiKey] = useState("");
  const [openAiKey, setOpenAiKey] = useState("");
  const [speechKey, setSpeechKey] = useState("");
  const [moderationKey, setModerationKey] = useState("");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(data.audits);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditAction, setAuditAction] = useState("");
  const [auditActor, setAuditActor] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditBusy, setAuditBusy] = useState(false);
  const serviceEntries = Object.entries(data.services);
  const secretLabel = (item?: { configured: boolean; suffix: string }) => item?.configured ? `已配置，尾号 ${item.suffix}` : "未配置";

  async function loadAudits(append = false) {
    setAuditBusy(true);
    try {
      const params = new URLSearchParams();
      if (auditAction) params.set("action", auditAction);
      if (auditActor) params.set("actorId", auditActor);
      if (auditFrom) params.set("from", auditFrom);
      if (auditTo) params.set("to", auditTo);
      if (append && auditCursor) params.set("cursor", auditCursor);
      const response = await fetch(`/api/v1/workspace/audits?${params}`, { cache: "no-store" });
      const payload = await response.json() as { events?: AuditEvent[]; nextCursor?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "审计记录加载失败");
      setAuditEvents(append ? [...auditEvents, ...(payload.events ?? [])] : payload.events ?? []);
      setAuditCursor(payload.nextCursor ?? null);
    } catch (reason) { notify("审计加载失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setAuditBusy(false); }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault(); setSettingsBusy(true);
    try {
      const response = await fetch("/api/v1/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jwtTtlSeconds: Number(jwtTtlSeconds), aiModel, aiKey, openAiKey, speechKey, moderationKey }) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "保存失败");
      setAiKey(""); setOpenAiKey(""); setSpeechKey(""); setModerationKey(""); await refresh(); notify("平台设置已保存", "运行配置已写入 D1，新的请求会使用最新设置。");
    } catch (reason) { notify("保存平台设置失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setSettingsBusy(false); }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file) return; setUploading(true);
    try {
      const form = new FormData(); form.append("file", file); form.append("rightsStatus", rights);
      const response = await fetch("/api/v1/content/upload", { method: "POST", body: form }); const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error); await refresh(); setFile(null); notify("资料已上传", "文件已保存到 R2，元数据已写入 D1，等待权属审核。");
    } catch (reason) { notify("上传失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setUploading(false); }
  }

  if (nav === "平台设置") return <section key="platform-settings">
    <PageTitle eyebrow="部署后配置 · D1 保存" title="平台设置" detail="管理员在这里配置 AI、语音评测、内容审核和会话策略；密钥只显示配置状态。"/>
    <section className="settings-layout"><form className="panel form-card" onSubmit={saveSettings}><h3>运行配置</h3><div className="field-row"><label>会话有效期（秒）<input type="number" min="300" max="2592000" value={jwtTtlSeconds} onChange={(event) => setJwtTtlSeconds(event.target.value)} required/></label><label>AI 模型<input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-5.6-luna" required/></label></div><label>通用 AI Key <small>{secretLabel(data.platformSettings?.aiKey)}</small><input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>OpenAI Key <small>{secretLabel(data.platformSettings?.openAiKey)}</small><input type="password" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>语音评测 Key <small>{secretLabel(data.platformSettings?.speechKey)}</small><input type="password" value={speechKey} onChange={(event) => setSpeechKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>内容审核 Key <small>{secretLabel(data.platformSettings?.moderationKey)}</small><input type="password" value={moderationKey} onChange={(event) => setModerationKey(event.target.value)} placeholder="留空则保留现有值"/></label><button className="primary-button" disabled={settingsBusy}>{settingsBusy ? "保存中…" : "保存平台设置"}</button></form><article className="panel service-health"><div className="panel-heading"><div><span className="eyebrow">当前运行模式</span><h3>当前服务状态</h3></div></div>{serviceEntries.map(([key, service]) => { const status = SERVICE_STATUS[service.status] ?? SERVICE_STATUS.error; return <div className="service-row" key={key}><span className={`service-dot ${status.tone}`}/><p><strong>{SERVICE_NAMES[key] ?? key}<small>{key}</small></strong><span>{service.label}</span></p><b className={`service-badge ${status.tone}`}>{status.label}</b></div>; })}</article></section>
  </section>;

  if (nav === "内容中心") return <section key="content-center">
    <PageTitle eyebrow="R2 文件 + D1 元数据" title="内容中心" detail="上传、权属状态、审核发布与审计记录均为真实操作。"/>
    <form className="panel upload-form" onSubmit={upload}><label>选择资料<input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.mp3,.wav,.webm" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required/></label><label>权属状态<select value={rights} onChange={(event) => setRights(event.target.value)}><option value="pending">待权属核验</option><option value="owned">机构自有</option><option value="licensed">已获得授权</option></select></label><button className="primary-button" disabled={uploading}>{uploading ? "上传中…" : "上传并创建审核记录"}</button></form>
    <article className="panel content-pipeline"><div className="panel-heading"><div><span className="eyebrow">已上传资料</span><h3>内容管线</h3></div><span>{data.documents.length} 份</span></div>{data.documents.length ? data.documents.map((item) => { const previews = Array.isArray(item.previewChunks) ? item.previewChunks.slice(0, 3) : []; const processingError = stringValue(item.processingError, ""); const canReprocess = Boolean(item.object_key) && /pdf|wordprocessingml|text\//.test(stringValue(item.media_type, "")); return <div className="source-row" key={String(item.id)}><div className="source-main"><strong>{stringValue(item.title)}</strong><small>{PROCESSING_LABELS[stringValue(item.processing_status)] ?? stringValue(item.processing_status)} · {numberValue(item.chunkCount)} 个片段（已发布 {numberValue(item.publishedChunkCount)} 个）· {RIGHTS_LABELS[stringValue(item.rights_status)] ?? stringValue(item.rights_status)}</small>{processingError && <p className="form-error">处理失败：{processingError === "unsupported_scanned_pdf" ? "扫描版 PDF 暂不支持提取文本，请上传可检索文本版文件。" : processingError}</p>}</div><span className={`status ${item.processing_status === "published" ? "published" : "draft"}`}>{PROCESSING_LABELS[stringValue(item.processing_status)] ?? stringValue(item.processing_status)}</span><div className="row-actions"><button type="button" className="soft-button" onClick={() => setSelectedDocumentId(String(item.id))}>查看片段</button>{item.processing_status==="processed" && <button type="button" className="soft-button" onClick={async () => { try { await act("review_content", { id: item.id, status: "published" }); notify("内容已发布", "只有已发布知识片段可被检索。"); } catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>审核并发布</button>}<button type="button" className="soft-button" disabled={!canReprocess} title={canReprocess ? "从 R2 原文件重新提取" : "该资料没有可重新处理的文本原文件"} onClick={async () => { try { await act("reprocess_content", { id: item.id }); notify("资料已重新处理", "新片段需要再次完成发布审核。"); } catch (reason) { notify("重新处理失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>重新处理</button><button type="button" className="danger-link" onClick={async () => { if (!window.confirm("归档后该资料将停止检索，是否继续？")) return; try { await act("archive_content", { id: item.id }); notify("资料已归档", "R2 原文件和审计记录仍然保留。"); } catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>归档资料</button></div>{selectedDocumentId === String(item.id) && <div className="content-preview"><div className="panel-heading"><h4>真实知识片段（预览片段）</h4><button type="button" className="soft-button" onClick={() => setSelectedDocumentId("")}>收起</button></div>{previews.length ? previews.map((preview, index) => <p key={index}><b>片段 {index + 1}</b>{stringValue(preview)}</p>) : <p className="empty-state">当前资料还没有可展示的知识片段。</p>}</div>}</div>; }) : <p className="empty-state">还没有内容资料。上传 TXT、DOCX 或文本型 PDF 后即可建立知识片段。</p>}</article>
  </section>;

  if (nav === "知识检索") return <section key="knowledge-search">
    <PageTitle eyebrow="当前租户 · 已发布内容" title="知识检索" detail="只返回通过权属与发布状态校验的知识片段。"/>
    <form className="panel query-panel" onSubmit={async (event) => { event.preventDefault(); try { const response = await fetch("/api/v1/knowledge/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, limit: 10 }) }); const result = await response.json() as { results?: Array<Record<string, unknown>>; error?: string }; if (!response.ok) throw new Error(result.error); setResults(result.results ?? []); } catch (reason) { notify("检索失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}><label>检索词<input value={query} onChange={(event) => setQuery(event.target.value)} required/></label><button className="primary-button">检索已发布知识</button></form>
    <article className="panel search-results"><div className="panel-heading"><div><span className="eyebrow">检索结果</span><h3>{results.length ? `命中 ${results.length} 个知识片段` : "等待检索"}</h3></div></div>{results.length ? results.map((item, index) => { const resultId = String(item.id); const expanded = selectedSearchResultId === resultId; return <div className="citation search-result" key={resultId}><span className="result-rank">{index + 1}</span><div><strong>{stringValue(item.title)}</strong><small>命中 {numberValue(item.score)} 个检索词</small><p>{stringValue(item.excerpt)}</p><button type="button" className="text-link" aria-expanded={expanded} onClick={() => setSelectedSearchResultId(expanded ? "" : resultId)}>{expanded ? "收起来源片段" : "查看来源片段"}</button>{expanded && <div className="source-detail"><b>来源原文（只读）</b><p>{stringValue(item.content, stringValue(item.excerpt))}</p></div>}</div></div>; }) : <p className="empty-state">输入检索词后，这里会展示来源标题、命中依据和相关摘要。</p>}</article>
  </section>;

  if (nav === "成员管理") return <MemberManagementView data={data} act={act} notify={notify}/>;

  if (nav === "权限审计") return <section key="permission-audit">
    <PageTitle eyebrow="租户成员与关键操作" title="权限审计" detail="邀请记录与审计日志均在服务端保存，支持按操作者、类型和日期查询。"/>
    <section className="audit-invite-grid"><form className="panel form-card compact-form" onSubmit={async (event) => { event.preventDefault(); try { const result = await act("create_invitation", { email: inviteEmail, role: inviteRole }); setInviteResult(result); setInviteEmail(""); notify("邀请已创建", "邀请令牌将在 24 小时后失效。"); } catch (reason) { notify("邀请失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}><h3>邀请成员</h3><label>邮箱<input type="email" autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required/></label><label>角色<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="teacher">教师</option><option value="guardian">家长</option><option value="student">学生</option><option value="admin">管理员</option></select></label><button className="primary-button">创建 24 小时邀请</button>{inviteResult && <p className="token-result">邀请码：<code>{stringValue(inviteResult.token)}</code></p>}</form><article className="panel"><h3>待处理邀请</h3>{data.invitations.length ? data.invitations.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.email)}</strong><small>{stringValue(item.role)} · 截止 {localDate(item.expiresAt)}</small></div><span className="status draft">待接受</span></div>) : <div className="empty-state formal-empty"><strong>暂无待处理邀请</strong><p>新建的 24 小时邀请会显示在这里。</p></div>}</article></section>
    <article className="panel audit-panel"><div className="panel-heading"><div><span className="eyebrow">最近审计</span><h3>所有关键操作均可追溯</h3></div></div><form className="audit-filters" onSubmit={(event) => { event.preventDefault(); void loadAudits(false); }}><label>操作类型<select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option value="">全部操作</option>{Object.entries(AUDIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>操作者<select value={auditActor} onChange={(event) => setAuditActor(event.target.value)}><option value="">全部成员</option>{data.members.map((member) => <option key={String(member.id)} value={String(member.id)}>{member.displayName}</option>)}</select></label><label>开始日期<input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)}/></label><label>结束日期<input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)}/></label><button className="primary-button" disabled={auditBusy}>{auditBusy ? "查询中…" : "筛选记录"}</button></form><div className="audit-events">{auditEvents.length ? auditEvents.map((item) => { const targetType = stringValue(item.targetType ?? item.target_type, ""); return <div className="audit-event" key={String(item.id)}><i/><div><strong>{AUDIT_LABELS[stringValue(item.action)] ?? "系统操作"}</strong><p>{stringValue(item.actorDisplayName, "未知操作者")} · {TARGET_LABELS[targetType] ?? "业务对象"}</p><small>{localDate(item.createdAt ?? item.created_at)}</small></div></div>; }) : <div className="empty-state formal-empty"><strong>没有符合条件的审计记录</strong><p>调整筛选条件后重新查询。</p></div>}</div>{auditCursor && <button type="button" className="soft-button load-more" disabled={auditBusy} onClick={() => loadAudits(true)}>加载更多</button>}</article>
  </section>;

  const published = data.documents.filter((item) => item.processing_status === "published").length;
  return <><PageTitle eyebrow={`${data.workspace.name} · ${data.workspace.region.toUpperCase()} 区域`} title="机构运行总览" detail="健康状态来自当前绑定与配置，不再虚构供应商可用率。"/><MetricGrid items={[["班级", data.classes.length, "租户内真实记录", "green"], ["成员角色", data.user.roles.length, "当前登录账号授权", "blue"], ["知识片段", data.documents.reduce((sum, item) => sum + numberValue(item.chunkCount), 0), `${published} 份资料已发布`, "orange"], ["待审核内容", data.documents.filter((item) => item.processing_status !== "published").length, "需人工确认权属", "purple"]]}/><section className="admin-grid"><article className="panel service-health"><div className="panel-heading"><div><span className="eyebrow">服务能力</span><h3>真实配置状态</h3></div></div>{serviceEntries.map(([key, service]) => { const status = SERVICE_STATUS[service.status] ?? SERVICE_STATUS.error; return <div className="service-row" key={key}><span className={`service-dot ${status.tone}`}/><p><strong>{SERVICE_NAMES[key] ?? key}</strong><small>{service.label}</small></p><b className={`service-badge ${status.tone}`}>{status.label}</b></div>; })}</article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">内容治理</span><h3>发布状态</h3></div></div>{data.documents.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{numberValue(item.chunkCount)} 个知识片段</small></div><span className={`status ${item.processing_status === "published" ? "published" : "draft"}`}>{PROCESSING_LABELS[stringValue(item.processing_status)] ?? stringValue(item.processing_status)}</span></div>)}</article></section></>;
}
