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

type BaseProps = { nav: string; data: WorkspaceData; act: Act; notify: Notify };
type GuardianProps = BaseProps & { selectStudent: (studentId: string) => Promise<void> };
type AdminProps = BaseProps & { refresh: () => Promise<void> };

function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) { return <section className="welcome-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{action}</section>; }
function MetricGrid({ items }: { items: Array<[string, string | number, string, string]> }) { return <section className="metric-grid">{items.map(([label,value,note,tone]) => <article className={`metric-card ${tone}`} key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}</section>; }

export function TeacherView({ nav, data, act, notify }: BaseProps) {
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("中秋节与团圆");
  const [level, setLevel] = useState("A2");
  const [duration, setDuration] = useState(40);
  const [generated, setGenerated] = useState<Record<string, unknown> | null>(null);
  const [className, setClassName] = useState("");
  const [classLevel, setClassLevel] = useState("A2");
  const [reviewScores, setReviewScores] = useState<Record<string, string>>({});
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const pending = data.submissions.filter((item) => item.review_status !== "reviewed");
  const latestReviewBySubmission = data.submissionReviews.reduce((reviews, item) => {
    const submissionId = String(item.submission_id);
    if (!reviews.has(submissionId)) reviews.set(submissionId, item);
    return reviews;
  }, new Map<string, (typeof data.submissionReviews)[number]>());
  const published = data.assignments.filter((item) => item.status === "published");
  const completion = published.length ? Math.round(data.submissions.length / Math.max(published.length, 1) * 100) : 0;
  const mastery = data.masteryMatrix.length ? Math.round(data.masteryMatrix.reduce((sum, item) => sum + numberValue(item.mastery) * 100, 0) / data.masteryMatrix.length) : 0;

  async function generate(event: React.FormEvent) { event.preventDefault(); setBusy(true); try { const result = await act("generate_lesson", { topic, level, duration }); setGenerated(result); notify("教案草稿已保存", `已引用 ${(result.citations as unknown[])?.length ?? 0} 条已发布来源。`); } catch (reason) { notify("备课失败", reason instanceof Error ? reason.message : "请重试", "error"); } finally { setBusy(false); } }
  async function createClass(event: React.FormEvent) { event.preventDefault(); setBusy(true); try { await act("create_class", { name: className, level: classLevel }); setClassName(""); notify("班级已创建", "班级已写入当前租户。") } catch (reason) { notify("创建失败", reason instanceof Error ? reason.message : "请重试", "error"); } finally { setBusy(false); } }

  if (nav === "教学总览") return <section>
    <PageTitle eyebrow="最新学习证据 · 班级范围" title="教学总览" detail="按学生与目标读取最新掌握度，避免历史快照重复计入。"/>
    <MetricGrid items={[
      ["班级", data.classes.length, "当前教师可访问", "green"],
      ["已发布任务", published.length, "目标与量规可追溯", "blue"],
      ["待批阅", pending.length, "等待教师确认", "orange"],
      ["平均掌握度", `${mastery}%`, "仅最新快照", "purple"],
    ]}/>
    <TeacherMasteryHeatmap data={data}/>
  </section>;

  if (nav === "班级管理") return <section>
    <PageTitle eyebrow="班级、目标与任务闭环" title="班级管理" detail="每个任务必须关联学习目标，并使用三维评分量规。"/>
    <section className="teacher-grid">
      <form className="panel form-card" onSubmit={createClass}>
        <h3>新建班级</h3>
        <label>班级名称<input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="例如：五年级甲班" required/></label>
        <label>级别<select value={classLevel} onChange={(event) => setClassLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option></select></label>
        <button className="primary-button" disabled={busy}>创建班级</button>
      </form>
      <TeacherAssignmentCreator data={data} act={act} notify={notify}/>
    </section>
    <article className="panel assignment-table"><h3>班级列表</h3><div className="table-wrap"><table><thead><tr><th>班级</th><th>级别</th><th>学年</th><th>学生数</th></tr></thead><tbody>{data.classes.map((item) => <tr key={String(item.id)}><td>{stringValue(item.name)}</td><td>{stringValue(item.level)}</td><td>{stringValue(item.academic_year)}</td><td>{numberValue(item.studentCount)}</td></tr>)}</tbody></table></div></article>
  </section>;

  if (nav === "作业批阅") return <section>
    <PageTitle eyebrow="人工复核与分层支持" title="作业批阅" detail={`${pending.length} 份待审核；教师确认评分后才更新掌握度。`}/>
    <section className="loop-grid">
      <TeacherIntervention data={data} act={act} notify={notify}/>
      <article className="panel"><span className="eyebrow">待处理队列</span><h3>教师确认</h3><p>AI 建议仅供参考，最终成绩和反馈由教师保存。</p><strong>{pending.length} 份待批阅</strong></article>
    </section>
    <article className="panel"><div className="table-wrap"><table>
      <thead><tr><th>学生</th><th>任务</th><th>内容</th><th>状态</th><th>评分</th></tr></thead>
      <tbody>{data.submissions.map((item) => {
        const submissionId = String(item.id);
        const review = latestReviewBySubmission.get(submissionId);
        return <tr key={submissionId}>
          <td>{stringValue(item.studentName)}</td><td>{stringValue(item.assignmentTitle)}</td>
          <td>{item.asset_key ? "语音文件已保存" : stringValue(item.text_answer).slice(0, 80)}</td>
          <td><span className={`status ${item.review_status === "reviewed" ? "published" : "draft"}`}>{item.review_status === "reviewed" ? `${numberValue(item.score)} 分` : "待审核"}</span></td>
          <td>{item.review_status === "reviewed" ? "已完成" : <div className="score-form">
            {item.text_answer && <button type="button" className="soft-button" onClick={async () => {
              try {
                const result = await act("suggest_text_review", { id: item.id });
                setReviewScores({ ...reviewScores, [submissionId]: String(result.suggestedScore ?? 80) });
                setReviewComments({ ...reviewComments, [submissionId]: stringValue(result.comment, "") });
                notify("AI 建议已生成", "请核对建议后再确认评分。");
              } catch (reason) { notify("生成建议失败", reason instanceof Error ? reason.message : "请重试", "error"); }
            }}>生成 AI 建议</button>}
            {review?.status === "ai_suggested" && <div className="ai-review-box"><strong>AI 建议：{numberValue(review.ai_suggested_score)} 分</strong><small>{stringValue(review.ai_comment, "暂无文字建议")}</small></div>}
            <form onSubmit={async (event) => {
              event.preventDefault();
              try {
                await act("confirm_submission_review", { id: item.id, score: Number(reviewScores[submissionId] ?? review?.ai_suggested_score ?? 80), comment: reviewComments[submissionId] ?? "" });
                notify("评分已保存", "作业状态和关联目标掌握度已更新。");
              } catch (reason) { notify("评分失败", reason instanceof Error ? reason.message : "请重试", "error"); }
            }}>
              <input type="number" min="0" max="100" value={reviewScores[submissionId] ?? String(review?.ai_suggested_score ?? 80)} onChange={(event) => setReviewScores({ ...reviewScores, [submissionId]: event.target.value })}/>
              <textarea value={reviewComments[submissionId] ?? ""} onChange={(event) => setReviewComments({ ...reviewComments, [submissionId]: event.target.value })} placeholder="填写给学生的反馈" maxLength={2000}/>
              <button>教师确认</button>
            </form>
          </div>}</td>
        </tr>;
      })}</tbody>
    </table></div>{!data.submissions.length && <p className="empty-state">暂无作业提交。</p>}</article>
  </section>;

  if (nav === "来源化备课") return <section><PageTitle eyebrow="已发布知识内容 → 教案草稿" title="来源化备课" detail="草稿使用已发布来源生成；所有草稿必须由教师审核。"/><section className="teacher-grid"><form className="panel form-card" onSubmit={generate}><h3>生成教学草稿</h3><label>主题<input value={topic} onChange={(event) => setTopic(event.target.value)} required/></label><div className="field-row"><label>水平<select value={level} onChange={(event) => setLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option></select></label><label>课时<input type="number" min="20" max="90" value={duration} onChange={(event) => setDuration(Number(event.target.value))}/></label></div><button className="primary-button" disabled={busy}>{busy ? "正在检索并保存…" : "生成并保存草稿"}</button></form><article className="panel"><h3>最近草稿</h3>{data.lessonPlans.length ? data.lessonPlans.map((plan) => <div className="history-row" key={String(plan.id)}><div><strong>{stringValue(plan.title)}</strong><small>{numberValue(plan.duration_minutes)} 分钟 · {stringValue(plan.level)}</small></div><span className="status draft">待审核</span></div>) : <p className="empty-state">还没有教案草稿。</p>}</article></section>{generated && <article className="panel result-card"><span className="safe-chip">已保存 · 教师审核中 · {stringValue(generated.engine) || stringValue(generated.provider)}</span><h2>{stringValue(generated.title)}</h2><h4>教学目标</h4><ul>{(generated.objectives as string[] ?? []).map((item) => <li key={item}>{item}</li>)}</ul><h4>教学环节</h4>{(generated.activities as Array<{title:string;minutes:number;detail:string}> ?? []).map((item) => <div className="citation" key={item.title}><strong>{item.title} · {item.minutes} 分钟</strong><p>{item.detail}</p></div>)}<h4>引用来源</h4>{(generated.citations as Array<{id:string;title:string;excerpt:string}> ?? []).map((item) => <div className="citation" key={item.id}><strong>{item.title}</strong><p>{item.excerpt}</p></div>)}</article>}</section>;

  return <><PageTitle eyebrow="教学总览 · 实时数据" title="教学总览" detail={`${data.classes.length} 个班级，${published.length} 项任务正在进行。`}/><MetricGrid items={[["已发布任务",published.length,"来自 assignments 表","green"],["待批阅作业",pending.length,"低置信度全部转人工","orange"],["平均掌握度",mastery,"来自掌握度快照","blue"],["已保存教案",data.lessonPlans.length,"均处于教师审核状态","purple"]]}/><section className="teacher-grid"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">任务状态</span><h3>近期任务</h3></div></div>{data.assignments.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.className)} · {numberValue(item.submissionCount)} 份提交</small></div>{item.status === "published" ? <span className="status published">进行中</span> : <button className="soft-button" onClick={async () => { try { await act("publish_assignment", { id: item.id }); notify("任务已发布", "学生端现在可以提交。") } catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}>审核并发布</button>}</div>)}</article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">班级证据</span><h3>平均掌握度</h3></div></div><div className="progress-content"><ProgressRing value={mastery} label="掌握度"/><div><strong>{completion}%</strong><p>每项指标都由当前工作区记录计算，不再使用固定演示数字。</p></div></div></article></section></>;
}

export function GuardianView({ nav, data, act, notify, selectStudent }: GuardianProps) {
  const average = data.mastery.length ? Math.round(data.mastery.reduce((sum, item) => sum + numberValue(item.mastery) * 100, 0) / data.mastery.length) : 0;
  const childSwitch = <GuardianStudentSwitcher data={data} selectStudent={selectStudent}/>;

  if (nav === "成长报告") return <section>
    <PageTitle eyebrow="可追溯学情" title="成长报告" detail="周报只使用最近 7 天真实作业、教师确认成绩、最新掌握度和待复习项。" action={childSwitch}/>
    <GuardianWeeklyReport data={data}/>
    <article className="panel"><h3>已审核作品</h3>{data.submissions.filter((item) => item.review_status === "reviewed").map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.assignmentTitle)}</strong><small>{stringValue(item.created_at)}</small></div><span className="status published">{numberValue(item.score)} 分</span></div>)}</article>
  </section>;

  if (nav === "家庭任务") return <section>
    <PageTitle eyebrow="家庭陪伴任务" title="家庭任务" detail="任务会进入孩子的今日计划，并可由家长更新完成状态。" action={childSwitch}/>
    <GuardianFamilyTasks data={data} act={act} notify={notify}/>
  </section>;

  if (nav === "授权管理") return <section>
    <PageTitle eyebrow="未成年人数据控制" title="授权管理" detail="撤回与重新同意都会写入审计日志。" action={childSwitch}/>
    <article className="panel"><div className="consent-row"><div><strong>学习分析授权</strong><p>用于生成掌握度快照和家长报告；不授权给模型供应商训练。</p></div>{(() => {
      const item = data.consents.find((row) => row.scope === "learning_analytics" && (!data.selectedStudent || row.student_user_id === data.selectedStudent.id));
      const granted = item?.status === "granted";
      return <button className={granted ? "soft-button" : "primary-button"} disabled={!data.selectedStudent} onClick={async () => {
        try {
          await act("update_consent", { studentUserId: data.selectedStudent?.id, scope: "learning_analytics", status: granted ? "withdrawn" : "granted" });
          notify("授权状态已更新", granted ? "已撤回学习分析授权。" : "已记录监护人同意。");
        } catch (reason) { notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error"); }
      }}>{granted ? "撤回授权" : "重新同意"}</button>;
    })()}</div></article>
  </section>;

  return <>
    <PageTitle eyebrow="孩子概览 · 当前工作区" title={`${data.selectedStudent?.displayName ?? "孩子"}的学习概览`} detail={`${data.submissions.length} 次提交，${data.submissions.filter((item) => item.review_status === "reviewed").length} 次已由教师审核。`} action={childSwitch}/>
    <section className="guardian-hero"><div><span className="eyebrow">本周重点</span><h2>先看证据，再给建议</h2><p>平台不展示虚构时长或提升百分比；建议来自真实作业审核、最新掌握度与待复习项。</p></div><ProgressRing value={average} label="平均掌握度"/></section>
    <GuardianWeeklyReport data={data}/>
    <section className="dashboard-grid">{data.mastery.map((item) => <article className="panel" key={String(item.objectiveId ?? item.skill)}><span className="eyebrow">{stringValue(item.skill)}</span><h3>{Math.round(numberValue(item.mastery) * 100)} 分</h3><p>{stringValue(item.title)} · {numberValue(item.evidenceCount)} 条证据</p></article>)}</section>
  </>;
}

export function AdminView(props: AdminProps) {
  const { nav, data, act, notify } = props;
  if (nav === "内容中心") return <><LegacyAdminView {...props}/><AdminObjectiveLibrary data={data} act={act} notify={notify}/></>;
  if (nav === "成员管理") return <><LegacyAdminView {...props}/><section className="loop-section"><AdminEnrollmentEditor data={data} act={act} notify={notify}/></section></>;
  if (nav === "机构总览") return <><LegacyAdminView {...props}/><AdminQualityDashboard data={data}/></>;
  return <LegacyAdminView {...props}/>;
}

export function LegacyAdminView({ nav, data, act, refresh, notify }: AdminProps) {
  const [uploading,setUploading]=useState(false); const [file,setFile]=useState<File|null>(null); const [rights,setRights]=useState("pending");
  const [query,setQuery]=useState("中秋节 团圆"); const [results,setResults]=useState<Array<Record<string,unknown>>>([]);
  const [inviteEmail,setInviteEmail]=useState(""); const [inviteRole,setInviteRole]=useState("teacher"); const [inviteResult,setInviteResult]=useState<Record<string,unknown>|null>(null);
  const [memberEmail,setMemberEmail]=useState(""); const [memberDisplayName,setMemberDisplayName]=useState(""); const [memberRole,setMemberRole]=useState("teacher"); const [temporaryPassword,setTemporaryPassword]=useState(""); const [resetPasswords,setResetPasswords]=useState<Record<string,string>>({});
  const [guardianUserId,setGuardianUserId]=useState(""); const [studentUserIds,setStudentUserIds]=useState<string[]>([]);
  const [settingsBusy,setSettingsBusy]=useState(false); const [jwtTtlSeconds,setJwtTtlSeconds]=useState(String(data.platformSettings?.jwtTtlSeconds ?? 604800)); const [aiModel,setAiModel]=useState(data.platformSettings?.aiModel ?? "gpt-5.6-luna"); const [aiKey,setAiKey]=useState(""); const [openAiKey,setOpenAiKey]=useState(""); const [speechKey,setSpeechKey]=useState(""); const [moderationKey,setModerationKey]=useState("");
  const serviceEntries=Object.entries(data.services);
  const secretLabel=(item?:{configured:boolean;suffix:string})=>item?.configured?`已配置，尾号 ${item.suffix}`:"未配置";
  async function saveSettings(event:React.FormEvent){event.preventDefault();setSettingsBusy(true);try{const response=await fetch("/api/v1/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jwtTtlSeconds:Number(jwtTtlSeconds),aiModel,aiKey,openAiKey,speechKey,moderationKey})});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error??"保存失败");setAiKey("");setOpenAiKey("");setSpeechKey("");setModerationKey("");await refresh();notify("平台设置已保存","运行配置已写入 D1，新的请求会使用最新设置。")}catch(reason){notify("保存平台设置失败",reason instanceof Error?reason.message:"请重试","error")}finally{setSettingsBusy(false)}}
  async function upload(event:React.FormEvent){event.preventDefault();if(!file)return;setUploading(true);try{const form=new FormData();form.append("file",file);form.append("rightsStatus",rights);const response=await fetch("/api/v1/content/upload",{method:"POST",body:form});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error);await refresh();setFile(null);notify("资料已上传","文件已保存到 R2，元数据已写入 D1，等待权属审核。")}catch(reason){notify("上传失败",reason instanceof Error?reason.message:"请重试","error")}finally{setUploading(false)}}
  if(nav==="平台设置")return <section><PageTitle eyebrow="部署后配置 · D1 保存" title="平台设置" detail="部署前不需要填写变量或密钥；管理员在这里配置 AI、语音评测、内容审核和会话策略。"/><form className="panel form-card" onSubmit={saveSettings}><h3>运行配置</h3><div className="field-row"><label>会话有效期（秒）<input type="number" min="300" max="2592000" value={jwtTtlSeconds} onChange={(event)=>setJwtTtlSeconds(event.target.value)} required/></label><label>AI 模型<input value={aiModel} onChange={(event)=>setAiModel(event.target.value)} placeholder="gpt-5.6-luna" required/></label></div><label>通用 AI Key <small>{secretLabel(data.platformSettings?.aiKey)}</small><input type="password" value={aiKey} onChange={(event)=>setAiKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>OpenAI Key <small>{secretLabel(data.platformSettings?.openAiKey)}</small><input type="password" value={openAiKey} onChange={(event)=>setOpenAiKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>语音评测 Key <small>{secretLabel(data.platformSettings?.speechKey)}</small><input type="password" value={speechKey} onChange={(event)=>setSpeechKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>内容审核 Key <small>{secretLabel(data.platformSettings?.moderationKey)}</small><input type="password" value={moderationKey} onChange={(event)=>setModerationKey(event.target.value)} placeholder="留空则保留现有值"/></label><button className="primary-button" disabled={settingsBusy}>{settingsBusy?"保存中…":"保存平台设置"}</button></form><article className="panel service-health"><h3>当前服务状态</h3>{serviceEntries.map(([key,service])=><div className="service-row" key={key}><span className={`service-dot ${service.status==="configured"||service.status==="available"?"":"warning"}`}/><p><strong>{key}</strong><small>{service.label}</small></p><b>{service.status}</b></div>)}</article></section>;
  if(nav==="内容中心")return <section><PageTitle eyebrow="R2 文件 + D1 元数据" title="内容中心" detail="上传、权属状态、审核发布与审计记录均为真实操作。"/><form className="panel upload-form" onSubmit={upload}><label>选择资料<input type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.mp3,.wav,.webm" onChange={(event)=>setFile(event.target.files?.[0]??null)} required/></label><label>权属状态<select value={rights} onChange={(event)=>setRights(event.target.value)}><option value="pending">待权属核验</option><option value="owned">机构自有</option><option value="licensed">已获得授权</option></select></label><button className="primary-button" disabled={uploading}>{uploading?"上传中…":"上传并创建审核记录"}</button></form><article className="panel"><h3>内容管线</h3>{data.documents.map((item)=>{const previews=Array.isArray(item.previews)?item.previews.slice(0,3):[];const processingError=stringValue(item.processingError,"");return <div className="source-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.media_type)} · 处理状态 {stringValue(item.processing_status)} · {numberValue(item.chunkCount)} 个片段（已发布 {numberValue(item.publishedChunkCount)} 个）· 权属 {stringValue(item.rights_status)}</small>{processingError && <p className="form-error">处理失败：{processingError === "unsupported_scanned_pdf" ? "扫描版 PDF 暂不支持提取文本，请上传可检索文本版文件。" : processingError}</p>}<div className="content-preview"><strong>预览片段</strong>{previews.length ? previews.map((preview,index)=><p key={index}>{stringValue(preview)}</p>) : <small>内容处理完成后将显示最多三个知识片段预览。</small>}</div></div><span className={`status ${item.processing_status==="published"?"published":"draft"}`}>{stringValue(item.processing_status)}</span>{item.processing_status==="processed"&&<button className="soft-button" onClick={async()=>{try{await act("review_content",{id:item.id,status:"published"});notify("内容已发布","该资料元数据通过审核；只有已发布知识片段可被检索。") }catch(reason){notify("发布失败",reason instanceof Error?reason.message:"请重试","error")}}}>审核并发布</button>}</div>})}</article></section>;
  if(nav==="知识检索")return <section><PageTitle eyebrow="当前租户 · 已发布内容" title="知识检索" detail="只返回通过权属与发布状态校验的知识片段。"/><form className="panel query-panel" onSubmit={async(event)=>{event.preventDefault();try{const response=await fetch("/api/v1/knowledge/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query,limit:10})});const result=await response.json() as {results?:Array<Record<string,unknown>>;error?:string};if(!response.ok)throw new Error(result.error);setResults(result.results??[])}catch(reason){notify("检索失败",reason instanceof Error?reason.message:"请重试","error")}}}><label>检索词<input value={query} onChange={(event)=>setQuery(event.target.value)} required/></label><button className="primary-button">检索已发布知识</button></form><article className="panel">{results.length?results.map((item)=><div className="citation" key={String(item.id)}><strong>{stringValue(item.title)} · 匹配度 {numberValue(item.score)}</strong><p>{stringValue(item.excerpt)}</p></div>):<p className="empty-state">输入检索词查看结果。</p>}</article></section>;
  if(nav==="成员管理") { const guardians=data.members.filter((item)=>stringValue(item.roles,"").split(",").includes("guardian")); const students=data.members.filter((item)=>stringValue(item.roles,"").split(",").includes("student")); return <section><PageTitle eyebrow="租户成员与监护关系" title="成员管理" detail="成员账号、临时密码和监护人绑定均会写入审计记录。"/><section className="admin-grid"><form className="panel form-card" onSubmit={async(event)=>{event.preventDefault();try{await act("create_member",{email:memberEmail,displayName:memberDisplayName,role:memberRole,temporaryPassword});setMemberEmail("");setMemberDisplayName("");setTemporaryPassword("");notify("成员已创建","首次登录时需要修改临时密码。")}catch(reason){notify("创建失败",reason instanceof Error?reason.message:"请重试","error")}}}><h3>创建成员</h3><label>邮箱<input type="email" value={memberEmail} onChange={(event)=>setMemberEmail(event.target.value)} required/></label><label>显示名称<input value={memberDisplayName} onChange={(event)=>setMemberDisplayName(event.target.value)} required/></label><label>角色<select value={memberRole} onChange={(event)=>setMemberRole(event.target.value)}><option value="teacher">教师</option><option value="guardian">家长</option><option value="student">学生</option><option value="admin">管理员</option></select></label><label>临时密码<input type="password" value={temporaryPassword} onChange={(event)=>setTemporaryPassword(event.target.value)} required/></label><button className="primary-button">创建成员</button></form><form className="panel form-card" onSubmit={async(event)=>{event.preventDefault();try{await act("set_guardian_links",{guardianUserId,studentUserIds});setStudentUserIds([]);notify("监护人绑定已更新","已保存当前监护人与学生的关联。")}catch(reason){notify("绑定失败",reason instanceof Error?reason.message:"请重试","error")}}}><h3>监护人绑定</h3><label>监护人<select value={guardianUserId} onChange={(event)=>setGuardianUserId(event.target.value)} required><option value="">请选择</option>{guardians.map((item)=><option key={String(item.id)} value={String(item.id)}>{stringValue(item.displayName)} · {stringValue(item.email)}</option>)}</select></label><div>{students.map((item)=>{const id=String(item.id);return <label key={id}><input type="checkbox" checked={studentUserIds.includes(id)} onChange={(event)=>setStudentUserIds(event.target.checked?[...studentUserIds,id]:studentUserIds.filter((studentId)=>studentId!==id))}/>{stringValue(item.displayName)} · {stringValue(item.email)}</label>})}</div><button className="primary-button">保存监护人绑定</button></form></section><article className="panel member-table"><h3>成员列表</h3><div className="table-wrap"><table><thead><tr><th>邮箱</th><th>显示名称</th><th>角色</th><th>状态</th><th>首次改密</th><th>操作</th></tr></thead><tbody>{data.members.map((item)=>{const id=String(item.id);const disabled=item.status==="disabled";return <tr key={id}><td>{stringValue(item.email)}</td><td>{stringValue(item.displayName)}</td><td>{stringValue(item.roles)}</td><td>{stringValue(item.status)}</td><td>{item.mustChangePassword ? "需要" : "否"}</td><td><form className="score-form" onSubmit={async(event)=>{event.preventDefault();try{await act("reset_member_password",{userId:id,temporaryPassword:resetPasswords[id]??""});setResetPasswords({...resetPasswords,[id]:""});notify("临时密码已重置","该成员下次登录时必须修改密码。")}catch(reason){notify("重置失败",reason instanceof Error?reason.message:"请重试","error")}}}><input type="password" value={resetPasswords[id]??""} onChange={(event)=>setResetPasswords({...resetPasswords,[id]:event.target.value})} placeholder="新临时密码" required/><button>重置</button></form><button type="button" className="soft-button" onClick={async()=>{try{await act("set_member_status",{userId:id,status:disabled?"active":"disabled"});notify("成员状态已更新",disabled?"成员已启用。":"成员已停用。") }catch(reason){notify("更新失败",reason instanceof Error?reason.message:"请重试","error")}}}>{disabled?"启用":"停用"}</button></td></tr>})}</tbody></table></div><h3>当前监护关系</h3>{data.guardianLinks.length?data.guardianLinks.map((link)=><p key={`${link.guardianUserId}-${link.studentUserId}`}>{link.guardianUserId} → {link.studentUserId}</p>):<p className="empty-state">尚未建立监护人绑定。</p>}</article></section>; }
  if(nav==="权限审计")return <section><PageTitle eyebrow="租户成员与关键操作" title="权限审计" detail="邀请记录与审计日志均在服务端保存。"/><section className="admin-grid"><form className="panel form-card" onSubmit={async(event)=>{event.preventDefault();try{const result=await act("create_invitation",{email:inviteEmail,role:inviteRole});setInviteResult(result);setInviteEmail("");notify("邀请已创建","邀请令牌将在 24 小时后失效。") }catch(reason){notify("邀请失败",reason instanceof Error?reason.message:"请重试","error")}}}><h3>邀请成员</h3><label>邮箱<input type="email" value={inviteEmail} onChange={(event)=>setInviteEmail(event.target.value)} required/></label><label>角色<select value={inviteRole} onChange={(event)=>setInviteRole(event.target.value)}><option value="teacher">教师</option><option value="guardian">家长</option><option value="student">学生</option><option value="admin">管理员</option></select></label><button className="primary-button">创建 24 小时邀请</button>{inviteResult&&<p className="token-result">邀请码：<code>{stringValue(inviteResult.token)}</code></p>}</form><article className="panel"><h3>待处理邀请</h3>{data.invitations.map((item)=><div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.email)}</strong><small>{stringValue(item.role)} · 截止 {stringValue(item.expiresAt)}</small></div><span className="status draft">{stringValue(item.status)}</span></div>)}</article></section><article className="panel audit-strip"><div><span className="eyebrow">最近审计</span><h3>所有关键操作均可追溯</h3></div><div className="audit-events">{data.audits.map((item)=><span key={String(item.id)}><i/>{stringValue(item.action)} · {stringValue(item.target_type)} <small>{stringValue(item.created_at)}</small></span>)}</div></article></section>;
  const published=data.documents.filter((item)=>item.processing_status==="published").length;
  return <><PageTitle eyebrow={`${data.workspace.name} · ${data.workspace.region.toUpperCase()} 区域`} title="机构运行总览" detail="健康状态来自当前绑定与配置，不再虚构供应商可用率。"/><MetricGrid items={[["班级",data.classes.length,"租户内真实记录","green"],["成员角色",data.user.roles.length,"当前登录账号授权","blue"],["知识片段",data.documents.reduce((sum,item)=>sum+numberValue(item.chunkCount),0),`${published} 份资料已发布`,"orange"],["待审核内容",data.documents.filter((item)=>item.processing_status!=="published").length,"需人工确认权属","purple"]]}/><section className="admin-grid"><article className="panel service-health"><div className="panel-heading"><div><span className="eyebrow">服务能力</span><h3>真实配置状态</h3></div></div>{serviceEntries.map(([key,service])=><div className="service-row" key={key}><span className={`service-dot ${service.status==="configured"||service.status==="available"?"":"warning"}`}/><p><strong>{key}</strong><small>{service.label}</small></p><b>{service.status}</b></div>)}</article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">内容治理</span><h3>发布状态</h3></div></div>{data.documents.map((item)=><div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{numberValue(item.chunkCount)} 个知识片段</small></div><span className={`status ${item.processing_status==="published"?"published":"draft"}`}>{stringValue(item.processing_status)}</span></div>)}</article></section></>;
}
