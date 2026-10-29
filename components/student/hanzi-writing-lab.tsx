import { useCallback, useEffect, useId, useRef, useState } from "react";
import HanziWriter, { type CharacterJson } from "hanzi-writer";
import { ArrowRight, Check, Lightbulb, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/workspace-ui";
import { practiceCharacters, type PracticeCharacter } from "@/lib/hanzi-practice";
import { postJson, requestJson } from "@/lib/workspace/api";
import { practiceError, type PracticeHistory, type PracticeRecord, type WritingResult } from "@/lib/practice-types";
import { usePracticeSelection } from "@/lib/workspace/use-practice-selection";
import styles from "./hanzi-writing-lab.module.css";

type Mode = "trace" | "recall";
type Phase = "loading" | "writing" | "playing" | "ready" | "complete" | "error";

function WritingBoard({ item, onComplete, onNext }: {
  item: PracticeCharacter; onComplete: (character: string, result: WritingResult) => void; onNext: () => void;
}) {
  const [mode, setMode] = useState<Mode>("trace");
  const [phase, setPhase] = useState<Phase>("loading");
  const [round, setRound] = useState(0);
  const [strokeCount, setStrokeCount] = useState(0);
  const [written, setWritten] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [message, setMessage] = useState("正在准备笔顺…");
  const target = useRef<HTMLDivElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const generation = useRef(0);
  const hints = useRef(0);
  const startedAt = useRef(0);
  const statusId = useId();

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const current = ++generation.current;
    let cancelled = false;
    let loaded = false;
    setPhase("loading");
    setWritten(0);
    setMistakes(0);
    setStrokeCount(0);
    setMessage("正在准备笔顺…");
    hints.current = 0;

    // 复用实例；切换字和练习方式时不重复注册书写监听器。
    if (!writer.current) {
      const colors = getComputedStyle(element);
      const size = element.clientWidth || 320;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      writer.current = new HanziWriter(element, {
        width: size, height: size, padding: size * .08,
        showCharacter: false, showOutline: true,
        strokeColor: colors.getPropertyValue("--foreground").trim(),
        drawingColor: colors.getPropertyValue("--primary").trim(),
        highlightColor: colors.getPropertyValue("--orange").trim(),
        outlineColor: colors.getPropertyValue("--muted-foreground").trim(),
        strokeAnimationSpeed: reducedMotion ? 5 : 1,
        strokeFadeDuration: reducedMotion ? 0 : 180,
        delayBetweenStrokes: reducedMotion ? 0 : 350,
        drawingWidth: 7, showHintAfterMisses: 2, highlightOnComplete: false,
        acceptBackwardsStrokes: false,
        charDataLoader: async (character) => {
          const response = await fetch(`/hanzi/${encodeURIComponent(character)}.json`);
          if (!response.ok) throw new Error("character_data_unavailable");
          return await response.json() as CharacterJson;
        },
      });
    }
    const instance = writer.current;
    const invalidate = () => { generation.current++; };
    instance.cancelQuiz();
    const observer = new ResizeObserver(([entry]) => {
      const size = entry.contentRect.width;
      if (size > 0) instance.updateDimensions({ width: size, height: size, padding: size * .08 });
    });
    observer.observe(element);

    async function start() {
      await instance.setCharacter(item.character);
      if (cancelled) return;
      const data = await instance.getCharacterData();
      if (cancelled) return;
      if (!data || data.symbol !== item.character) throw new Error("character_data_unavailable");
      loaded = true;
      setStrokeCount(data.strokes.length);
      if (mode === "trace") await instance.showOutline({ duration: 0 });
      else await instance.hideOutline({ duration: 0 });
      if (cancelled) return;
      setPhase("writing");
      startedAt.current = Date.now();
      setMessage(mode === "trace" ? "沿着轮廓，按笔顺写下第一笔。" : "不看轮廓，试着按笔顺写出这个字。需要帮助时可以看提示。");
      await instance.quiz({
        onCorrectStroke: (data) => {
          if (cancelled || generation.current !== current) return;
          setWritten(data.strokeNum + 1);
          setMistakes(data.totalMistakes);
          setMessage(data.strokesRemaining ? `这一笔写对了，继续第 ${data.strokeNum + 2} 笔。` : "最后一笔也写好了。");
        },
        onMistake: (data) => {
          if (cancelled || generation.current !== current) return;
          setMistakes(data.totalMistakes);
          setMessage(data.isBackwards ? "这一笔的方向反了，换个方向再试一次。" : `再试一次第 ${data.strokeNum + 1} 笔，注意起笔位置和书写方向。`);
        },
        onComplete: (data) => {
          if (cancelled || generation.current !== current) return;
          setPhase("complete");
          setMistakes(data.totalMistakes);
          setMessage(`“${item.character}”字写完了！${data.totalMistakes ? "可以再练一次，让笔顺更熟悉。" : "每一笔都顺利完成了。"}`);
          onComplete(item.character, { mode, mistakes: data.totalMistakes, hints: hints.current, elapsedMs: Math.min(3600000, Math.max(0, Date.now() - startedAt.current)) });
        },
      });
    }
    void start().catch(() => {
      if (cancelled) return;
      setPhase("error");
      setMessage("这个字的笔顺暂时没有加载成功，请重新加载。也可以先选另一个字。");
    });
    return () => {
      cancelled = true;
      invalidate();
      observer.disconnect();
      instance.cancelQuiz();
      // 数据加载失败时，库的暂停 API 会同步抛错，不能让清理阻断重新加载。
      if (loaded) void instance.pauseAnimation();
    };
  }, [item.character, mode, round, onComplete]);

  async function demonstrate() {
    const instance = writer.current;
    if (!instance) return;
    const current = ++generation.current;
    instance.cancelQuiz();
    setPhase("playing");
    setWritten(0);
    setMistakes(0);
    setMessage("看看每一笔从哪里开始，向哪里写。演示结束后再自己试试。");
    try {
      const result = await instance.animateCharacter();
      if (generation.current !== current || result?.canceled) return;
      setPhase("ready");
      setMessage("看完笔顺了，现在自己写一次吧。");
    } catch {
      if (generation.current !== current) return;
      setPhase("error");
      setMessage("笔顺演示暂时不可用，请重新加载后再试。");
    }
  }

  async function hint() {
    const current = generation.current;
    hints.current++;
    try { await writer.current?.highlightStroke(written); }
    catch {
      if (generation.current === current) setMessage("提示暂时不可用，可以重新练习，或先看笔顺演示。");
    }
  }

  const unavailable = phase === "loading" || phase === "error";
  return <section className={styles.practice} aria-label="书写练习">
    <div className={styles.practiceHeader}>
      <div className={styles.modes} role="group" aria-label="练习方式">
        <Button variant={mode === "trace" ? "secondary" : "ghost"} aria-pressed={mode === "trace"} onClick={() => setMode("trace")}>描红练习</Button>
        <Button variant={mode === "recall" ? "secondary" : "ghost"} aria-pressed={mode === "recall"} onClick={() => setMode("recall")}>独立书写</Button>
      </div>
      <span className={styles.strokeCount}>{strokeCount ? `共 ${strokeCount} 笔` : "准备笔顺中"}</span>
    </div>
    <div className={styles.boardArea}>
      <div className={styles.board} data-writing={phase === "writing"} aria-busy={phase === "loading"}>
        <svg className={styles.grid} viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0V100M0 50H100"/></svg>
        <div ref={target} className={styles.canvas} role="group" aria-label={`${item.character}字田字格`} aria-describedby={statusId}/>
        {(phase === "loading" || phase === "error") && <span className={styles.boardPlaceholder}>{phase === "error" ? "笔顺加载失败" : "正在准备…"}</span>}
      </div>
      <div className={styles.progress} aria-label="本轮书写进度">
        {Array.from({ length: strokeCount }, (_, index) => <span key={index} data-complete={index < written}/>) }
      </div>
      <div className={styles.feedback}>
        <p id={statusId} role={phase === "error" ? "alert" : "status"} className={phase === "complete" ? styles.success : undefined}>{phase === "complete" && <Check/>}{message}</p>
        {!unavailable && <small>{phase === "playing" || phase === "ready" ? "笔顺演示" : `已写 ${written} / ${strokeCount} 笔 · 重试 ${mistakes} 次`}</small>}
      </div>
    </div>
    <div className={styles.controls}>
      {phase === "error" ? <Button onClick={() => setRound((value) => value + 1)}><RotateCcw/>重新加载</Button>
        : <>
          <Button variant="outline" disabled={unavailable || phase === "playing"} onClick={() => { void demonstrate(); }}><Play/>看笔顺</Button>
          <Button variant="outline" disabled={phase !== "writing"} onClick={() => { void hint(); }}><Lightbulb/>提示这一笔</Button>
          <Button variant={phase === "ready" ? "default" : "outline"} disabled={unavailable} onClick={() => setRound((value) => value + 1)}><RotateCcw/>{phase === "ready" || phase === "playing" ? "开始练习" : "重新练习"}</Button>
          {phase === "complete" && <Button onClick={onNext}>练下一个字<ArrowRight/></Button>}
        </>}
    </div>
  </section>;
}

type CompletedWriting = { id: string; character: string; result: WritingResult };
export default function HanziWritingLab({ characters = practiceCharacters, journeyRunId, practiceTaskId, onSaved, embedded = false }: { characters?: readonly PracticeCharacter[]; journeyRunId?: string; practiceTaskId?: string; onSaved?: () => void; embedded?: boolean }) {
  const [character, setCharacter] = usePracticeSelection("/student/writing", "character", characters[0].character, !embedded);
  const selected = characters.find((item) => item.character === character) ?? characters[0];
  const setSelected = (item: PracticeCharacter) => setCharacter(item.character);
  const [completed, setCompleted] = useState<string[]>([]);
  const [history, setHistory] = useState<PracticeRecord[]>([]);
  const [pending, setPending] = useState<CompletedWriting | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<PracticeHistory>(`/api/v1/practice?kind=writing${journeyRunId ? `&journeyRunId=${journeyRunId}` : ""}${practiceTaskId ? `&practiceTaskId=${practiceTaskId}` : ""}`, { signal: controller.signal, cache: "no-store" }).then((data) => {
      if (!controller.signal.aborted && current === version.current) { setCompleted(data.writtenCharacters); setHistory(data.records); setReadError(""); }
    }).catch(() => { if (!controller.signal.aborted && current === version.current) setReadError("历史书写记录暂时没有读取成功，可以重新读取，也可以继续练习。"); });
    return () => controller.abort();
  }, [journeyRunId, practiceTaskId, reload]);
  const save = useCallback(async (entry: CompletedWriting) => {
    version.current++; setSaving(true); setError("");
    try {
      const data = await postJson<{ record: PracticeRecord }>("/api/v1/practice", { id: entry.id, kind: "writing", referenceId: entry.character, journeyRunId, practiceTaskId, ...entry.result });
      setCompleted((items) => items.includes(entry.character) ? items : [...items, entry.character]);
      setHistory((items) => [data.record, ...items.filter((item) => item.id !== data.record.id)].slice(0, 30));
      setPending((current) => current?.id === entry.id ? null : current); onSaved?.();
    } catch (reason) { setError(practiceError(reason)); }
    finally { setSaving(false); }
  }, [journeyRunId, practiceTaskId, onSaved]);
  const complete = useCallback((character: string, result: WritingResult) => {
    const entry = { id: crypto.randomUUID(), character, result }; setPending(entry); void save(entry);
  }, [save]);
  const next = () => setSelected(characters[(characters.indexOf(selected) + 1) % characters.length]);

  if (!characters.some((item) => item.character === character)) return <section className={styles.page}><PageHeader title="汉字书写实验室" description="指定的字不在当前可练习字库中。"/><Button onClick={() => setCharacter(characters[0].character)}>选择可练习的字</Button></section>;
  return <section className={styles.page}>
    {!embedded && <PageHeader title="汉字书写实验室" description="看清一笔一画，把汉字写进自己的记忆。"/>}
    {(error || readError) && <div role="alert"><p>{error || readError}</p>{pending ? <Button variant="outline" disabled={saving} onClick={() => void save(pending)}>重试保存“{pending.character}”的记录</Button> : <Button variant="outline" onClick={() => setReload((value) => value + 1)}>重新读取记录</Button>}</div>}
    {saving && <p role="status">正在保存本轮书写记录…</p>}
    <div className={styles.layout}>
      <aside className={styles.selection} aria-label="练习字表">
        <div className={styles.selectionHeading}><h2>今天，写好一个字</h2><p>选一个字，从描红开始。</p></div>
        <div className={styles.characters}>
          {characters.map((item) => <button key={item.character} type="button" disabled={saving || !!pending} aria-pressed={selected.character === item.character} aria-label={`${item.character}，${item.pinyin}${completed.includes(item.character) ? "，已有练习记录" : ""}`} onClick={() => setSelected(item)}>
            <span lang="zh-CN">{item.character}</span><small>{item.pinyin}</small>{completed.includes(item.character) && <Check aria-hidden="true"/>}
          </button>)}
        </div>
        <div className={styles.wordNote}>
          <p className={styles.pinyin}>{selected.pinyin}</p><h3>{selected.word}</h3><p>{selected.example}</p>
        </div>
        <p className={styles.sessionNote}>{completed.length ? `已有 ${characters.filter((item) => completed.includes(item.character)).length} 个字的保存记录，换一个继续吧。` : "鼠标或手指都可以写，按笔顺慢慢来。"}</p>
      </aside>
      <div inert={saving || !!pending}><WritingBoard item={selected} onComplete={complete} onNext={next}/></div>
    </div>
    {!embedded && history.length > 0 && <section className={styles.history} aria-label="书写练习记录"><h2>最近的书写练习</h2>{history.slice(0, 6).map((item) => <p key={item.id}><strong>{item.title}</strong> · {(item.result as WritingResult).mode === "trace" ? "描红" : "独立书写"} · 重试 {(item.result as WritingResult).mistakes} 次 · 主动提示 {(item.result as WritingResult).hints} 次 · 本轮 {Math.max(1, Math.round((item.result as WritingResult).elapsedMs / 1000))} 秒</p>)}</section>}
    <footer className={styles.footer}><p>练习结果保存到本人账号，刷新后可回看。逐笔反馈为练习记录，不作为课程成绩。</p><a href="/hanzi/NOTICE.txt" target="_blank" rel="noreferrer">笔顺数据来源与许可</a></footer>
  </section>;
}
