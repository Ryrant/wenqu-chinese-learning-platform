"use client";

import { useState } from "react";
import { isRecommendationDue } from "./lib/learning-loop";
import type { Act, Notify, WorkspaceData } from "./lib/platform-types";
import { numberValue, stringValue } from "./lib/platform-types";

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

export function StudentDiagnostic({ data, act, notify }: LoopProps) {
  const levels = [...new Set(data.diagnosticItems.map((item) => stringValue(item.level, "A2")))];
  const [selectedLevel, setSelectedLevel] = useState(levels[0] ?? "A2");
  const items = data.diagnosticItems.filter((item) => stringValue(item.level, "A2") === selectedLevel);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const level = selectedLevel;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (Object.keys(answers).length !== items.length) {
      notify("还有题目未完成", "请回答全部四选一题目后再提交。", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await act("submit_diagnostic", {
        level,
        answers: items.map((item) => ({ itemId: String(item.id), selectedOption: answers[String(item.id)] })),
      });
      setAnswers({});
      notify("诊断已完成", `本次正确率 ${Math.round(numberValue(result.score) * 100)}%，错题已加入复习中心。`);
    } catch (reason) {
      notify("诊断提交失败", reason instanceof Error ? reason.message : "请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel loop-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">不依赖外部模型</span><h3>客观题入学诊断</h3></div>
      {data.diagnosticSummary && <span className="score-pill">最近 {Math.round(numberValue(data.diagnosticSummary.score) * 100)}%</span>}
    </div>
    <p>按学习目标计算正确率，提交后更新掌握度并自动生成错题复习。</p>
    {levels.length > 1 && <label className="diagnostic-level">
      诊断级别
      <select value={selectedLevel} onChange={(event) => {
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
        return <fieldset key={id}>
          <legend><b>{index + 1}.</b> {stringValue(item.prompt)} <small>{stringValue(item.objectiveTitle)}</small></legend>
          <div className="option-grid">{options.map((option, optionIndex) => <label key={option}>
            <input type="radio" name={`diagnostic-${id}`} checked={answers[id] === optionIndex} onChange={() => setAnswers({ ...answers, [id]: optionIndex })}/>
            <span>{String.fromCharCode(65 + optionIndex)}. {option}</span>
          </label>)}</div>
        </fieldset>;
      })}
      <button className="primary-button" disabled={busy}>{busy ? "正在提交…" : "提交诊断"}</button>
    </form> : <p className="empty-state">机构尚未发布当前级别的诊断题。</p>}
  </section>;
}

export function StudentTodayPlan({ data, act, notify, navigate }: LoopProps & { navigate: (target: string) => void }) {
  const [busyId, setBusyId] = useState("");
  const kindLabels: Record<string, string> = { teacher: "教师干预", review: "到期错题", family: "家庭任务", assignment: "学习作业" };
  async function handle(item: Record<string, unknown>) {
    const id = String(item.id);
    const kind = stringValue(item.kind, "");
    if (kind === "review") return navigate("成长档案");
    if (kind === "assignment") return navigate("学习任务");
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
      <div><strong>{stringValue(item.title)}</strong><small>{kindLabels[stringValue(item.kind, "")] ?? "普通作业"} · {dueLabel(item.dueAt ?? item.due_at)}</small></div>
      <button className="soft-button" type="button" disabled={busyId === String(item.id)} onClick={() => handle(item)}>
        {stringValue(item.kind, "") === "review" ? "进入复习" : stringValue(item.kind, "") === "assignment" ? "进入作业" : busyId === String(item.id) ? "更新中…" : "标记完成"}
      </button>
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
  const rubric = [
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
      });
      setTitle("");
      notify("目标任务草稿已创建", "任务关联了学习目标和三维评分量规，可审核后发布。");
    } catch (reason) {
      notify("创建失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return <form className="panel form-card" onSubmit={submit}>
    <div><span className="eyebrow">目标对齐 · 三维量规</span><h3>目标与评分量规任务</h3></div>
    <label>任务名称<input value={title} onChange={(event) => setTitle(event.target.value)} required/></label>
    <label>班级<select value={classId} onChange={(event) => setClassId(event.target.value)} required>{data.classes.map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.name)}</option>)}</select></label>
    <label>学习目标<select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required>{data.learningObjectives.filter((item) => item.status !== "inactive").map((item) => <option key={String(item.id)} value={String(item.id)}>{stringValue(item.code)} · {stringValue(item.title)}</option>)}</select></label>
    <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
    <div className="rubric-list">{rubric.map((item) => <span key={item.name}><b>{item.name}</b>{item.weight}%</span>)}</div>
    <small>固定 3 个维度，权重合计 100%。</small>
    <button className="primary-button" disabled={busy || !classId || !objectiveId}>{busy ? "保存中…" : "保存任务草稿"}</button>
  </form>;
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
  const students = [...new Map(data.enrollments.map((item) => [String(item.studentUserId), stringValue(item.studentName)])).entries()];
  const [studentUserId, setStudentUserId] = useState(students[0]?.[0] ?? "");
  const [objectiveId, setObjectiveId] = useState(String(data.learningObjectives[0]?.id ?? ""));
  const [title, setTitle] = useState("专项巩固");
  const [detail, setDetail] = useState("");
  const [dueAt, setDueAt] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await act("create_intervention", { studentUserId, objectiveId, title, detail, dueAt: dueAt || null });
      setDetail("");
      notify("分层干预已创建", "该任务将以最高优先级进入学生今日计划。");
    } catch (reason) {
      notify("干预创建失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
  }

  return <form className="panel form-card" onSubmit={submit}>
    <div><span className="eyebrow">教师人工决策</span><h3>学生分层干预</h3></div>
    <label>学生<select value={studentUserId} onChange={(event) => setStudentUserId(event.target.value)} required><option value="">请选择</option>{students.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
    <label>学习目标<select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required><option value="">请选择</option>{data.learningObjectives.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.title)}</option>)}</select></label>
    <label>任务标题<input value={title} onChange={(event) => setTitle(event.target.value)} required/></label>
    <label>干预说明<textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="说明练习重点与完成标准" maxLength={1000}/></label>
    <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
    <button className="primary-button" disabled={!studentUserId || !objectiveId}>发送到学生计划</button>
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
  const [editingId, setEditingId] = useState("");
  const tasks = data.recommendations.filter((item) => item.source_type === "family");

  function resetForm() {
    setTitle("");
    setDetail("");
    setDueAt("");
    setEditingId("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!data.selectedStudent) return notify("无法创建任务", "请先绑定并选择孩子。", "error");
    try {
      await act(editingId ? "update_family_task" : "create_family_task", { id: editingId || undefined, studentUserId: data.selectedStudent.id, title, detail, dueAt: dueAt || null });
      resetForm();
      notify(editingId ? "亲子任务已更新" : "亲子任务已创建", editingId ? "修改已保存并记录审计。" : "任务已进入孩子的今日计划并生成平台通知。");
    } catch (reason) {
      notify("任务创建失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
  }

  return <section className="loop-grid">
    <form className="panel form-card" onSubmit={submit}>
      <div><span className="eyebrow">家长陪伴 · 不代替教师评分</span><h3>{editingId ? "编辑家庭任务" : "亲子家庭任务"}</h3><p className="form-context">任务对象：<strong>{data.selectedStudent?.displayName ?? "尚未选择孩子"}</strong></p></div>
      <label>任务名称<input value={title} onChange={(event) => setTitle(event.target.value)} required/></label>
      <label>任务说明<textarea value={detail} onChange={(event) => setDetail(event.target.value)} required maxLength={1000}/></label>
      <label>截止时间<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
      <div className="form-actions">{editingId && <button type="button" className="soft-button" onClick={resetForm}>取消编辑</button>}<button className="primary-button" disabled={!data.selectedStudent}>{editingId ? "保存修改" : "发送给孩子"}</button></div>
    </form>
    <article className="panel">
      <h3>家庭任务记录</h3>
      {tasks.length ? tasks.map((item) => <div className="history-row task-management-row" key={String(item.id)}>
        <div><strong>{stringValue(item.title)}</strong><p>{stringValue(item.detail, "暂无任务说明")}</p><small>{dueLabel(item.due_at)} · {item.status === "completed" ? "已完成" : "待完成"} · 更新于 {fullDateLabel(item.updated_at ?? item.created_at)}</small></div>
        <div className="row-actions"><button className="soft-button" type="button" onClick={() => {
          setEditingId(String(item.id)); setTitle(stringValue(item.title, "")); setDetail(stringValue(item.detail, "")); setDueAt(typeof item.due_at === "string" ? item.due_at.slice(0, 16) : "");
        }}>编辑</button><button className="soft-button" type="button" onClick={async () => {
          try {
            await act("update_recommendation_status", { id: item.id, status: item.status === "completed" ? "pending" : "completed" });
            notify("任务状态已更新", item.status === "completed" ? "已重新设为待完成。" : "已标记完成。");
          } catch (reason) {
            notify("更新失败", reason instanceof Error ? reason.message : "请重试", "error");
          }
        }}>{item.status === "completed" ? "重新打开" : "标记完成"}</button><button className="danger-link" type="button" onClick={async () => {
          try { await act("archive_family_task", { id: item.id }); notify("任务已归档", "该任务不再出现在孩子计划中，历史记录仍保留。"); }
          catch (reason) { notify("归档失败", reason instanceof Error ? reason.message : "请重试", "error"); }
        }}>归档任务</button></div>
      </div>) : <p className="empty-state">还没有亲子任务。</p>}
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
    try {
      await act("upsert_diagnostic_item", { objectiveId, level, prompt, options, correctOption, explanation, status: "active" });
      setPrompt(""); setOptions(["", "", "", ""]); setExplanation("");
      notify("诊断题已保存", "四选一题目已加入学生入学诊断。");
    } catch (reason) {
      notify("题目保存失败", reason instanceof Error ? reason.message : "请重试", "error");
    }
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
        <label>关联目标<select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} required><option value="">请选择</option>{data.learningObjectives.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.code)} · {stringValue(item.title)}</option>)}</select></label>
        <label>题干<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} required maxLength={500}/></label>
        {options.map((option, index) => <label key={index}>选项 {String.fromCharCode(65 + index)}<input value={option} onChange={(event) => setOptions(options.map((value, optionIndex) => optionIndex === index ? event.target.value : value))} required/></label>)}
        <label>正确选项<select value={correctOption} onChange={(event) => setCorrectOption(Number(event.target.value))}>{options.map((_, index) => <option value={index} key={index}>{String.fromCharCode(65 + index)}</option>)}</select></label>
        <label>解析<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} maxLength={1000}/></label>
        <button className="primary-button" disabled={!objectiveId}>保存诊断题</button>
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
