import { RetainedFeature } from "../workspace/retained-feature";
import { lazy, useEffect, useEffectEvent, useRef, useState } from "react";
import { ProgressRing } from "../progress-ring";
import type { Act, Notify, WorkspaceData } from "@/lib/platform-types";
import { numberValue, stringValue } from "@/lib/platform-types";
import { DiagnosticStimulus } from "@/components/diagnostic-evidence";
import { EXCHANGE_PARTNERS, readFamilyPlan, readFamilyWorkSnapshot, type ExchangePartner } from "@/lib/family-task";
import { FamilyTaskGuide } from "@/components/family/family-task-guide";
import familyStyles from "@/components/family/family-task-guide.module.css";
import { SEQUENCE_STAGE_LABELS, sequenceTaskId, sequenceStages, sequenceStageReady, sequencePrompt, sequenceTime, readSequenceWork, type SequenceStage } from "@/lib/learning-sequence-types";
import { ArrowRight, BookOpen, CheckCheck, FileText, Headphones, Mic, Send, Sparkles, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState, SectionHeading, StatCard } from "@/components/workspace/workspace-ui";
import styles from "@/components/student/student-view.module.css";

const StudentDiagnostic = lazy(() => import("./diagnostic").then(module => ({ default: module.StudentDiagnostic })));
const StudentReviewCenter = lazy(() => import("./review-center").then(module => ({ default: module.StudentReviewCenter })));
const StudentTodayPlan = lazy(() => import("./today-plan").then(module => ({ default: module.StudentTodayPlan })));
const HanziWritingLab = lazy(() => import("./hanzi-writing-lab"));
const ReadingWorkshop = lazy(() => import("./reading-workshop"));
const DialogueChallenge = lazy(() => import("./dialogue-challenge"));
const JourneyMap = lazy(() => import("./journey-map"));
const VocabularyChallenge = lazy(() => import("./vocabulary-challenge"));
const DictationLab = lazy(() => import("./dictation-lab"));
const AbilityEvidenceProfile = lazy(() => import("@/components/diagnostic-evidence").then(module => ({ default: module.AbilityEvidenceProfile })));
const FamilyPortfolio = lazy(() => import("@/components/family/family-portfolio").then(module => ({ default: module.FamilyPortfolio })));
const StudentCaseTimeline = lazy(() => import("@/components/learning/student-case-timeline").then(module => ({ default: module.StudentCaseTimeline })));
const SequenceReports = lazy(() => import("@/components/learning/learning-sequences").then(module => ({ default: module.SequenceReports })));

export type StudentViewProps = { nav: string; data: WorkspaceData; receivedAt: number; act: Act; refresh: () => Promise<void>; notify: Notify; navigate: (target: string) => void; active?: boolean };
type RecordingDraft = { id: string; blob: Blob; url: string; assignmentId: string; familyTaskId: string | null; title: string; familyPartner?: ExchangePartner; familyRevision?: number; sequenceId?: string; sequenceStage?: SequenceStage };

export default function StudentView({ nav, data, receivedAt, act, refresh, notify, navigate, active = true }: StudentViewProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(String(data.assignments.find((item) => item.status === "published")?.id ?? ""));
  const [textDrafts, setTextDrafts] = useState<Record<string, { answer: string; familyRevision?: number }>>({});
  const textAnswer = textDrafts[selectedAssignment]?.answer ?? "";
  const [partners, setPartners] = useState<Record<string, ExchangePartner>>({});
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [retestRefreshing, setRetestRefreshing] = useState(false);
  const [failedRetestRead, setFailedRetestRead] = useState<number | null>(null);
  const [recordingDraft, setRecordingDraft] = useState<RecordingDraft | null>(null);
  const recordingDraftUrl = recordingDraft?.url;
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const mounted = useRef(true);
  const recordingRequest = useRef(0);
  const textRequests = useRef(new Map<string, { key: string; id: string }>());
  const published = data.assignments.filter((item) => item.status === "published");
  const familyTasks = data.recommendations.filter((item) => item.source_type === "family" && item.status === "pending" && item.assignment_id && (!item.familyReviewStatus || item.familyReviewStatus === "reviewed"));
  const familyTask = familyTasks.find((item) => `family:${item.id}` === selectedAssignment);
  const familyPlan = readFamilyPlan(familyTask?.family_plan_json);
  const familyRevision = familyPlan?.revision ?? 0;
  const familyPartner = partners[selectedAssignment] ?? familyPlan?.partner ?? "family";
  const sequences = (data.learningSequences ?? []).filter((item) => item.studentUserId === data.user.id);
  const sequence = sequences.find((item) => sequenceStages(item).some((stage) => sequenceTaskId(item.id, stage) === selectedAssignment));
  const sequenceStage: SequenceStage = selectedAssignment.endsWith(":retest") ? "retest" : selectedAssignment.endsWith(":transfer") ? "transfer" : "practice";
  const sequenceReady = !sequence || (sequenceStageReady(sequence, sequenceStage) && !sequence[sequenceStage].some((work) => !work.reviewed));
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
  const targetSelector = <label className={styles.field}>选择任务<NativeSelect className="w-full" value={selectedAssignment} onChange={(event) => setSelectedAssignment(event.target.value)} required disabled={recording || recordingBusy || busy}>
    <option value="">请选择任务</option>{published.map((item) => <option value={String(item.id)} key={String(item.id)}>{stringValue(item.title)}</option>)}
    {familyTasks.map((item) => <option value={`family:${item.id}`} key={`family:${item.id}`}>家庭：{stringValue(item.title)}</option>)}
    {sequences.filter((item) => published.some((task) => task.id === item.assignmentId)).flatMap((item) => sequenceStages(item).map((stage) => <option key={sequenceTaskId(item.id, stage)} value={sequenceTaskId(item.id, stage)} disabled={!sequenceStageReady(item, stage) || item[stage].some((work) => !work.reviewed)}>{SEQUENCE_STAGE_LABELS[stage]}：{item.title}{stage === "retest" && !item.retestOpen ? "（尚未开放）" : ""}</option>))}
  </NativeSelect></label>;
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
  useEffect(() => {
    // 页面或任务已切换时，尚未返回的麦克风授权也必须失效。
    recordingRequest.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, [nav, selectedAssignment, active]);
  async function refreshRetestStatus() {
    if (retestRefreshing) return;
    setRetestRefreshing(true);
    try { await refresh(); setFailedRetestRead(null); }
    catch { setFailedRetestRead(receivedAt); }
    finally { setRetestRefreshing(false); }
  }
  const refreshRetest = useEffectEvent(() => { void refreshRetestStatus(); });
  useEffect(() => {
    if (!active) return;
    const next = (data.learningSequences ?? []).filter((item) => item.studentUserId === data.user.id && item.retestAvailableAt && !item.retestOpen)
      .map((item) => Date.parse(item.retestAvailableAt!)).sort((a, b) => a - b)[0];
    if (!next) return;
    // 使用本次服务器响应的时间差，页面持续打开时也能在开放后刷新任务状态。
    const delay = Math.max(1000, next - Date.parse(data.generatedAt) - (performance.now() - receivedAt));
    const timer = window.setTimeout(() => refreshRetest(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [data.learningSequences, data.generatedAt, data.user.id, receivedAt, active]);
  const masteryAverage = data.mastery.length
    ? Math.round(data.mastery.reduce((sum, row) => sum + numberValue(row.mastery) * 100, 0) / data.mastery.length)
    : null;

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
    const target = selectedAssignment;
    const payload = { assignmentId, familyTaskId: familyTask?.id ?? null, answer: textAnswer,
      ...(sequence ? { sequenceId: sequence.id, sequenceStage } : {}),
      ...(familyTask ? { familyPartner, familyRevision: textDrafts[target]?.familyRevision ?? familyRevision } : {}) };
    const key = JSON.stringify(payload);
    let request = textRequests.current.get(target);
    if (!request || request.key !== key) { request = { key, id: crypto.randomUUID() }; textRequests.current.set(target, request); }
    try {
      await act("submit_text", { ...payload, submissionId: request.id });
      textRequests.current.delete(target);
      setTextAnswer("");
      if (familyTask || sequence) setSelectedAssignment((current) => current === target ? "" : current);
      notify("作业已提交", "老师评价后，可在成长档案查看反馈。");
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
    if (recordingBusy) return;
    if (!assignment || !sequenceReady) return notify("请先选择可提交的任务", "练习经教师评价后才能提交迁移作品；待评作品不能重复提交。", "error");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return notify("无法录音", "当前浏览器不支持麦克风录音。", "error");
    let stream: MediaStream | null = null;
    const request = ++recordingRequest.current;
    setRecordingBusy(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || request !== recordingRequest.current) { stream.getTracks().forEach((track) => track.stop()); return; }
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
      if (mounted.current && request === recordingRequest.current) notify("无法开始录音", reason instanceof Error ? reason.message : "请检查麦克风权限后重试。", "error");
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

  const recordingControls = <div className={styles.recordingControls}>
    <div className={styles.actions}><Button variant="outline" type="button" onClick={speak} disabled={!assignment}><Volume2/>听任务标题</Button>
      <Button variant={recording ? "destructive" : "secondary"} type="button" onClick={toggleRecording} disabled={(!assignment && !recording) || recordingBusy || (!recording && (!sequenceReady || assignment?.diagnostic_mode === "writing"))}>{recording ? <Square/> : <Mic/>}{recording ? "停止录音并试听" : recordingBusy ? "正在准备…" : recordingDraft ? "重新录音" : "开始录音"}</Button></div>
    {recording && <p className={styles.recordingStatus} role="status"><span/>正在录音，完成后停止并试听。</p>}
    {assignment?.diagnostic_mode === "writing" && <p className={styles.help}>这项任务需要提交文字。</p>}
    {recordingDraft && <div className={styles.recordingPreview}><p>提交到：{recordingDraft.title}{recordingDraft.familyPartner ? ` · 交流对象：${EXCHANGE_PARTNERS[recordingDraft.familyPartner].zh}` : ""}</p><audio controls src={recordingDraft.url} aria-label="录音试听"/>{recordingTaskChanged && <p className={styles.warning} role="alert">交流要求已更新，请核对后重新录音。</p>}<Button type="button" disabled={recordingBusy || recordingTaskChanged} onClick={uploadRecording}><Send/>{recordingBusy ? "正在提交…" : "提交录音"}</Button></div>}
  </div>;

  const retestRefreshNotice = failedRetestRead === receivedAt && <Card className={styles.notice} role="alert"><p>复测状态刷新失败，当前输入和录音已保留。</p><Button variant="outline" type="button" disabled={retestRefreshing} onClick={refreshRetestStatus}>{retestRefreshing ? "正在刷新…" : "重试刷新"}</Button></Card>;

  const submittedCount = data.submissions.length;
  const pendingCount = data.submissions.filter((item) => item.review_status !== "reviewed").length;
  const recentWork = (limit?: number) => {
    const works = limit ? data.submissions.slice(0, limit) : data.submissions;
    return works.length ? <div className={styles.workList}>{works.map((item) => <div className={styles.workRow} key={String(item.id)}>
      <span className={styles.workIcon}>{item.asset_key ? <Headphones/> : <FileText/>}</span>
      <div className={item.family_task_id ? styles.workCopy + " " + familyStyles.workHistory : styles.workCopy}>
        <strong>{stringValue(readSequenceWork(item.sequence_snapshot_json)?.title ?? readFamilyWorkSnapshot(item.family_snapshot_json)?.title ?? item.familyTaskTitle ?? item.assignmentTitle)}</strong>
        <small>{stringValue(item.created_at)}</small>
        {item.review_status === "reviewed" && !!item.feedback && <p>{stringValue(item.feedback)}</p>}
      </div>
      <Badge variant={item.review_status === "reviewed" ? "secondary" : "outline"}>{item.review_status === "reviewed" ? numberValue(item.score) + " 分" : "待评价"}</Badge>
    </div>)}</div> : <EmptyState title="还没有提交作品" description="完成学习任务后，作品和老师的反馈会保存在这里。" action={<Button variant="outline" type="button" onClick={() => navigate("学习任务")}>查看学习任务<ArrowRight/></Button>}/>;
  };

  const current = assignment;
  return <>
<RetainedFeature active={nav === "AI 课堂"}>{<section className={styles.page}>
    <PageHeader title="AI 课堂" description="把学习中遇到的问题留在这里，一起寻找答案。"/>
    {retestRefreshNotice}
    <div className={styles.tutorLayout}>
      <Card className={styles.questionCard}><CardHeader><span className={styles.featureIcon}><Sparkles/></span><CardTitle>今天想了解什么？</CardTitle></CardHeader><CardContent>
        <form className={styles.form} onSubmit={askTutor}>
          <label className={styles.field}>你的问题<Textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} placeholder="例如：这篇文章里的“团圆”是什么意思？" required rows={6}/></label>
          <Button type="submit" disabled={busy}><Send/>{busy ? "正在思考…" : "发送问题"}</Button>
        </form>
      </CardContent></Card>
      {answer ? <Card className={styles.answerCard}><CardHeader><CardTitle>回答</CardTitle></CardHeader><CardContent className={styles.answerContent}>
        <p className={styles.answer}>{answer}</p>
        {!!sources.length && <section className={styles.references}><h3>参考资料 <span>{sources.length}</span></h3>
          {sources.map((source) => <div className={styles.citation} key={String(source.id)}><strong>{String(source.title)}</strong><p>{String(source.excerpt)}</p></div>)}
        </section>}
      </CardContent></Card> : <div className={styles.tutorEmpty}><BookOpen/><h2>从一个问题开始</h2><p>可以问词语含义、课文内容，或请它帮你梳理表达思路。</p></div>}
    </div>
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "学习任务"}>{<section className={styles.page}>
    <PageHeader title="我的学习任务" description="选择任务，完成回答，再提交给老师。"/>
    {retestRefreshNotice}
    <section id="student-submission" className={styles.submissionLayout}>
      <Card className={styles.taskContext}><CardHeader><CardTitle>当前任务</CardTitle></CardHeader><CardContent className={styles.form}>
        {targetSelector}
        {sequence ? <div className={styles.taskBrief}><Badge variant="secondary">{SEQUENCE_STAGE_LABELS[sequenceStage]}</Badge><h3>{sequence.title}</h3><p className={styles.help}>{sequence.objectiveTitle}</p><p className="generated-copy">{sequencePrompt(sequence, sequenceStage)}</p><p>情境：{sequenceStage === "retest" ? sequence.retestContext : sequence.transferContext}</p>{sequenceStage === "retest" && sequence.retestAvailableAt && <p className={styles.help}>开放时间：{sequenceTime(sequence.retestAvailableAt)}</p>}<details className={styles.details}><summary>评分标准</summary><p>{sequence.rubric.map((item) => item.name + " " + item.weight + "%").join("、")}</p></details>{!sequenceReady && <p className={styles.warning} role="status">{sequenceStage === "retest" && !sequence.retestOpen ? "复测尚未开放，请在开放时间后提交。" : "请等待前一阶段的教师评价；待评作品不能重复提交。"}</p>}</div>
        : familyTask ? <><FamilyTaskGuide plan={familyPlan} title={"家庭交流：" + stringValue(familyTask.title)} detail={stringValue(familyTask.detail, "")} objectiveTitle={stringValue(familyTask.objectiveTitle, "")} expanded/>
          <label className={styles.field}>本次实际交流对象<NativeSelect className="w-full" value={familyPartner} disabled={recording || recordingBusy || busy} onChange={(event) => {
            const partner = event.target.value as ExchangePartner;
            setPartners({ ...partners, [selectedAssignment]: partner });
            setRecordingDraft((draft) => draft?.familyTaskId === String(familyTask.id) ? { ...draft, familyPartner: partner } : draft);
          }}>{Object.entries(EXCHANGE_PARTNERS).map(([value, label]) => <option key={value} value={value}>{label.zh} / {label.en}</option>)}</NativeSelect></label></>
        : assignment ? <div className={styles.taskBrief}><Badge variant="secondary">{stringValue(assignment.activity_type, "学习作业")}</Badge><h3>{stringValue(assignment.title)}</h3>{!!assignment.due_at && <p className={styles.help}>截止：{stringValue(assignment.due_at)}</p>}{!!assignment.diagnostic_prompt && <p>{stringValue(assignment.diagnostic_prompt)}</p>}{!!assignment.diagnostic_media_id && <DiagnosticStimulus id={String(assignment.diagnostic_media_id)} kind="image"/>}</div>
        : <EmptyState title="请选择一个任务" description="已发布的课程任务、家庭任务和阶段练习都在上方列表中。"/>}
      </CardContent></Card>
      <div className={styles.submissionForms}>
        <Card><CardHeader><CardTitle>文字回答</CardTitle></CardHeader><CardContent><form className={styles.form} onSubmit={submitText}>
          <label className={styles.field}>我的回答<Textarea value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} disabled={busy || assignment?.diagnostic_mode === "speaking"} placeholder={assignment?.diagnostic_mode === "speaking" ? "这项口述任务请使用下方录音提交。" : "写下你的回答…"} required maxLength={10000} rows={7}/></label>
          {textTaskChanged && <div className={styles.notice} role="alert"><p>交流要求已更新，文字仍保留。</p><Button variant="outline" type="button" disabled={busy} onClick={() => setTextDrafts({ ...textDrafts, [selectedAssignment]: { answer: textAnswer, familyRevision } })}>已核对要求，继续使用这份文字</Button></div>}
          <Button type="submit" disabled={busy || textTaskChanged || !sequenceReady || !assignment || assignment.diagnostic_mode === "speaking"}><Send/>{busy ? "正在提交…" : "提交文字"}</Button>
        </form></CardContent></Card>
        <Card><CardHeader><CardTitle>录音作品</CardTitle></CardHeader><CardContent>{recordingControls}</CardContent></Card>
      </div>
    </section>
    <StudentDiagnostic data={data} act={act} notify={notify} onStartAssignment={(id) => {
      if (recording || recordingBusy || busy) return notify("请先完成当前提交", "处理当前作品后再切换任务。", "error");
      setSelectedAssignment(id);
      document.getElementById("student-submission")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }}/>
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "成长档案"}>{<section className={styles.page}>
    <PageHeader title="成长档案" description="回看每一次练习、作品和老师的反馈。"/>
    {retestRefreshNotice}
    <section className={styles.stats}><StatCard label="已提交作品" value={submittedCount} icon={<FileText/>}/><StatCard label="待教师评价" value={pendingCount} icon={<CheckCheck/>}/><StatCard label="平均掌握度" value={masteryAverage === null ? "待评估" : masteryAverage + "%"} icon={<BookOpen/>}/></section>
    <AbilityEvidenceProfile studentId={data.user.id} revision={data.generatedAt}/>
    <StudentCaseTimeline view="student" studentId={data.user.id} revision={data.generatedAt}/>
    <FamilyPortfolio studentId={data.user.id} revision={data.generatedAt}/>
    <SequenceReports sequences={sequences} onStartTask={(id) => { if (recording || recordingBusy || busy) return; setSelectedAssignment(id); navigate("学习任务"); }}/>
    <StudentReviewCenter data={data} act={act} refresh={refresh} notify={notify}/>
    {!!data.mastery.length && <Card><CardHeader><CardTitle>学习目标掌握度</CardTitle></CardHeader><CardContent><div className={styles.masteryList}>{data.mastery.map((item) => <div className={styles.masteryRow} key={String(item.objectiveId ?? item.skill)}><div><strong>{stringValue(item.title, stringValue(item.skill))}</strong><small>{stringValue(item.skill)} · {numberValue(item.evidenceCount)} 条记录</small></div><span>{Math.round(numberValue(item.mastery) * 100)}%</span></div>)}</div></CardContent></Card>}
    <Card><CardHeader><CardTitle>提交记录</CardTitle></CardHeader><CardContent>{recentWork()}</CardContent></Card>
  </section>}</RetainedFeature>
<RetainedFeature active={nav === "汉字书写"}><HanziWritingLab/></RetainedFeature>
<RetainedFeature active={nav === "交互阅读"}><ReadingWorkshop notify={notify}/></RetainedFeature>
<RetainedFeature active={nav === "情境闯关"}><DialogueChallenge notify={notify}/></RetainedFeature>
<RetainedFeature active={nav === "主题闯关"}><JourneyMap notify={notify}/></RetainedFeature>
<RetainedFeature active={nav === "生词复习"}><VocabularyChallenge/></RetainedFeature>
<RetainedFeature active={nav === "听写实验室"}><DictationLab/></RetainedFeature>
<RetainedFeature active={nav !== "AI 课堂" && nav !== "学习任务" && nav !== "成长档案" && nav !== "汉字书写" && nav !== "交互阅读" && nav !== "情境闯关" && nav !== "主题闯关" && nav !== "生词复习" && nav !== "听写实验室"}>{<section className={styles.page}>
    <PageHeader title={data.user.displayName + "，开始今天的学习吧"} description="从当前任务出发，一点点积累自己的中文表达。" actions={<Button variant="outline" type="button" onClick={() => navigate("成长档案")}>成长档案<ArrowRight/></Button>}/>
    {retestRefreshNotice}
    <section className={styles.stats}><StatCard label="已发布任务" value={published.length} icon={<BookOpen/>}/><StatCard label="已提交作品" value={submittedCount} icon={<FileText/>}/><StatCard label="待教师评价" value={pendingCount} icon={<CheckCheck/>}/></section>
    <div className={styles.overviewGrid}>
      <Card className={styles.currentTask}><CardContent>
        <div className={styles.currentLabel}><span className={styles.featureIcon}><BookOpen/></span><Badge variant="secondary">继续学习</Badge></div>
        <h2>{sequence ? sequence.title + " · " + SEQUENCE_STAGE_LABELS[sequenceStage] : stringValue(familyTask?.title ?? current?.title, "准备迎接新的任务")}</h2>
        <p>{current ? sequence ? sequence.objectiveTitle : familyTask ? stringValue(familyTask.detail, "完成交流后，留下自己的作品。") : current.diagnostic_prompt ? stringValue(current.diagnostic_prompt) : stringValue(current.activity_type, "选择表达方式，完成后提交给老师。") : "老师发布任务后，你就可以在这里开始学习。"}</p>
        {published.length > 0 && targetSelector}
        <Button type="button" onClick={() => navigate("学习任务")}>{current ? "查看任务并开始" : "查看学习任务"}<ArrowRight/></Button>
      </CardContent></Card>
      <Card className={styles.masterySummary}><CardHeader><CardTitle>我的学习进度</CardTitle></CardHeader><CardContent>
        <ProgressRing value={masteryAverage} label="平均掌握度"/>
        {data.mastery.length ? <div className={styles.skillSummary}>{data.mastery.slice(0, 3).map((item) => <div key={String(item.objectiveId ?? item.skill)}><span>{stringValue(item.skill)}</span><strong>{Math.round(numberValue(item.mastery) * 100)}%</strong></div>)}</div> : <p className={styles.help}>完成诊断或作业并获得评价后，查看自己的学习进度。</p>}
      </CardContent></Card>
    </div>
    <StudentTodayPlan data={data} act={act} notify={notify} navigate={navigate} onStartTask={(id) => { setSelectedAssignment(id); navigate("学习任务"); }}/>
    <Card><CardHeader><SectionHeading title="最近作品" action={<Button variant="ghost" type="button" onClick={() => navigate("成长档案")}>全部记录<ArrowRight/></Button>}/></CardHeader><CardContent>{recentWork(4)}</CardContent></Card>
  </section>}</RetainedFeature>
</>;
}
