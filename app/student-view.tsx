"use client";

import { useEffect, useRef, useState } from "react";
import { StudentDiagnostic, StudentReviewCenter, StudentTodayPlan } from "./learning-loop-views";
import type { Act, Notify, WorkspaceData } from "./lib/platform-types";
import { FAMILY_HELP_LABELS, numberValue, stringValue } from "./lib/platform-types";
import { AbilityEvidenceProfile, DiagnosticStimulus } from "./diagnostic-evidence";
import { EXCHANGE_PARTNERS, readFamilyPlan, readFamilyWorkSnapshot, type ExchangePartner } from "./lib/family-task";
import { FamilyTaskGuide, FamilyWorkEvidence } from "./family-task-guide";
import familyStyles from "./family-task-guide.module.css";
import { SequenceReports } from "./learning-sequences";
import { SEQUENCE_STAGE_LABELS, sequenceTaskId, readSequenceWork, type SequenceStage } from "./lib/learning-sequence-types";

export function ProgressRing({ value, label }: { value: number; label: string }) {
  return <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}>
    <div><strong>{value}%</strong><span>{label}</span></div>
  </div>;
}

type Props = { nav: string; data: WorkspaceData; act: Act; refresh: () => Promise<void>; notify: Notify; navigate: (target: string) => void };
type RecordingDraft = { id: string; blob: Blob; url: string; assignmentId: string; familyTaskId: string | null; title: string; familyPartner?: ExchangePartner; familyRevision?: number; sequenceId?: string; sequenceStage?: SequenceStage };

function PageTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <section className="welcome-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div></section>;
}

export function StudentView({ nav, data, act, refresh, notify, navigate }: Props) {
  const [question, setQuestion] = useState("中秋节为什么代表团圆？");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(String(data.assignments.find((item) => item.status === "published")?.id ?? ""));
  const [textDrafts, setTextDrafts] = useState<Record<string, { answer: string; familyRevision?: number }>>({});
  const textAnswer = textDrafts[selectedAssignment]?.answer ?? "";
  const [partners, setPartners] = useState<Record<string, ExchangePartner>>({});
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingDraft, setRecordingDraft] = useState<RecordingDraft | null>(null);
  const recordingDraftUrl = recordingDraft?.url;
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mounted = useRef(true);
  const published = data.assignments.filter((item) => item.status === "published");
  const familyTasks = data.recommendations.filter((item) => item.source_type === "family" && item.status === "pending" && item.assignment_id && (!item.familyReviewStatus || item.familyReviewStatus === "reviewed"));
  const familyTask = familyTasks.find((item) => `family:${item.id}` === selectedAssignment);
  const familyPlan = readFamilyPlan(familyTask?.family_plan_json);
  const familyRevision = familyPlan?.revision ?? 0;
  const familyPartner = partners[selectedAssignment] ?? familyPlan?.partner ?? "family";
  const sequences = (data.learningSequences ?? []).filter((item) => item.studentUserId === data.user.id);
  const sequence = sequences.find((item) => (["practice", "transfer"] as const).some((stage) => sequenceTaskId(item.id, stage) === selectedAssignment));
  const sequenceStage: SequenceStage = selectedAssignment.endsWith(":transfer") ? "transfer" : "practice";
  const sequenceReady = !sequence || ((sequenceStage === "practice" || sequence.practice.some((work) => work.reviewed)) && !sequence[sequenceStage].some((work) => !work.reviewed));
  const setTextAnswer = (value: string) => setTextDrafts((drafts) => {
    const next = { ...drafts };
    if (!value) delete next[selectedAssignment];
    else next[selectedAssignment] = { answer: value, familyRevision: drafts[selectedAssignment]?.familyRevision ?? (familyTask ? familyRevision : undefined) };
    return next;
  });
  const textTaskChanged = !!familyTask && !!textAnswer && textDrafts[selectedAssignment]?.familyRevision !== familyRevision;
  const recordingTask = recordingDraft?.familyTaskId ? data.recommendations.find((item) => item.id === recordingDraft.familyTaskId) : null;
  const recordingTaskChanged = !!recordingDraft?.familyTaskId && (!recordingTask || (readFamilyPlan(recordingTask.family_plan_json)?.revision ?? 0) !== recordingDraft.familyRevision);
  const assignmentId = sequence ? sequence.assignmentId : familyTask ? String(familyTask.assignment_id) : /^(family|sequence):/.test(selectedAssignment) ? "" : selectedAssignment;
  const sourceAssignment = published.find((item) => item.id === assignmentId);
  const assignment = sourceAssignment && sequence ? { ...sourceAssignment, diagnostic_mode: sequence.medium === "audio" ? "speaking" : "writing" } : sourceAssignment;
  const targetSelector = <label>提交任务<select value={selectedAssignment} onChange={(event) => setSelectedAssignment(event.target.value)} required disabled={recording || recordingBusy || busy}>
    <option value="">请选择任务</option>{published.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.title)}</option>)}
    {familyTasks.map((item) => <option value={`family:${item.id}`} key={`family:${item.id}`}>家庭：{stringValue(item.title)}</option>)}
    {sequences.filter((item) => published.some((task) => task.id === item.assignmentId)).flatMap((item) => (["practice", "transfer"] as const).map((stage) => <option key={sequenceTaskId(item.id, stage)} value={sequenceTaskId(item.id, stage)} disabled={(stage === "transfer" && !item.practice.some((work) => work.reviewed)) || item[stage].some((work) => !work.reviewed)}>{SEQUENCE_STAGE_LABELS[stage]}：{item.title}</option>))}
  </select></label>;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
        recorder.current.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);
  useEffect(() => () => { if (recordingDraftUrl) URL.revokeObjectURL(recordingDraftUrl); }, [recordingDraftUrl]);
  useEffect(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, [nav]);
  const masteryAverage = data.mastery.length
    ? Math.round(data.mastery.reduce((sum, row) => sum + numberValue(row.mastery) * 100, 0) / data.mastery.length)
    : 0;

  function speak() {
    if (!("speechSynthesis" in window)) return notify("无法播放", "当前浏览器不支持系统语音合成。", "error");
    window.speechSynthesis.cancel();
    if (!assignment) return notify("请先选择任务", "选择任务后可以听任务标题。", "error");
    const utterance = new SpeechSynthesisUtterance(sequence ? `${sequence.title}，${SEQUENCE_STAGE_LABELS[sequenceStage]}` : stringValue(assignment.title));
    utterance.lang = "zh-CN";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
    notify("正在朗读任务标题", "使用当前设备的中文语音引擎。");
  }

  async function askTutor(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setAnswer("");
    setSources([]);
    try {
      const response = await fetch("/api/v1/ai/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: question, purpose: "tutor", level: "A2" }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        if (result?.error === "no_reviewed_sources") throw new Error("当前没有可引用的已发布资料，请先请老师或管理员发布相关内容。");
        throw new Error(result?.error ?? "回答生成失败");
      }
      const raw = await response.text();
      let built = "";
      let found: Array<Record<string, unknown>> = [];
      for (const block of raw.split("\n\n")) {
        const eventName = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const payload = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!payload) continue;
        if (eventName === "meta") continue;
        if (eventName === "token") built += (JSON.parse(payload) as { text: string }).text;
        if (eventName === "citations") found = JSON.parse(payload) as Array<Record<string, unknown>>;
      }
      setAnswer(built.trim());
      setSources(found);
    } catch (reason) {
      notify("提问失败", reason instanceof Error ? reason.message : "请稍后重试", "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitText(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await act("submit_text", { assignmentId, familyTaskId: familyTask?.id ?? null, answer: textAnswer,
        ...(sequence ? { sequenceId: sequence.id, sequenceStage } : {}),
        ...(familyTask ? { familyPartner, familyRevision: textDrafts[selectedAssignment]?.familyRevision ?? familyRevision } : {}) });
      setTextAnswer("");
      if (familyTask || sequence) setSelectedAssignment("");
      notify("作业已提交", "答案已进入教师人工审核队列。没有伪造自动分数。");
    } catch (reason) {
      notify("提交失败", reason instanceof Error && reason.message === "family_task_changed" ? "交流任务已更新，请核对新要求后再提交；文字已保留。" : reason instanceof Error ? reason.message : "请重试", "error");
      if (reason instanceof Error && reason.message === "family_task_changed") {
        try { await refresh(); } catch (error) { notify("任务刷新失败", error instanceof Error ? error.message : "请刷新页面，文字已保留。", "error"); }
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording && recorder.current) { if (recorder.current.state !== "inactive") recorder.current.stop(); return; }
    if (!assignment || !sequenceReady) return notify("请先选择可提交的任务", "练习经教师评价后才能提交迁移作品；待评作品不能重复提交。", "error");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return notify("无法录音", "当前浏览器不支持麦克风录音。", "error");
    let stream: MediaStream | null = null;
    setRecordingBusy(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const mediaRecorder = new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      chunks.current = [];
      const target = { assignmentId, familyTaskId: familyTask ? String(familyTask.id) : null, title: sequence ? `${sequence.title} · ${SEQUENCE_STAGE_LABELS[sequenceStage]}` : stringValue(familyTask?.title ?? assignment.title),
        ...(sequence ? { sequenceId: sequence.id, sequenceStage } : {}),
        ...(familyTask ? { familyPartner, familyRevision } : {}) };
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setRecording(false);
        setRecordingDraft({ ...target, id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
      };
      mediaRecorder.onerror = () => {
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        if (mounted.current) { setRecording(false); notify("录音中断", "请检查麦克风后重新录音。", "error"); }
      };
      mediaRecorder.start();
      setRecordingDraft(null);
      setRecording(true);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      notify("无法开始录音", reason instanceof Error ? reason.message : "请检查麦克风权限后重试。", "error");
    } finally { if (mounted.current) setRecordingBusy(false); }
  }

  async function uploadRecording() {
    if (!recordingDraft) return;
    const draft = recordingDraft;
    const form = new FormData();
    form.append("audio", draft.blob, "recording.webm");
    form.append("assignmentId", draft.assignmentId);
    form.append("submissionId", draft.id);
    form.append("reference", draft.title);
    if (draft.familyTaskId) form.append("familyTaskId", draft.familyTaskId);
    if (draft.familyPartner) form.append("familyPartner", draft.familyPartner);
    if (draft.familyRevision !== undefined) form.append("familyRevision", String(draft.familyRevision));
    if (draft.sequenceId) form.append("sequenceId", draft.sequenceId);
    if (draft.sequenceStage) form.append("sequenceStage", draft.sequenceStage);
    setRecordingBusy(true);
    try {
      const response = await fetch("/api/v1/speech/submissions", { method: "POST", body: form });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error);
      setRecordingDraft(null);
      if (draft.familyTaskId || draft.sequenceId) setSelectedAssignment("");
      notify("录音已保存", result.message ?? "已转教师复核。");
      try { await refresh(); } catch (reason) { notify("录音已保存", `列表刷新失败：${reason instanceof Error ? reason.message : "请刷新页面"}`, "error"); }
    } catch (reason) {
      notify("录音提交失败", reason instanceof Error && reason.message === "family_task_changed" ? "交流任务已更新，请核对新要求后重新录音；原录音仍保留供试听。" : `${reason instanceof Error ? reason.message : "请重试"}；录音已保留，可再次提交。`, "error");
      if (reason instanceof Error && reason.message === "family_task_changed") {
        try { await refresh(); } catch (error) { notify("任务刷新失败", error instanceof Error ? error.message : "请刷新页面，录音仍保留。", "error"); }
      }
    } finally { setRecordingBusy(false); }
  }

  const recordingControls = <div className="recording-controls">
    <div className="hero-actions"><button className="soft-button" type="button" onClick={speak} disabled={!assignment}>听任务标题</button>
      <button className={`soft-button ${recording ? "danger-button" : ""}`} type="button" onClick={toggleRecording} disabled={(!assignment && !recording) || recordingBusy || (!recording && (!sequenceReady || assignment?.diagnostic_mode === "writing"))}>{recording ? "停止录音并试听" : recordingDraft ? "重新录音" : "开始录音"}</button></div>
    {assignment?.diagnostic_mode === "writing" && <p>这项任务使用文字提交，请在学习任务中填写回答。</p>}
    {recordingDraft && <div className="recording-preview"><p>提交到：{recordingDraft.title}{recordingDraft.familyPartner ? ` · 交流对象：${EXCHANGE_PARTNERS[recordingDraft.familyPartner].zh}` : ""}</p><audio controls src={recordingDraft.url} aria-label="录音试听"/>{recordingTaskChanged && <p role="alert">交流要求已更新，请核对后重新录音。</p>}<button className="primary-button" type="button" disabled={recordingBusy || recordingTaskChanged} onClick={uploadRecording}>{recordingBusy ? "正在提交…" : "提交录音给老师"}</button></div>}
  </div>;

  if (nav === "AI 课堂") return <section>
    <PageTitle eyebrow="来源透明 · 学生问答" title="AI 课堂" detail="回答只基于本租户已发布内容；找不到来源时会明确拒答。"/>
    <form className="panel query-panel" onSubmit={askTutor}>
      <label>想问什么？<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} required/></label>
      <button className="primary-button" disabled={busy}>{busy ? "正在检索…" : "检索并生成回答"}</button>
    </form>
    {answer && <article className="panel result-card">
      <span className="safe-chip">来源化回答 · 已关联审核资料</span>
      <h2 className="question-title">根据已审核来源：{question}</h2>
      <section className="answer-block"><h3>回答</h3><p className="generated-copy">{answer}</p></section>
      <section className="reference-block"><h3>可参考内容</h3><p>以下内容来自当前机构已审核并发布的资料。</p><h4>引用来源（{sources.length}）</h4>
        {sources.map((source) => <div className="citation" key={String(source.id)}><strong>{String(source.title)}</strong><p>{String(source.excerpt)}</p></div>)}
      </section>
    </article>}
  </section>;

  if (nav === "学习任务") return <section>
    <PageTitle eyebrow="诊断与真实作业提交" title="我的学习任务" detail={`${published.length} 项已发布任务；提交后进入教师审核。`}/>
    <StudentDiagnostic data={data} act={act} notify={notify} onStartAssignment={(id) => {
      if (recording || recordingBusy || busy) return notify("请先完成当前提交", "处理当前作品后再切换任务。", "error");
      setSelectedAssignment(id);
      document.getElementById("student-submission")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }}/>
    <div className="cards-list">{published.map((item) => <article className="panel task-card" key={String(item.id)}>
      <span className="status published">进行中</span><h3>{stringValue(item.title)}</h3>
      <p>{stringValue(item.activity_type)} · 截止 {stringValue(item.due_at)}</p>
    </article>)}</div>
    <section id="student-submission">
    {sequence && <article className="panel form-card"><h3>{sequence.title} · {SEQUENCE_STAGE_LABELS[sequenceStage]}</h3><p>学习目标：{sequence.objectiveTitle}</p><p className="generated-copy">{sequenceStage === "practice" ? sequence.practicePrompt : sequence.transferPrompt}</p><p>迁移情境变化：{sequence.transferContext}</p><small>本组量规：{sequence.rubric.map((item) => `${item.name} ${item.weight}%`).join("、")}。教师分别评价各阶段，并记录实际帮助。</small>{!sequenceReady && <p role="status">先完成练习及教师评价；已有待评作品时不能重复提交。</p>}</article>}
    {familyTask && <article className="panel form-card"><FamilyTaskGuide plan={familyPlan} title={`家庭交流：${stringValue(familyTask.title)}`} detail={stringValue(familyTask.detail, "")} objectiveTitle={stringValue(familyTask.objectiveTitle, "")} expanded/>
      <label>本次实际交流对象 / Actual partner<select value={familyPartner} disabled={recording || recordingBusy || busy} onChange={(event) => {
        const partner = event.target.value as ExchangePartner;
        setPartners({ ...partners, [selectedAssignment]: partner });
        setRecordingDraft((draft) => draft?.familyTaskId === String(familyTask.id) ? { ...draft, familyPartner: partner } : draft);
      }}>{Object.entries(EXCHANGE_PARTNERS).map(([value, label]) => <option key={value} value={value}>{label.zh} / {label.en}</option>)}</select></label>
      <p>提交自己的提问、追问和总结；家长或见证教师记录帮助程度，语言表现由教师评价。 / Submit your own questions, follow-ups and summary. A guardian or witnessing teacher records the help used; a teacher evaluates the language.</p></article>}
    {!!assignment?.diagnostic_mode && !sequence && <article className="panel diagnostic-task-prompt"><h3>{assignment.diagnostic_mode === "speaking" ? "图片口述诊断" : "短文表达诊断"}：{stringValue(assignment.title)}</h3><p>{stringValue(assignment.diagnostic_prompt)}</p>
      {!!assignment.diagnostic_media_id && <DiagnosticStimulus id={String(assignment.diagnostic_media_id)} kind="image"/>}
      <p>完成后提交{assignment.diagnostic_mode === "speaking" ? "录音" : "文字"}，由教师按学习目标评价。</p></article>}
    <form className="panel form-card" onSubmit={submitText}>
      <h3>提交文字作业</h3>
      {targetSelector}
      <label>我的回答<textarea value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} disabled={busy || assignment?.diagnostic_mode === "speaking"} placeholder={assignment?.diagnostic_mode === "speaking" ? "图片口述请使用下方录音提交。" : "写下你的完整句子或小故事"} required maxLength={10000}/></label>
      {textTaskChanged && <p role="alert">交流要求已更新，文字仍保留。<button className="soft-button" type="button" disabled={busy} onClick={() => setTextDrafts({ ...textDrafts, [selectedAssignment]: { answer: textAnswer, familyRevision } })}>已核对新要求，保留这份文字继续</button></p>}
      <button className="primary-button" disabled={busy || textTaskChanged || !sequenceReady || !assignment || assignment.diagnostic_mode === "speaking"}>提交给老师审核</button>
    </form>
    <article className="panel form-card"><h3>提交录音作品</h3>{recordingControls}</article>
    </section>
  </section>;

  if (nav === "成长档案") return <section>
    <PageTitle eyebrow="来自掌握度快照与作业记录" title="成长档案" detail="每一项都能追溯到真实学习证据。"/>
    <AbilityEvidenceProfile studentId={data.user.id} revision={data.generatedAt}/>
    <SequenceReports sequences={sequences} onStartTask={(id) => { if (recording || recordingBusy || busy) return; setSelectedAssignment(id); navigate("学习任务"); }}/>
    <StudentReviewCenter data={data} act={act} notify={notify}/>
    <section className="metric-grid">{data.mastery.map((item) => <article className="metric-card" key={String(item.objectiveId ?? item.skill)}>
      <span>{stringValue(item.skill)}</span><strong>{Math.round(numberValue(item.mastery) * 100)}</strong><small>{numberValue(item.evidenceCount)} 条学习证据</small>
    </article>)}</section>
    <article className="panel">
      <div className="panel-heading"><div><h3>最近提交</h3><small>只显示教师确认后的评分与反馈</small></div><span>{data.submissions.length} 条</span></div>
      {data.submissions.length ? data.submissions.map((item) => <div className="history-row" key={String(item.id)}>
        <div className={item.family_task_id ? familyStyles.workHistory : undefined}><strong>{stringValue(readSequenceWork(item.sequence_snapshot_json)?.title ?? readFamilyWorkSnapshot(item.family_snapshot_json)?.title ?? item.familyTaskTitle ?? item.assignmentTitle)}</strong><small>{stringValue(item.created_at)}{item.review_status === "reviewed" && item.feedback ? ` · 教师反馈：${stringValue(item.feedback)}` : ""}</small>
          {!!item.family_task_id && <details><summary>查看交流作品与原始要求 / View exchange work</summary><FamilyWorkEvidence value={item.family_snapshot_json}/>
            {item.asset_key ? <audio controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(String(item.id))}/audio`} aria-label="我的交流录音"/> : <p className="generated-copy">{stringValue(item.text_answer)}</p>}
            <p>帮助程度：{FAMILY_HELP_LABELS[stringValue(item.family_help_level, "")] ?? "尚未确认"} · {item.family_confirmation_role === "teacher" ? "本班教师见证" : item.family_confirmed_at ? "交流已确认" : "等待交流确认"}</p>
          </details>}
        </div>
        <span className={`status ${item.review_status === "reviewed" ? "published" : "draft"}`}>{item.review_status === "reviewed" ? `${numberValue(item.score)} 分` : "待教师审核"}</span>
      </div>) : <p className="empty-state">完成第一次作业后，记录会显示在这里。</p>}
    </article>
  </section>;

  const current = assignment;
  return <>
    <PageTitle eyebrow="学习总览 · 数据实时读取" title={`早上好，${data.user.displayName}！`} detail="今天也一起发现中文里的小惊喜。"/>
    <StudentTodayPlan data={data} act={act} notify={notify} navigate={navigate} onStartTask={(id) => { setSelectedAssignment(id); navigate("学习任务"); }}/>
    <section className="hero-learning">
      <div className="hero-copy">
        <span className="tag">正在学习 · {stringValue(current?.activity_type, "等待教师发布任务")}</span>
        <h2>{sequence ? `${sequence.title} · ${SEQUENCE_STAGE_LABELS[sequenceStage]}` : stringValue(familyTask?.title ?? current?.title, "新的学习任务")}</h2>
        <p>{sequence ? "先核对本阶段要求，再提交作品；迁移评价会记录实际帮助与新情境。" : familyTask ? "先查看交流步骤和提问卡，完成真实交流后提交自己的作品。" : current?.diagnostic_mode ? "先查看完整诊断要求，再提交作品给教师评价。" : "录音后可以试听和重录，确认后提交给老师。"}</p>
        <div className="lesson-meta"><span>建议 12 分钟</span><i/><span>{data.submissions.length} 次提交</span></div>
        {targetSelector}
        {sequence ? <button className="primary-button" type="button" onClick={() => navigate("学习任务")}>查看本阶段要求并作答</button> : familyTask ? <button className="primary-button" type="button" onClick={() => navigate("学习任务")}>查看交流要求并作答</button> : current?.diagnostic_mode ? <button className="primary-button" type="button" onClick={() => navigate("学习任务")}>查看诊断要求并作答</button> : recordingControls}
      </div>
      <div className="hero-art" aria-label="中秋团圆主题插画"><span className="sun-disc">圆</span><span className="roof roof-back"/><span className="roof roof-front"/><span className="lantern lantern-a">福</span><span className="lantern lantern-b">乐</span><span className="hill hill-a"/><span className="hill hill-b"/><span className="person person-a">小</span><span className="person person-b">语</span></div>
    </section>
    <section className="dashboard-grid">
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">当前掌握度</span><h3>有证据地进步</h3></div></div>
        <div className="progress-content"><ProgressRing value={masteryAverage} label="平均掌握度"/><div className="task-list">{data.mastery.slice(0, 3).map((item) => <div key={String(item.objectiveId ?? item.skill)}><span>✓</span><p><strong>{stringValue(item.skill)}</strong><small>{stringValue(item.title)}</small></p><b>{Math.round(numberValue(item.mastery) * 100)}</b></div>)}</div></div>
      </article>
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">下一步</span><h3>真实任务状态</h3></div></div>
        {published.length ? published.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.title)}</strong><small>{stringValue(item.className)}</small></div><span className="status published">已发布</span></div>) : <p className="empty-state">教师尚未发布作业。</p>}
      </article>
    </section>
  </>;
}
