"use client";

import { useState } from "react";
import { isRecommendationDue } from "./lib/learning-loop";
import type { Act, Notify, WorkspaceData } from "./lib/platform-types";
import { numberValue, stringValue } from "./lib/platform-types";
import { DiagnosticMediaInput, DiagnosticStimulus } from "./diagnostic-evidence";
import type { InterventionSuggestion } from "./lib/diagnostic-types";
import { createFamilyPlan, EXCHANGE_PARTNERS, FAMILY_TASK_TEMPLATES, readFamilyPlan, type ExchangePartner } from "./lib/family-task";
import { FamilyExchangeConfirmation, FamilyTaskGuide, FamilyWorkEvidence } from "./family-task-guide";

type LoopProps = { data: WorkspaceData; act: Act; notify: Notify };

function optionsFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function dueLabel(value: unknown) {
  const raw = stringValue(value, "");
  if (!raw) return "无截止时间";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fullDateLabel(value: unknown) {
  const raw = stringValue(value, "");
  if (!raw) return "暂无更新时间";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function StudentDiagnostic({ data, act, notify, onStartAssignment }: LoopProps & { onStartAssignment?: (id: string) => void }) {
  const levels = [...new Set(data.diagnosticItems.map((item) => stringValue(item.level, "A2")))];
  const [selectedLevel, setSelectedLevel] = useState(levels[0] ?? "A2");
  const items = data.diagnosticItems.filter((item) => stringValue(item.level, "A2") === selectedLevel);
  const [answers, setAnswers] = useState<Record<string, { selectedOption: number; revision: number }>>({});
  const [busy, setBusy] = useState(false);
  const level = selectedLevel;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!items.every((item) => answers[String(item.id)]?.revision === Number(item.revision))) {
      notify("还有题目未完成或已更新", "请按当前题面回答全部四选一题目后再提交。", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await act("submit_diagnostic", {
        level,
        answers: items.map((item) => ({ itemId: String(item.id), ...answers[String(item.id)] })),
      });
      setAnswers({});
      notify("诊断已完成", `本次正确率 ${Math.round(numberValue(result.score) * 100)}%，错题已加入复习中心。`);
    } catch (reason) {
      notify("诊断提交失败", reason instanceof Error && reason.message === "invalid_diagnostic_revision" ? "题目在作答期间已更新，请刷新页面后重新作答；本次未生成成绩。" : reason instanceof Error ? reason.message : "请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel loop-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">不依赖外部模型</span><h3>客观题入学诊断</h3></div>
      {data.diagnosticSummary && <span className="score-pill">最近 {Math.round(numberValue(data.diagnosticSummary.score) * 100)}%</span>}
    </div>
    <p>选择题记录阅读或听力表现；口述与短文表达由教师评价，不能用选择题总分代替。</p>
    {levels.length > 1 && <label className="diagnostic-level">
      诊断级别
      <select value={selectedLevel} disabled={busy} onChange={(event) => {
        setSelectedLevel(event.target.value);
        setAnswers({});
      }}>
        {levels.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>}
    {items.length ? <form onSubmit={submit} className="diagnostic-form">
      {items.map((item, index) => {
        const id = String(item.id);
        const options = optionsFrom(item.optionsJson ?? item.options_json);
        const mediaId = item.mediaId ?? item.media_id;
        return <fieldset key={id}>
          <legend><b>{index + 1}.</b> {stringValue(item.prompt)} <small>{stringValue(item.objectiveTitle)}</small></legend>
          {item.ability === "listening" && !!mediaId && <DiagnosticStimulus id={String(mediaId)} kind="audio"/>}
          <div className="option-grid">{options.map((option, optionIndex) => <label key={option}>
            <input type="radio" name={`diagnostic-${id}`} disabled={busy} checked={answers[id]?.revision === Number(item.revision) && answers[id]?.selectedOption === optionIndex} onChange={() => setAnswers({ ...answers, [id]: { selectedOption: optionIndex, revision: Number(item.revision) } })}/>
            <span>{String.fromCharCode(65 + optionIndex)}. {option}</span>
          </label>)}</div>
        </fieldset>;
      })}
      <button className="primary-button" disabled={busy}>{busy ? "正在提交…" : "提交诊断"}</button>
    </form> : <p className="empty-state">机构尚未发布当前级别的诊断题。</p>}
    <h4>口述与短文诊断</h4>
    {data.assignments.filter((item) => item.status === "published" && item.diagnostic_mode).map((item) => <div className="history-row" key={String(item.id)}>
      <div><strong>{stringValue(item.title)}</strong><small>{item.diagnostic_mode === "speaking" ? "图片口述 · 提交录音" : "短文表达 · 提交文字"} · 教师评价</small></div>
      {onStartAssignment && <button className="soft-button" type="button" onClick={() => onStartAssignment(String(item.id))}>进入诊断任务</button>}
    </div>)}
    {!data.assignments.some((item) => item.status === "published" && item.diagnostic_mode) && <p className="empty-state">老师发布图片口述或短文诊断后，可在此进入。没有作品的能力保持待评估。</p>}
  </section>;
}

export function StudentTodayPlan({ data, act, notify, navigate, onStartTask }: LoopProps & { navigate: (target: string) => void; onStartTask?: (id: string) => void }) {
  const [busyId, setBusyId] = useState("");
  const kindLabels: Record<string, string> = { teacher: "教师干预", review: "到期错题", family: "家庭任务", assignment: "学习作业", sequence: "练习与迁移" };
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
  return <article className="panel loop-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">固定规则 · 可解释排序</span><h3>今日学习计划</h3></div>
      <span>{data.learningPlan.length}/3</span>
    </div>
    <p>最多显示 3 项，优先处理教师干预、到期错题和家庭任务。</p>
    {data.learningPlan.length ? data.learningPlan.map((item, index) => <div className="plan-row" key={String(item.id)}>
      <span className="plan-order">{index + 1}</span>
      <div><strong>{stringValue(item.title)}</strong><small>{kindLabels[stringValue(item.kind, "")] ?? "普通作业"} · {dueLabel(item.dueAt ?? item.due_at)}</small>
        {item.kind === "teacher" && !!item.detail && <details className="support-evidence"><summary>查看练习与选择依据</summary><p className="generated-copy">{String(item.detail)}</p><small>标记完成仅记录练习状态，不生成能力成绩。</small></details>}
      </div>
      {item.kind === "sequence" && item.waitingReview ? <span className="status draft">待教师评价</span> : item.kind === "family" && item.familyReviewStatus && item.familyReviewStatus !== "reviewed" ? <span className="status draft">{item.familyConfirmedAt ? "待教师评价" : "待家长确认"}</span> : <button className="soft-button" type="button" disabled={busyId === String(item.id)} onClick={() => handle(item)}>
        {stringValue(item.kind, "") === "review" ? "进入复习" : item.kind === "assignment" || item.kind === "family" || item.kind === "sequence" ? "进入作业" : busyId === String(item.id) ? "更新中…" : "标记完成"}
      </button>}
    </div>) : <p className="empty-state">今天没有待办，完成新作业后会生成下一步计划。</p>}
  </article>;
}

export function StudentReviewCenter({ data, act, notify }: LoopProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState("");
  const reviews = data.recommendations.filter((item) =>
    item.source_type === "diagnostic"
    && item.status === "pending"
    && isRecommendationDue(typeof item.due_at === "string" ? item.due_at : null)
  );

  async function answer(id: string) {
    if (!Number.isInteger(answers[id])) return notify("请选择答案", "选择一个选项后再提交。", "error");
    setBusyId(id);
    try {
      const result = await act("answer_review_item", { id, selectedOption: answers[id] });
      notify(result.correct ? "回答正确" : "需要再巩固", result.correct ? "这道错题已完成。" : "系统已安排次日再次复习。");
    } catch (reason) {
      notify("复习提交失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusyId("");
    }
  }

  return <article className="panel loop-panel">
    <div className="panel-heading"><div><span className="eyebrow">主动回忆 · 错题追踪</span><h3>错题复习中心</h3></div><span>{reviews.length} 题</span></div>
    {reviews.length ? reviews.map((item) => {
      const id = String(item.id);
      const options = optionsFrom(item.reviewOptionsJson);
      return <div className="review-card" key={id}>
        <strong>{stringValue(item.reviewPrompt, stringValue(item.title))}</strong>
        <small>{stringValue(item.objectiveTitle)} · {dueLabel(item.due_at)}</small>
        {item.reviewAbility === "listening" && !!item.reviewMediaId && <DiagnosticStimulus id={String(item.reviewMediaId)} kind="audio"/>}
        <div className="option-grid">{options.map((option, index) => <label key={option}>
          <input type="radio" name={`review-${id}`} checked={answers[id] === index} onChange={() => setAnswers({ ...answers, [id]: index })}/>
          <span>{String.fromCharCode(65 + index)}. {option}</span>
        </label>)}</div>
        <button className="soft-button" type="button" disabled={busyId === id} onClick={() => answer(id)}>{busyId === id ? "提交中…" : "检查答案"}</button>
      </div>;
    }) : <p className="empty-state">暂无到期错题，完成入学诊断后可在这里复习。</p>}
  </article>;
}

export function TeacherAssignmentCreator({ data, act, notify }: LoopProps) {
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState(String(data.classes[0]?.id ?? ""));
  const [objectiveId, setObjectiveId] = useState(String(data.learningObjectives.find((item) => item.status !== "inactive")?.id ?? ""));
  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [diagnosticMode, setDiagnosticMode] = useState("");
  const [diagnosticPrompt, setDiagnosticPrompt] = useState("");
  const [diagnosticMediaId, setDiagnosticMediaId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [publishingId, setPublishingId] = useState("");
  const rubric = diagnosticMode ? [{ name: "任务完成", weight: 40 }, { name: "表达清晰", weight: 35 }, { name: "组织条理", weight: 25 }] : [
    { name: "内容准确性", weight: 40 },
    { name: "语言表达", weight: 35 },
    { name: "文化理解", weight: 25 },
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await act("create_assignment", {
        title,
        classId,
        activityType: "综合任务",
        objectiveIds: [objectiveId],
        rubric,
        dueAt: dueAt || null,
        diagnosticMode, diagnosticPrompt, diagnosticMediaId,
      });
      setTitle("");
      setDiagnosticPrompt(""); setDiagnosticMediaId("");
      notify("目标任务草稿已创建", "任务关联了学习目标和三维评分量规，可审核后发布。");
    } catch (reason) {
      notify("创建失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return <section className="loop-section"><form className="panel form-card" onSubmit={submit}>
    <div><span className="eyebrow">目标对齐 · 三维量规</span><h3>目标与评分量规任务</h3></div>
    <fieldset className="diagnostic-form-fields" disabled={busy || uploading}>
    <label>任务名称<input value={title} onChange={(event) => setTitle(event.target.value)} required/></label>
    <label>班级<select value={classId} onChange={(event) => setClassId(event.target.value)} required>{data.classes.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.name)}</option>)}</select></label>
    <label>学习目标<select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required>{data.learningObjectives.filter((item) => item.status !== "inactive").map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.code)} · {stringValue(item.title)}</option>)}</select></label>
    <label>任务用途<select value={diagnosticMode} disabled={busy || uploading} onChange={(event) => { setDiagnosticMode(event.target.value); setDiagnosticMediaId(""); }}><option value="">普通学习任务</option><option value="speaking">图片口述诊断</option><option value="writing">短文表达诊断</option></select></label>
    {diagnosticMode && <><label>诊断要求<textarea value={diagnosticPrompt} disabled={busy} onChange={(event) => setDiagnosticPrompt(event.target.value)} required maxLength={2000} placeholder="说明观察什么、需要完成什么，以及可以使用的帮助。"/></label>
      <DiagnosticMediaInput kind="image" value={diagnosticMediaId} onChange={setDiagnosticMediaId} uploading={uploading} setUploading={setUploading} notify={notify} disabled={busy}/>
      <small>{diagnosticMode === "speaking" ? "图片口述必须提供图片，学生提交录音。" : "短文表达提交文字；图片可选。"}每个目标由教师独立评价。</small></>}
    <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
    <div className="rubric-list">{rubric.map((item) => <span key={item.name}><b>{item.name}</b>{item.weight}%</span>)}</div>
    <small>固定 3 个维度，权重合计 100%。</small>
    </fieldset>
    <button className="primary-button" disabled={busy || uploading || !classId || !objectiveId || (diagnosticMode === "speaking" && !diagnosticMediaId)}>{busy ? "保存中…" : "保存任务草稿"}</button>
  </form><article className="panel"><h3>本班任务与发布</h3>{data.assignments.filter((item) => item.class_id === classId).map((item) => <div className="assignment-publish-row" key={String(item.id)}>
    <strong>{stringValue(item.title)}</strong>{!!item.diagnostic_prompt && <p>{String(item.diagnostic_prompt)}</p>}
    {!!item.diagnostic_media_id && <DiagnosticStimulus id={String(item.diagnostic_media_id)} kind="image"/>}
    {item.status === "published" ? <span className="status published">已发布</span> : item.status === "draft" || item.status === "review" ? <button className="soft-button" type="button" disabled={!!publishingId} onClick={async () => {
      setPublishingId(String(item.id));
      try { await act("publish_assignment", { id: item.id }); notify("任务已发布", "学生可以进入诊断并提交作品。"); }
      catch (reason) { notify("发布失败", reason instanceof Error ? reason.message : "请重试", "error"); }
      finally { setPublishingId(""); }
    }}>{publishingId === item.id ? "发布中…" : "审核并发布"}</button> : <span>{stringValue(item.status)}</span>}
  </div>)}{!data.assignments.some((item) => item.class_id === classId) && <p className="empty-state">当前班级还没有任务。</p>}</article></section>;
}

export function TeacherMasteryHeatmap({ data }: Pick<LoopProps, "data">) {
  const objectives = data.learningObjectives.filter((item) => item.status !== "inactive");
  const students = [...new Map(data.masteryMatrix.map((item) => [String(item.studentUserId), stringValue(item.studentName)])).entries()];
  const valueByCell = new Map(data.masteryMatrix.map((item) => [`${item.studentUserId}:${item.objectiveId}`, numberValue(item.mastery)]));

  return <article className="panel loop-panel">
    <div className="panel-heading"><div><span className="eyebrow">仅取最新掌握度快照</span><h3>班级学情热力图</h3></div><span>{students.length} 名学生</span></div>
    {students.length && objectives.length ? <div className="table-wrap"><table className="heatmap">
      <thead><tr><th>学生</th>{objectives.map((item) => <th key={String(item.id)} title={stringValue(item.title)}>{stringValue(item.skill)}</th>)}</tr></thead>
      <tbody>{students.map(([studentId, studentName]) => <tr key={studentId}><th>{studentName}</th>{objectives.map((objective) => {
        const value = valueByCell.get(`${studentId}:${objective.id}`);
        const percent = value === undefined ? null : Math.round(value * 100);
        return <td key={String(objective.id)} className={percent === null ? "unknown" : percent < 60 ? "low" : percent < 80 ? "medium" : "high"}>{percent === null ? "—" : `${percent}%`}</td>;
      })}</tr>)}</tbody>
    </table></div> : <p className="empty-state">学生产生诊断或已确认作业证据后，这里会显示最新掌握度。</p>}
  </article>;
}

export function TeacherIntervention({ data, act, notify }: LoopProps) {
  const students = [...new Map(data.enrollments.filter((item) => item.status === "active").map((item) => [String(item.studentUserId), stringValue(item.studentName)])).entries()];
  const objectives = data.learningObjectives.filter((item) => item.status !== "inactive");
  const [studentUserId, setStudentUserId] = useState(students[0]?.[0] ?? "");
  const [objectiveId, setObjectiveId] = useState(String(objectives[0]?.id ?? ""));
  const [title, setTitle] = useState("专项巩固");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [suggestion, setSuggestion] = useState<InterventionSuggestion | null>(null);
  const [busy, setBusy] = useState<"suggest" | "publish" | null>(null);
  const [stale, setStale] = useState(false);

  function resetDraft() {
    setSuggestion(null); setStale(false); setTitle("专项巩固"); setDetail(""); setDueAt("");
  }

  async function suggest() {
    if (busy) return;
    setBusy("suggest");
    try {
      const result = await act("suggest_intervention", { studentUserId, objectiveId });
      const draft = result.suggestion as InterventionSuggestion;
      setSuggestion(draft); setStale(false);
      if (draft.ready) { setTitle(draft.title); setDetail(draft.detail); }
    } catch (reason) {
      notify("草稿生成失败", reason instanceof Error ? reason.message : "请重试，当前输入已保留。", "error");
    } finally { setBusy(null); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || stale || (suggestion && !suggestion.ready)) return;
    setBusy("publish");
    try {
      const result = await act("create_intervention", { studentUserId, objectiveId, title, detail, dueAt: dueAt || null,
        ...(suggestion ? { evidenceKey: suggestion.evidenceKey } : {}) });
      resetDraft();
      notify(result.created === false ? "相同依据的任务已存在" : "分层干预已发布", result.created === false
        ? `原任务${result.status === "completed" ? "已经完成" : "仍在学生计划中"}，本次没有重复发送。` : "教师确认的练习与依据已进入学生今日计划。");
    } catch (reason) {
      if (reason instanceof Error && reason.message === "support_evidence_changed") setStale(true);
      notify("干预发布失败", reason instanceof Error && reason.message === "support_evidence_changed"
        ? "诊断证据已更新，请重新生成并核对草稿；当前输入已保留。" : reason instanceof Error ? reason.message : "请重试", "error");
    } finally { setBusy(null); }
  }

  return <form className="panel form-card" onSubmit={submit}>
    <div><span className="eyebrow">教师人工决策</span><h3>学生分层干预</h3></div>
    <p>同一目标至少两个分项各有两次有效评价后，可生成支持草稿。草稿只在当前页面保留，教师确认后才发布。</p>
    <fieldset className="diagnostic-form-fields" disabled={!!busy}>
    <label>学生<select value={studentUserId} onChange={(event) => { setStudentUserId(event.target.value); resetDraft(); }} required><option value="">请选择</option>{students.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
    <label>学习目标<select value={objectiveId} onChange={(event) => { setObjectiveId(event.target.value); resetDraft(); }} required><option value="">请选择</option>{objectives.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.title)}</option>)}</select></label>
    <small>切换学生或目标会清空当前未发布草稿。</small>
    <button className="soft-button" type="button" disabled={!studentUserId || !objectiveId} onClick={suggest}>{busy === "suggest" ? "正在读取诊断证据…" : "依据诊断生成草稿"}</button>
    {suggestion && <section aria-live="polite"><strong>{suggestion.ready ? "支持任务草稿 · 待教师确认" : "证据不足 · 请补充诊断或评价"}</strong>
      <details className="support-evidence" open={!suggestion.ready || stale}><summary>选择依据与评价记录</summary><p className="generated-copy">{suggestion.rationale}</p></details>
      {stale && <p role="alert">证据已更新，请重新生成草稿后核对；当前输入尚未发送。</p>}
      <button className="soft-button" type="button" onClick={resetDraft}>改为教师手动安排</button>
    </section>}
    {(!suggestion || suggestion.ready) && <><label>任务标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required/></label>
    <label>干预说明<textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="说明练习重点与完成标准" maxLength={1000} required={!!suggestion}/></label>
    <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label></>}
    </fieldset>
    {(!suggestion || suggestion.ready) && <button className="primary-button" disabled={!!busy || stale || !studentUserId || !objectiveId}>{busy === "publish" ? "发布中…" : suggestion ? "确认支持方案并发布" : "发送到学生计划"}</button>}
  </form>;
}

export function GuardianStudentSwitcher({ data, selectStudent }: { data: WorkspaceData; selectStudent: (studentId: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <article className="child-switcher" aria-label="多孩子切换">
    <span>当前孩子</span>
    <select value={data.selectedStudent?.id ?? ""} disabled={busy || !data.availableStudents.length} onChange={async (event) => {
      setBusy(true);
      try { await selectStudent(event.target.value); } finally { setBusy(false); }
    }}>
      {!data.availableStudents.length && <option value="">暂无已绑定孩子</option>}
      {data.availableStudents.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}
    </select>
  </article>;
}

export function GuardianWeeklyReport({ data }: Pick<LoopProps, "data">) {
  const report = data.weeklyReport;
  return <section>
    <div className="panel-heading"><div><span className="eyebrow">最近 7 天真实数据</span><h3>{data.selectedStudent?.displayName ?? "孩子"}的本周成长报告</h3></div></div>
    <section className="metric-grid">
      <article className="metric-card green"><span>提交作业</span><strong>{report.submittedCount}</strong><small>最近 7 天</small></article>
      <article className="metric-card blue"><span>教师确认</span><strong>{report.reviewedCount}</strong><small>仅计人工确认</small></article>
      <article className="metric-card orange"><span>确认均分</span><strong>{report.averageScore ?? "—"}</strong><small>无确认成绩则留空</small></article>
      <article className="metric-card purple"><span>最新掌握度</span><strong>{report.masteryAverage}%</strong><small>{report.pendingRecommendations} 项待复习</small></article>
    </section>
  </section>;
}

export function GuardianFamilyTasks({ data, act, notify }: LoopProps) {
  const [title, setTitle] = useState("亲子共读 15 分钟");
  const [detail, setDetail] = useState("一起阅读一篇华文短文，并请孩子复述主要内容。");
  const [dueAt, setDueAt] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [objectiveId, setObjectiveId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(createFamilyPlan);
  const [templateChanged, setTemplateChanged] = useState(false);
  const [editingRevision, setEditingRevision] = useState<number | undefined>(undefined);
  const tasks = data.recommendations.filter((item) => item.source_type === "family");
  const assignments = data.assignments.filter((item) => item.status === "published");
  const selectedAssignment = assignments.find((item) => item.id === assignmentId) ?? assignments[0];
  const objectiveIds = stringValue(selectedAssignment?.objectiveIds, "").split(",");
  const objectives = data.learningObjectives.filter((item) => objectiveIds.includes(String(item.id)));
  const selectedObjectiveId = objectives.some((item) => item.id === objectiveId) ? objectiveId : String(objectives[0]?.id ?? "");
  const targetLocked = !!editingId && data.submissions.some((item) => item.family_task_id === editingId);

  function resetForm() { setTitle(""); setDetail(""); setDueAt(""); setAssignmentId(""); setObjectiveId(""); setEditingId(""); setPlan(createFamilyPlan()); setTemplateChanged(false); setEditingRevision(undefined); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data.selectedStudent || !selectedAssignment || !selectedObjectiveId) return notify("无法创建任务", "请先选择孩子、已发布教学作业与练习目标。", "error");
    setBusy(true);
    try {
      await act(editingId ? "update_family_task" : "create_family_task", { id: editingId || undefined, studentUserId: data.selectedStudent.id, assignmentId: selectedAssignment.id, objectiveId: selectedObjectiveId, title, detail, dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        ...(!editingId || templateChanged ? { templateId: plan.template?.id ?? "" } : {}), partner: plan.partner, revision: editingRevision });
      resetForm();
      notify(editingId ? "亲子任务已更新" : "亲子任务已创建", "孩子可在学习任务中选择这项家庭任务并提交作品。");
    } catch (reason) { notify("任务保存失败", reason instanceof Error && reason.message === "family_task_changed" ? "任务已被更新，请重新进入编辑后核对；当前输入仍保留。" : reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setBusy(false); }
  }

  return <section className="loop-grid">
    <form className="panel form-card" onSubmit={submit}>
      <div><span className="eyebrow">家长陪伴 · 不代替教师评分</span><h3>{editingId ? "编辑家庭任务" : "亲子家庭任务"}</h3><p className="form-context">任务对象：<strong>{data.selectedStudent?.displayName ?? "尚未选择孩子"}</strong></p></div>
      <label>交流模板 / Conversation template<select value={plan.template?.id ?? ""} disabled={busy} onChange={(event) => {
        const next = createFamilyPlan(event.target.value, plan.partner); setPlan(next); setTemplateChanged(true);
        if (next.template) { setTitle(next.template.title.zh); setDetail(next.template.work.zh); }
      }}><option value="">自定义任务 / Custom task</option>{FAMILY_TASK_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.title.zh} / {item.title.en}</option>)}</select></label>
      <small>选用模板会带入任务名称与作品要求，可继续修改。 / Choosing a template fills in the title and work instructions; you can edit them.</small>
      <label>关联教学作业 / Course assignment<select value={selectedAssignment ? String(selectedAssignment.id) : ""} required disabled={busy || targetLocked} onChange={(event) => { setAssignmentId(event.target.value); setObjectiveId(""); }}><option value="">请选择作业 / Select an assignment</option>{assignments.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.title)}</option>)}</select></label>
      <label>练习目标 / Learning goal<select value={selectedObjectiveId} required disabled={busy || targetLocked} onChange={(event) => setObjectiveId(event.target.value)}><option value="">请选择目标 / Select a goal</option>{objectives.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.title)}</option>)}</select></label>
      {targetLocked && <p>已有学生作品，教学作业与目标保持不变。</p>}
      <label>建议交流对象 / Suggested partner<select value={plan.partner} disabled={busy} onChange={(event) => setPlan({ ...plan, partner: event.target.value as ExchangePartner })}>{Object.entries(EXCHANGE_PARTNERS).map(([value, label]) => <option key={value} value={value}>{label.zh} / {label.en}</option>)}</select></label>
      <small>同伴或教师可替代家人，学生提交时记录实际对象；本班教师可见证替代交流。 / A peer or teacher may stand in for a family member. The student records the actual partner; a class teacher can witness the exchange.</small>
      <label>任务名称 / Task title<input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} required maxLength={120}/></label>
      <label>任务说明 / Instructions<textarea value={detail} disabled={busy} onChange={(event) => setDetail(event.target.value)} required maxLength={1000}/></label>
      <label>截止时间 / Due date<input type="datetime-local" value={dueAt} disabled={busy} onChange={(event) => setDueAt(event.target.value)}/></label>
      {plan.template && <FamilyTaskGuide plan={plan} title="模板步骤与提问卡 / Template guide"/>}
      <div className="form-actions">{editingId && <button type="button" className="soft-button" disabled={busy} onClick={resetForm}>取消编辑 / Cancel</button>}<button className="primary-button" disabled={busy || !data.selectedStudent || !selectedAssignment || !selectedObjectiveId}>{busy ? "保存中… / Saving…" : editingId ? "保存修改 / Save changes" : "发送给孩子 / Send to child"}</button></div>
      {!assignments.length && <p>请先由教师向孩子所在班级发布关联目标的教学作业。</p>}
    </form>
    <article className="panel">
      <h3>家庭任务与学生作品</h3>
      {tasks.length ? tasks.map((item) => {
        const works = data.submissions.filter((work) => work.family_task_id === item.id);
        return <section className="family-task-record" key={String(item.id)}>
          <strong>{stringValue(item.title)}</strong><p>{stringValue(item.detail, "暂无任务说明")}</p><small>{stringValue(item.objectiveTitle, "尚未关联目标")} · {dueLabel(item.due_at)} · {item.status === "completed" ? "已完成" : "待完成"} · 更新于 {fullDateLabel(item.updated_at ?? item.created_at)}</small>
          <FamilyTaskGuide plan={readFamilyPlan(item.family_plan_json)} objectiveTitle={stringValue(item.objectiveTitle, "")}/>
          <div className="row-actions"><button className="soft-button" type="button" disabled={busy} onClick={() => {
            setEditingId(String(item.id)); setTitle(stringValue(item.title, "")); setDetail(stringValue(item.detail, "")); setAssignmentId(stringValue(item.assignment_id, "")); setObjectiveId(stringValue(item.objective_id, ""));
            const saved = readFamilyPlan(item.family_plan_json); setPlan(saved ?? createFamilyPlan()); setEditingRevision(saved?.revision ?? 0); setTemplateChanged(false);
            const date = typeof item.due_at === "string" ? new Date(item.due_at) : null;
            setDueAt(date && !Number.isNaN(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
          }}>编辑</button>{item.status === "completed" && <button className="soft-button" type="button" onClick={async () => {
            try { await act("update_recommendation_status", { id: item.id, status: "pending" }); notify("任务已重新打开", "孩子可以提交新作品，原有评价保留。"); }
            catch (reason) { notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error"); }
          }}>重新打开</button>}<button className="danger-link" type="button" onClick={async () => {
            try { await act("archive_family_task", { id: item.id }); notify("任务已归档", "历史作品与评价仍保留。"); }
            catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); }
          }}>归档任务</button></div>
          {!works.length && <p>{item.assignment_id ? "等待孩子提交作品。" : "请编辑任务，关联教学作业与目标。"}</p>}
          {works.map((work) => <div className="family-work" key={String(work.id)}>
            <FamilyWorkEvidence value={work.family_snapshot_json}/>
            {work.asset_key ? <audio controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(String(work.id))}/audio`} aria-label="孩子的家庭录音"/> : <p>{stringValue(work.text_answer)}</p>}
            <FamilyExchangeConfirmation work={work} actor="guardian" act={act} notify={notify}/>
            {work.review_status === "reviewed" ? <p>教师评价：{numberValue(work.score)} 分 · {stringValue(work.feedback)}</p> : !!work.family_confirmed_at && <span className="status draft">待教师评价 / Awaiting teacher review</span>}
          </div>)}
        </section>;
      }) : <p className="empty-state">还没有亲子任务。</p>}
    </article>
  </section>;
}

export function AdminObjectiveLibrary({ data, act, notify }: LoopProps) {
  const [code, setCode] = useState("A2-NEW");
  const [title, setTitle] = useState("");
  const [skill, setSkill] = useState("阅读");
  const [level, setLevel] = useState("A2");
  const [objectiveId, setObjectiveId] = useState(String(data.learningObjectives[0]?.id ?? ""));
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [correctOption, setCorrectOption] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [ability, setAbility] = useState("reading");
  const [mediaId, setMediaId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [questionLevel, setQuestionLevel] = useState("A2");

  async function saveObjective(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await act("upsert_learning_objective", { code, title, skill, level, status: "active" });
      setTitle("");
      setObjectiveId(String(result.id));
      notify("课程目标已保存", "目标可用于诊断题、任务和掌握度统计。");
    } catch (reason) {
      notify("目标保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
  }

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    setSavingQuestion(true);
    try {
      await act("upsert_diagnostic_item", { objectiveId, level: questionLevel, prompt, options, correctOption, explanation, ability, mediaId, status: "active" });
      setPrompt(""); setOptions(["", "", "", ""]); setExplanation("");
      setMediaId("");
      notify("诊断题已保存", "四选一题目已加入学生入学诊断。");
    } catch (reason) {
      notify("题目保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally { setSavingQuestion(false); }
  }

  return <section className="loop-section">
    <div className="section-heading"><span className="eyebrow">机构课程治理</span><h2>课程目标与诊断题库</h2><p>先维护课程目标，再为目标配置四选一诊断题。</p></div>
    <section className="loop-grid">
      <form className="panel form-card" onSubmit={saveObjective}>
        <h3>新增课程目标</h3>
        <div className="field-row"><label>目标代码<input value={code} onChange={(event) => setCode(event.target.value)} required/></label><label>级别<select value={level} onChange={(event) => setLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option><option>B2</option></select></label></div>
        <label>目标名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：理解节日叙事" required/></label>
        <label>技能领域<select value={skill} onChange={(event) => setSkill(event.target.value)}><option>听力</option><option>口语</option><option>阅读</option><option>写作</option><option>文化</option></select></label>
        <button className="primary-button">保存课程目标</button>
        <small>当前共有 {data.learningObjectives.length} 个目标。</small>
      </form>
      <form className="panel form-card" onSubmit={saveQuestion}>
        <h3>新增四选一诊断题</h3>
        <fieldset className="diagnostic-form-fields" disabled={uploading || savingQuestion}>
        <label>诊断能力<select value={ability} disabled={uploading || savingQuestion} onChange={(event) => { setAbility(event.target.value); setMediaId(""); }}><option value="reading">阅读理解</option><option value="listening">听力理解</option></select></label>
        <label>题目级别<select value={questionLevel} onChange={(event) => setQuestionLevel(event.target.value)}><option>A1</option><option>A2</option><option>B1</option><option>B2</option></select></label>
        {ability === "listening" && <DiagnosticMediaInput kind="audio" value={mediaId} onChange={setMediaId} uploading={uploading} setUploading={setUploading} notify={notify} disabled={savingQuestion}/>}
        <label>关联目标<select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required><option value="">请选择</option>{data.learningObjectives.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.code)} · {stringValue(item.title)}</option>)}</select></label>
        <label>题干<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} required maxLength={500}/></label>
        {options.map((option, index) => <label key={index}>选项 {String.fromCharCode(65 + index)}<input value={option} onChange={(event) => setOptions(options.map((value, optionIndex) => optionIndex === index ? event.target.value : value))} required/></label>)}
        <label>正确选项<select value={correctOption} onChange={(event) => setCorrectOption(Number(event.target.value))}>{options.map((_, index) => <option value={index} key={index}>{String.fromCharCode(65 + index)}</option>)}</select></label>
        <label>解析<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} maxLength={1000}/></label>
        </fieldset>
        <button className="primary-button" disabled={!objectiveId || savingQuestion || uploading || (ability === "listening" && !mediaId)}>{savingQuestion ? "正在保存…" : "保存诊断题"}</button>
      </form>
    </section>
    <article className="panel"><h3>题库概览</h3>{data.diagnosticItems.length ? data.diagnosticItems.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.prompt)}</strong><small>{stringValue(item.objectiveTitle)} · {stringValue(item.level)} · {stringValue(item.status)}</small></div><span className="status published">四选一</span></div>) : <p className="empty-state">题库为空，请先新增课程目标和诊断题。</p>}</article>
  </section>;
}

export function AdminEnrollmentEditor({ data, act, notify }: LoopProps) {
  const students = data.members.filter((item) => stringValue(item.roles, "").split(",").includes("student"));
  const initialClassId = String(data.classes[0]?.id ?? "");
  const enrolledIds = (nextClassId: string) => data.enrollments.filter((item) => String(item.classId) === nextClassId && item.status === "active").map((item) => String(item.studentUserId));
  const [classId, setClassId] = useState(initialClassId);
  const [studentUserIds, setStudentUserIds] = useState<string[]>(() => enrolledIds(initialClassId));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await act("set_class_enrollments", { classId, studentUserIds });
      notify("班级编班已保存", "重复提交保持幂等，未勾选学生会从该班停用。");
    } catch (reason) {
      notify("编班保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
  }

  return <form className="panel form-card enrollment-editor" onSubmit={submit}>
    <div><span className="eyebrow">租户内学生名单</span><h3>班级编班</h3></div>
    <label>班级<select value={classId} onChange={(event) => { const nextClassId = event.target.value; setClassId(nextClassId); setStudentUserIds(enrolledIds(nextClassId)); }} required>{data.classes.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.name)}</option>)}</select></label>
    <div className="check-list">{students.map((student) => {
      const id = String(student.id);
      return <label key={id}><input type="checkbox" checked={studentUserIds.includes(id)} onChange={(event) => setStudentUserIds(event.target.checked ? [...studentUserIds, id] : studentUserIds.filter((value) => value !== id))}/><span>{student.displayName}<small>{student.email}</small></span></label>;
    })}</div>
    {!students.length && <p className="empty-state">请先创建学生成员。</p>}
    <button className="primary-button" disabled={!classId}>保存班级名单</button>
  </form>;
}

export function AdminQualityDashboard({ data }: Pick<LoopProps, "data">) {
  const metrics = data.qualityMetrics;
  const [selectedKey, setSelectedKey] = useState("");
  const entries = metrics ? Object.entries(metrics) : [];
  const selected = metrics?.[selectedKey];
  return <section className="loop-section">
    <div className="section-heading"><span className="eyebrow">不生成虚构指标</span><h2>教学质量看板</h2><p>所有指标均由当前租户真实业务记录计算。</p></div>
    {metrics ? <><section className="quality-grid">{entries.map(([key, metric], index) => <button type="button" className={`metric-card quality-card tone-${index + 1} ${selectedKey === key ? "active" : ""}`} key={key} onClick={() => setSelectedKey(selectedKey === key ? "" : key)}><span>{metric.label}</span><strong>{metric.value}{metric.unit === "percent" ? "%" : ""}</strong><small>{metric.numerator}/{metric.denominator} · {metric.note}</small><em>{metric.trendAvailable ? "查看趋势" : "暂无趋势数据"}</em></button>)}</section>
      {selected && <article className="panel quality-detail"><div className="panel-heading"><div><span className="eyebrow">指标对象明细</span><h3>{selected.label}</h3></div><button type="button" className="soft-button" onClick={() => setSelectedKey("")}>关闭</button></div>{selected.details.length ? selected.details.map((item) => <div className="history-row" key={item.id}><strong>{item.label}</strong><small>{item.meta ?? "真实业务记录"}</small></div>) : <p className="empty-state">当前没有需要处理的对象。</p>}</article>}
    </> : <p className="empty-state">质量指标暂不可用。</p>}
  </section>;
}
