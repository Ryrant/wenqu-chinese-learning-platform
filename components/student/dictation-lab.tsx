import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RefreshCw, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/workspace/workspace-ui";
import { postJson, requestJson } from "@/lib/workspace/api";
import { dictationError, type DictationAnswer, type DictationCatalog } from "@/lib/dictation-types";
import styles from "./dictation-lab.module.css";

function Comparison({ answer }: { answer: DictationAnswer }) {
  return <div className={styles.comparison}><h3>{answer.correct ? <><Check/>与参考文字一致</> : "再看看这些不同之处"}</h3><p><strong>参考：</strong>{answer.expected}</p><p><strong>你写：</strong>{answer.actual}</p>
    {!answer.correct && <ul>{answer.differences.filter((item) => item.kind !== "same").map((item, index) => <li key={index} data-kind={item.kind}>{item.kind === "missing" ? `漏写“${item.expected}”` : item.kind === "extra" ? `多写“${item.actual}”` : `你写“${item.actual}”，参考为“${item.expected}”`}</li>)}</ul>}
    <p className={styles.note}>本项播放 {answer.playCount} 次 · {answer.usedReference ? "已查看参考后练习" : "未点开参考文字"}</p></div>;
}
const time = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
export default function DictationLab() {
  const [catalog, setCatalog] = useState<DictationCatalog | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [kind, setKind] = useState<"vocabulary" | "words" | "sentences">("vocabulary");
  const [lessonId, setLessonId] = useState("park-morning");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [plays, setPlays] = useState<Record<string, number>>({});
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const requests = useRef(new Map<string, string>());
  const starts = useRef(new Map<string, string>());
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"loading" | "ready" | "missing" | "unsupported">("loading");
  const [voiceReload, setVoiceReload] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const speechGeneration = useRef(0);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    speechGeneration.current++;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if (utterance.current) { window.speechSynthesis?.cancel(); utterance.current = null; }
    setSpeaking(false);
  }, []);
  useEffect(() => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") { setVoiceStatus("unsupported"); return; }
    const synth = window.speechSynthesis;
    const update = () => {
      const voices = synth.getVoices();
      const selected = voices.find((item) => /^zh[-_]CN$/i.test(item.lang)) ?? voices.find((item) => /^(zh(?:[-_](?:Hans|Hant))?(?:[-_](?:CN|SG|TW))?|cmn(?:[-_](?:CN|SG|TW))?)$/i.test(item.lang));
      setVoice(selected ?? null); setVoiceStatus(selected ? "ready" : voices.length ? "missing" : "loading");
    };
    update(); synth.addEventListener("voiceschanged", update);
    const timer = setTimeout(() => { update(); if (!synth.getVoices().length) setVoiceStatus("missing"); }, 5000);
    return () => { clearTimeout(timer); synth.removeEventListener("voiceschanged", update); stop(); };
  }, [voiceReload, stop]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<DictationCatalog>(`/api/v1/dictation${sessionId ? `?sessionId=${sessionId}` : ""}`, { signal: controller.signal, cache: "no-store" }).then((data) => {
      if (controller.signal.aborted || current !== version.current) return;
      setCatalog(data); setReadError("");
      for (const [key, id] of starts.current) if (data.recent.some((item) => item.id === id)) starts.current.delete(key);
    }).catch(() => { if (!controller.signal.aborted && current === version.current) setReadError("听写内容与进度暂时没有读取成功，请重新读取。当前输入仍保留。"); });
    return () => controller.abort();
  }, [reload, sessionId]);
  const session = catalog?.recent.find((item) => item.id === sessionId) ?? catalog?.active ?? catalog?.recent[0];
  const question = session?.question;
  const questionId = question?.id ?? "";
  const answer = drafts[questionId] ?? "";
  const last = session?.answers.at(-1);
  const feedback = session && last && dismissed[session.id] !== last.requestId ? last : null;
  const selectedLesson = catalog?.lessons.find((item) => item.id === lessonId);
  useEffect(() => { stop(); setSpeechError(""); return stop; }, [questionId, stop]);
  function play() {
    if (!question || !voice) return;
    stop(); const generation = speechGeneration.current; setSpeaking(true); setSpeechError("");
    const text = new SpeechSynthesisUtterance(question.speechText); text.lang = voice.lang; text.voice = voice; text.rate = .8;
    utterance.current = text;
    text.onstart = () => { if (generation === speechGeneration.current && speechTimer.current) clearTimeout(speechTimer.current); };
    text.onend = () => { if (generation !== speechGeneration.current) return; if (speechTimer.current) clearTimeout(speechTimer.current); setPlays((items) => ({ ...items, [question.id]: (items[question.id] ?? 0) + 1 })); setSpeaking(false); utterance.current = null; };
    text.onerror = () => { if (generation !== speechGeneration.current) return; stop(); setSpeechError("播放未能完成，请检查设备语音和音频输出，再重试；也可以查看参考练习。"); };
    speechTimer.current = setTimeout(() => { if (generation === speechGeneration.current) { stop(); setSpeechError("语音未能开始，请重新检测设备语音或查看参考练习。"); } }, 5000);
    try { window.speechSynthesis.speak(text); }
    catch { stop(); setSpeechError("播放未能开始，请重新检测设备语音，或查看参考练习。"); }
  }
  async function perform(body: Record<string, unknown>, submittedQuestionId = "") {
    const operation = ++version.current; setBusy(true); setError(""); stop();
    try {
      const data = await postJson<DictationCatalog>("/api/v1/dictation", body);
      if (body.action === "answer") setDrafts((items) => { if (items[submittedQuestionId]?.trim() !== body.answer) return items; const next = { ...items }; delete next[submittedQuestionId]; return next; });
      if (operation !== version.current) { setReload((value) => value + 1); return; }
      version.current++; setCatalog(data);
      if (body.action === "start" || body.action === "retry") { starts.current.clear(); setSessionId(data.active?.id ?? data.recent.find((item) => item.id === body.id)?.id ?? ""); }
      else setSessionId(String(body.sessionId));
    } catch (reason) { if (operation === version.current) setError(dictationError(reason)); setReload((value) => value + 1); }
    finally { setBusy(false); }
  }
  function start(retry = false) {
    const key = retry ? `retry:${session?.id}` : `${kind}:${kind === "vocabulary" ? "" : lessonId}:${selectedLesson?.source?.revision ?? 0}`;
    const id = starts.current.get(key) ?? crypto.randomUUID(); starts.current.set(key, id);
    void perform(retry ? { action: "retry", id, sessionId: session?.id } : { action: "start", id, kind, ...(kind !== "vocabulary" ? { lessonId, sourceRevision: selectedLesson?.source?.revision ?? 0 } : {}) });
  }
  function hint() {
    if (!session || !question) return;
    const key = `hint:${session.id}:${session.revision}`; const id = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, id);
    void perform({ action: "hint", sessionId: session.id, requestId: id, revision: session.revision });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault(); if (!session || !question || !answer.trim()) return;
    const key = `${question.id}:${session.revision}:${answer.trim()}:${plays[question.id] ?? 0}`; const id = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, id);
    void perform({ action: "answer", sessionId: session.id, requestId: id, revision: session.revision, answer: answer.trim(), playCount: plays[question.id] ?? 0 }, question.id);
  }
  const wrong = session?.answers.filter((item) => !item.correct).length ?? 0;
  return <section className={styles.page}>
    <PageHeader title="听写实验室" description="听一听，写下来，再对照原文找出不同。词语和短句都可以练。"/>
    <div className={styles.toolbar}>{!catalog?.active ? <><label>练习来源<NativeSelect value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="vocabulary">生词本词语</option><option value="words">课文重点词</option><option value="sentences">课文短句</option></NativeSelect></label>{kind !== "vocabulary" && <label>选择课文<NativeSelect value={lessonId} disabled={busy} onChange={(event) => setLessonId(event.target.value)}>{!selectedLesson && <option value={lessonId} disabled>原课文已不可用，请重新选择</option>}{catalog?.lessons.map((item) => <option key={item.id} value={item.id}>{item.title}{item.source ? ` · ${item.source.className}` : ""}</option>)}</NativeSelect></label>}<Button disabled={busy || !catalog || (kind === "vocabulary" ? !catalog.wordCount : !selectedLesson)} onClick={() => start()}>开始一轮听写<ArrowRight/></Button></> : session?.id !== catalog.active.id && <Button disabled={busy} onClick={() => setSessionId(catalog.active!.id)}>继续未完成的听写<ArrowRight/></Button>}<Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button></div>
    <div className={styles.voice}><p role="status">{voiceStatus === "ready" ? "设备普通话语音已就绪。" : voiceStatus === "loading" ? "正在等待设备提供中文语音…" : voiceStatus === "unsupported" ? "当前浏览器不支持设备朗读，可换用支持的浏览器，或查看参考进行对照练习。" : "设备暂无可用普通话语音，可重新检测，或查看参考进行对照练习。"}</p>{voiceStatus !== "ready" && <Button size="sm" variant="outline" disabled={speaking} onClick={() => setVoiceReload((value) => value + 1)}>重新检测语音</Button>}</div>
    {(error || readError) && <p className={styles.error} role="alert">{error || readError}</p>}
    {!catalog ? readError ? <EmptyState title="听写内容暂未载入" description="请点击重新读取，恢复本人的听写内容与已保存进度。"/> : <p role="status">正在读取听写内容…</p> : !session ? <EmptyState title="选择一份内容，开始听写" description="每轮最多 5 项。可以先在交互阅读中收藏词语，也可以直接选择平台或本班课文。"/> : <section className={styles.practice} aria-label="本轮听写">
      <div className={styles.heading}><div><h2>{session.sourceTitle}</h2><p>已保存 {session.answers.length}/{session.total} 项 · {session.kind === "sentences" ? "短句听写" : "词语听写"}</p></div><label>回看轮次<NativeSelect value={session.id} disabled={busy || speaking} onChange={(event) => { stop(); setSessionId(event.target.value); }}>{catalog.recent.map((item) => <option value={item.id} key={item.id}>{time(item.createdAt)} · {item.sourceTitle} · {item.complete ? "已结束" : "进行中"}</option>)}</NativeSelect></label></div>
      {!session.available && <p className={styles.error}>来源已归档或学籍已变化，只能回看已保存结果；可结束本轮后选择其他内容。</p>}
      {feedback ? <><Comparison answer={feedback}/><Button disabled={busy} onClick={() => setDismissed({ ...dismissed, [session.id]: feedback.requestId })}>{session.complete || !session.available ? "查看本轮记录" : "继续下一项"}<ArrowRight/></Button></>
        : session.complete ? <section className={styles.summary} aria-label="听写小结"><h3>本轮听写已结束</h3><p>已完成 {session.answers.length}/{session.total} 项，与参考文字一致 {session.answers.filter((item) => item.correct).length} 项，其中 {session.answers.filter((item) => item.usedReference).length} 项查看过参考。</p>{session.answers.map((item) => <details key={item.requestId}><summary>第 {item.index + 1} 项 · {item.correct ? "与参考一致" : "有不同之处"}{item.usedReference ? " · 看过参考" : ""}</summary><Comparison answer={item}/></details>)}{wrong > 0 && <Button variant="outline" disabled={busy || !session.available || !!catalog.active} onClick={() => start(true)}>只重练 {wrong} 个错项</Button>}</section>
          : question && <div className={styles.question}><h3>第 {session.index + 1} 项 · 来自《{question.sourceTitle}》</h3><div className={styles.playback}><Button disabled={busy || (!speaking && voiceStatus !== "ready")} onClick={speaking ? stop : play}>{speaking ? <Square/> : <Volume2/>}{speaking ? "停止播放" : (plays[question.id] ?? 0) ? "再听一遍" : "播放听写内容"}</Button><p role="status">{speaking ? "正在朗读…" : (plays[question.id] ?? 0) ? `本项已播放 ${plays[question.id]} 次。` : "先播放一遍，再输入听到的内容。"}</p></div>{speechError && <p className={styles.error} role="alert">{speechError}</p>}
            {question.referenceVisible ? <div className={styles.reference}><strong>参考文字：{question.speechText}</strong>{question.pinyin && <p>{question.pinyin}</p>}<p>本项会记录为“已查看参考后练习”。</p></div> : <Button variant="ghost" disabled={busy || speaking} onClick={hint}>查看参考并练习</Button>}
            <form onSubmit={submit}><label>我的听写<Textarea required maxLength={600} rows={session.kind === "sentences" ? 4 : 2} disabled={busy || speaking} value={answer} onChange={(event) => { setDrafts({ ...drafts, [question.id]: event.target.value }); setError(""); }} placeholder="写下你听到的词语或句子。"/></label><Button type="submit" disabled={busy || speaking || !answer.trim() || (!(plays[question.id] ?? 0) && !question.referenceVisible)}>{busy ? "正在保存…" : "核对并保存"}</Button></form>
          </div>}
      {!session.complete && <Button className={styles.finish} variant="ghost" disabled={busy || speaking} onClick={() => void perform({ action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision })}>结束本轮并保留结果</Button>}
    </section>}
    <p className={styles.note}>忽略空格、标点、全半角和英文字母大小写差异，逐字核对原文写法。语音来自当前设备；播放次数按练习操作记录。本功能不判断发音或语义，不计入课程成绩。</p>
  </section>;
}
