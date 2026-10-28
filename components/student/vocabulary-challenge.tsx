import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState, PageHeader } from "@/components/workspace/workspace-ui";
import { postJson, requestJson } from "@/lib/workspace/api";
import { vocabularyReviewError, type VocabularyReviewCatalog } from "@/lib/vocabulary-review-types";
import styles from "./vocabulary-challenge.module.css";

const time = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
export default function VocabularyChallenge() {
  const [catalog, setCatalog] = useState<VocabularyReviewCatalog | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [choice, setChoice] = useState<{ sessionId: string; revision: number; selected: number } | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const starts = useRef(new Map<string, string>());
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<VocabularyReviewCatalog>(`/api/v1/vocabulary-review${sessionId ? `?sessionId=${sessionId}` : ""}`, { cache: "no-store", signal: controller.signal }).then((data) => {
      if (controller.signal.aborted || current !== version.current) return;
      setCatalog(data); setError("");
      for (const [mode, id] of starts.current) if (data.recent.some((item) => item.id === id)) starts.current.delete(mode);
    }).catch(() => { if (!controller.signal.aborted && current === version.current) setError("生词复习暂时没有读取成功，请重新读取。当前选择仍保留。"); });
    return () => controller.abort();
  }, [reload, sessionId]);
  const session = catalog?.recent.find((item) => item.id === sessionId) ?? catalog?.active ?? catalog?.recent[0];
  const feedback = session?.feedback && dismissed[session.id] !== session.feedback.requestId ? session.feedback : null;
  const selected = choice && session && choice.sessionId === session.id && choice.revision === session.revision ? choice.selected : undefined;
  async function perform(body: Record<string, unknown>) {
    const operation = ++version.current; setBusy(true); setError("");
    try {
      const data = await postJson<VocabularyReviewCatalog>("/api/v1/vocabulary-review", body);
      if (operation !== version.current) { setReload((value) => value + 1); return; }
      version.current++; setCatalog(data); setChoice(null);
      if (body.action === "start") {
        starts.current.delete(String(body.mode));
        setSessionId(data.active?.id ?? data.recent.find((item) => item.id === body.id)?.id ?? "");
      } else setSessionId(String(body.sessionId));
    } catch (reason) { if (operation === version.current) setError(vocabularyReviewError(reason)); setReload((value) => value + 1); }
    finally { setBusy(false); }
  }
  function start(mode: "due" | "free") {
    const id = starts.current.get(mode) ?? crypto.randomUUID(); starts.current.set(mode, id);
    void perform({ action: "start", id, mode });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault(); if (!session || selected === undefined) return;
    const key = `${session.id}:${session.revision}:${selected}`; const id = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, id);
    void perform({ action: "answer", sessionId: session.id, requestId: id, revision: session.revision, selectedOption: selected });
  }
  return <section className={styles.page}>
    <PageHeader title="生词复习挑战" description="把读过的词，再认一认、用一用。错词会在本轮再次出现。"/>
    <div className={styles.toolbar}><p>生词本 {catalog?.totalWords ?? "…"} 个词 · 当前到期 {catalog?.dueCount ?? "…"} 个</p><div><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button>{catalog?.active ? catalog.active.id !== session?.id && <Button disabled={busy} onClick={() => setSessionId(catalog.active!.id)}>继续上次练习<ArrowRight/></Button> : <><Button variant="outline" disabled={busy || !catalog?.totalWords} onClick={() => start("free")}>自由练习</Button><Button disabled={busy || !catalog?.dueCount} onClick={() => start("due")}>开始到期复习<ArrowRight/></Button></>}</div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!catalog ? <p role="status">正在读取生词与复习安排…</p> : !catalog.totalWords && !session ? <EmptyState title="先把想记住的词收进生词本" description="在交互阅读中点词并收藏，就能在这里进行词义配对和选词填空。"/> : <>
      {session && <section className={styles.challenge} aria-label="本轮生词复习">
        <div className={styles.heading}><div><h2>{session.mode === "due" ? "到期复习" : "自由练习"}</h2><p>本轮 {session.total} 个词 · 已作答 {session.attemptCount} 次 · 剩余 {session.remaining} 次（含回练）</p></div><label>回看记录<NativeSelect value={session.id} disabled={busy} onChange={(event) => setSessionId(event.target.value)}>{catalog.recent.map((item) => <option value={item.id} key={item.id}>{time(item.createdAt)} · {item.mode === "due" ? "到期复习" : "自由练习"}{item.complete ? " · 已结束" : " · 进行中"}</option>)}</NativeSelect></label></div>
        {feedback ? <div className={styles.feedback} role="status"><h3>{feedback.correct ? <><Check/>答对了</> : "先记住这个词，再来一次"}</h3><strong>{feedback.word}</strong>{!feedback.correct && <p>本次选择：{feedback.selected}</p>}<p>{feedback.meaning}</p><blockquote>{feedback.example}</blockquote>{feedback.nextDueAt && <p>下次复习：{time(feedback.nextDueAt)}</p>}{feedback.repeated && session.mode === "due" && <p>纠正后的重答保留首次安排，不增加复习阶段。</p>}<Button disabled={busy} onClick={() => setDismissed({ ...dismissed, [session.id]: feedback.requestId })}>{session.complete ? "查看本轮小结" : "继续下一词"}<ArrowRight/></Button></div>
          : session.complete ? <div className={styles.finished}><h3>本轮练习已结束</h3><p>首次作答答对 {session.firstCorrect}/{session.total} 个词，共练习 {session.attemptCount} 次。{session.remaining ? `还有 ${session.remaining} 次未完成，相关词语仍可继续安排。` : ""}</p><p>{session.mode === "free" ? "本轮为自由练习，后续到期计划保持原安排。" : "首次答错的词从约一天后重新复习；答对后逐步延长间隔。"}</p></div>
            : session.question && <form onSubmit={submit}><fieldset disabled={busy}><legend>{session.question.kind === "meaning" ? "词义配对" : "选词填空"}：{session.question.prompt}</legend><div className={styles.options}>{session.question.options.map((option, index) => <label key={`${session.revision}:${option}`}><input type="radio" name={`vocabulary-${session.id}`} required checked={selected === index} onChange={() => setChoice({ sessionId: session.id, revision: session.revision, selected: index })}/><span>{option}</span></label>)}</div></fieldset><Button type="submit" disabled={busy || selected === undefined}>{busy ? "正在保存…" : "检查答案"}</Button></form>}
        {!session.complete && <Button className={styles.finish} variant="ghost" disabled={busy} onClick={() => void perform({ action: "finish", sessionId: session.id, requestId: crypto.randomUUID(), revision: session.revision })}>结束本轮并保留已做部分</Button>}
      </section>}
      {!catalog.active && !catalog.dueCount && <p className={styles.note}>当前没有到期词语。{catalog.nextDueAt ? `下次到期：${time(catalog.nextDueAt)}。` : ""}可以收藏新词，或选择自由练习。</p>}
      <p className={styles.note}>每轮最多 5 个词，每个错词最多回练两次。到期复习采用固定的 1、3、7、14 天间隔；结果只用于练习安排，不作为课程成绩。</p>
    </>}
  </section>;
}
