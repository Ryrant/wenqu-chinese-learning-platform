"use client";

import { useRef, useState } from "react";
import { StudentDiagnostic, StudentReviewCenter, StudentTodayPlan } from "./learning-loop-views";
import type { Act, Notify, WorkspaceData } from "./lib/platform-types";
import { numberValue, stringValue } from "./lib/platform-types";

export function ProgressRing({ value, label }: { value: number; label: string }) {
  return <div className="progress-ring" style={{ "--progress": `${value * 3.6}deg` } as React.CSSProperties}>
    <div><strong>{value}%</strong><span>{label}</span></div>
  </div>;
}

type Props = { nav: string; data: WorkspaceData; act: Act; refresh: () => Promise<void>; notify: Notify; navigate: (target: string) => void };

function PageTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <section className="welcome-row"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div></section>;
}

export function StudentView({ nav, data, act, refresh, notify, navigate }: Props) {
  const [question, setQuestion] = useState("中秋节为什么代表团圆？");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Array<Record<string, unknown>>>([]);
  const [generationMeta, setGenerationMeta] = useState<{ provider?: string; model?: string; status?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(String(data.assignments.find((item) => item.status === "published")?.id ?? ""));
  const [textAnswer, setTextAnswer] = useState("");
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const published = data.assignments.filter((item) => item.status === "published");
  const masteryAverage = data.mastery.length
    ? Math.round(data.mastery.reduce((sum, row) => sum + numberValue(row.mastery) * 100, 0) / data.mastery.length)
    : 0;

  function speak() {
    if (!("speechSynthesis" in window)) return notify("无法播放", "当前浏览器不支持系统语音合成。", "error");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("一家人一起吃月饼。团圆是中秋节重要的文化主题。");
    utterance.lang = "zh-CN";
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
    notify("正在播放", "示范音由当前设备的中文语音引擎实时生成。");
  }

  async function askTutor(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setAnswer("");
    setSources([]);
    setGenerationMeta(null);
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
        if (eventName === "meta") setGenerationMeta(JSON.parse(payload) as { provider?: string; model?: string; status?: string });
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
      await act("submit_text", { assignmentId: selectedAssignment, answer: textAnswer });
      setTextAnswer("");
      notify("作业已提交", "答案已进入教师人工审核队列。没有伪造自动分数。");
    } catch (reason) {
      notify("提交失败", reason instanceof Error ? reason.message : "请重试", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording && recorder.current) {
      recorder.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return notify("无法录音", "当前浏览器不支持麦克风录音。", "error");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      chunks.current = [];
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "recording.webm");
        form.append("assignmentId", selectedAssignment);
        form.append("reference", "一家人一起吃月饼。");
        setBusy(true);
        try {
          const response = await fetch("/api/v1/speech/submissions", { method: "POST", body: form });
          const result = await response.json() as { message?: string; error?: string };
          if (!response.ok) throw new Error(result.error);
          await refresh();
          notify("录音已保存", result.message ?? "已转教师复核。");
        } catch (reason) {
          notify("录音提交失败", reason instanceof Error ? reason.message : "请重试", "error");
        } finally {
          setBusy(false);
        }
      };
      mediaRecorder.start();
      setRecording(true);
    } catch {
      notify("麦克风未授权", "请允许浏览器访问麦克风后再试。", "error");
    }
  }

  if (nav === "AI 课堂") return <section>
    <PageTitle eyebrow="来源透明 · 学生问答" title="AI 课堂" detail="回答只基于本租户已发布内容；找不到来源时会明确拒答。"/>
    <form className="panel query-panel" onSubmit={askTutor}>
      <label>想问什么？<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} required/></label>
      <button className="primary-button" disabled={busy}>{busy ? "正在检索…" : "检索并生成回答"}</button>
    </form>
    {answer && <article className="panel result-card">
      <span className="safe-chip">{generationMeta?.provider && generationMeta?.model ? `${generationMeta.provider} · ${generationMeta.model} · ${generationMeta.status ?? "review_required"}` : "来源化生成 · 需教师确认"}</span>
      <h3>回答</h3><p className="generated-copy">{answer}</p>
      <h4>引用来源（{sources.length}）</h4>
      {sources.map((source) => <div className="citation" key={String(source.id)}><strong>{String(source.title)}</strong><p>{String(source.excerpt)}</p></div>)}
    </article>}
  </section>;

  if (nav === "学习任务") return <section>
    <PageTitle eyebrow="诊断与真实作业提交" title="我的学习任务" detail={`${published.length} 项已发布任务；提交后进入教师审核。`}/>
    <StudentDiagnostic data={data} act={act} notify={notify}/>
    <div className="cards-list">{published.map((item) => <article className="panel task-card" key={String(item.id)}>
      <span className="status published">进行中</span><h3>{stringValue(item.title)}</h3>
      <p>{stringValue(item.activity_type)} · 截止 {stringValue(item.due_at)}</p>
    </article>)}</div>
    <form className="panel form-card" onSubmit={submitText}>
      <h3>提交文字作业</h3>
      <label>任务<select value={selectedAssignment} onChange={(event) => setSelectedAssignment(event.target.value)} required>{published.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.title)}</option>)}</select></label>
      <label>我的回答<textarea value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} placeholder="写下你的完整句子或小故事" required maxLength={10000}/></label>
      <button className="primary-button" disabled={busy || !selectedAssignment}>提交给老师审核</button>
    </form>
  </section>;

  if (nav === "成长档案") return <section>
    <PageTitle eyebrow="来自掌握度快照与作业记录" title="成长档案" detail="每一项都能追溯到真实学习证据。"/>
    <StudentReviewCenter data={data} act={act} notify={notify}/>
    <section className="metric-grid">{data.mastery.map((item) => <article className="metric-card" key={String(item.objectiveId ?? item.skill)}>
      <span>{stringValue(item.skill)}</span><strong>{Math.round(numberValue(item.mastery) * 100)}</strong><small>{numberValue(item.evidenceCount)} 条学习证据</small>
    </article>)}</section>
    <article className="panel">
      <div className="panel-heading"><div><h3>最近提交</h3><small>只显示教师确认后的评分与反馈</small></div><span>{data.submissions.length} 条</span></div>
      {data.submissions.length ? data.submissions.map((item) => <div className="history-row" key={String(item.id)}>
        <div><strong>{stringValue(item.assignmentTitle)}</strong><small>{stringValue(item.created_at)}{item.review_status === "reviewed" && item.feedback ? ` · 教师反馈：${stringValue(item.feedback)}` : ""}</small></div>
        <span className={`status ${item.review_status === "reviewed" ? "published" : "draft"}`}>{item.review_status === "reviewed" ? `${numberValue(item.score)} 分` : "待教师审核"}</span>
      </div>) : <p className="empty-state">完成第一次作业后，记录会显示在这里。</p>}
    </article>
  </section>;

  const current = published[0];
  return <>
    <PageTitle eyebrow="学习总览 · 数据实时读取" title={`早上好，${data.user.displayName}！`} detail="今天也一起发现中文里的小惊喜。"/>
    <StudentTodayPlan data={data} act={act} notify={notify} navigate={navigate}/>
    <section className="hero-learning">
      <div className="hero-copy">
        <span className="tag">正在学习 · {stringValue(current?.activity_type, "等待教师发布任务")}</span>
        <h2>{stringValue(current?.title, "新的学习任务")}</h2>
        <p>听示范音，完成口语录音。录音会保存到 R2，并进入教师审核。</p>
        <div className="lesson-meta"><span>建议 12 分钟</span><i/><span>{data.submissions.length} 次提交</span></div>
        <div className="hero-actions">
          <button className="soft-button" type="button" onClick={speak}>▶ 听示范发音</button>
          <button className={`primary-button ${recording ? "danger-button" : ""}`} type="button" onClick={toggleRecording} disabled={!selectedAssignment || busy}>{recording ? "停止并提交录音" : "● 开始真实录音"}</button>
        </div>
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
