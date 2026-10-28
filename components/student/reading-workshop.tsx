import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, RefreshCw, Square, Trash2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/components/workspace/workspace-ui";
import { createReadingQuiz, readingLessons, readingTokens, type ReadingLesson, type ReadingTerm, type SavedReadingWord } from "@/lib/reading-lessons";
import { postJson, requestJson } from "@/lib/workspace/api";
import type { Notify } from "@/lib/platform-types";
import { practiceError, type PracticeHistory, type PracticeRecord, type ReadingResult } from "@/lib/practice-types";
import styles from "./reading-workshop.module.css";

function WordQuiz({ lesson, journeyRunId, onSaved }: { lesson: ReadingLesson; journeyRunId?: string; onSaved?: () => void }) {
  const [questions, setQuestions] = useState(() => createReadingQuiz(lesson));
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<PracticeRecord | null>(null);
  const changed = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); const version = changed.current;
    void requestJson<PracticeHistory>(`/api/v1/practice?kind=reading&referenceId=${encodeURIComponent(lesson.id)}${journeyRunId ? `&journeyRunId=${journeyRunId}` : ""}`, { signal: controller.signal, cache: "no-store" }).then((data) => {
      if (!controller.signal.aborted && version === changed.current) setLast(data.records[0] ?? null);
    }).catch(() => { if (!controller.signal.aborted && version === changed.current) setError("历史自测暂时没有读取成功，本轮仍可作答并保存。"); });
    return () => controller.abort();
  }, [lesson.id, journeyRunId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); changed.current++;
    try {
      const data = await postJson<{ record: PracticeRecord }>("/api/v1/practice", { id, kind: "reading", referenceId: lesson.id, journeyRunId, answers: questions.map((question, index) => ({ word: question.word, meaning: question.options[answers[index]] })) });
      setLast(data.record); setChecked(true); onSaved?.();
    } catch (reason) { setError(practiceError(reason)); }
    finally { setBusy(false); }
  }
  return <section className={styles.quiz} aria-label="词语小练习">
    <div className={styles.sectionHeading}><div><h2>读完，试试这三个词</h2><p>自测结果保存到本人账号，不计入课程成绩。</p></div><Button variant="ghost" disabled={busy} onClick={() => { setQuestions(createReadingQuiz(lesson)); setAnswers({}); setChecked(false); setId(crypto.randomUUID()); setError(""); }}><RefreshCw/>换一组</Button></div>
    <form onSubmit={submit}>
      {questions.map((question, index) => <fieldset key={`${index}:${question.word}`} disabled={checked || busy}><legend>{index + 1}. “{question.word}”在课文里是什么意思？</legend>
        {question.options.map((option, optionIndex) => <label key={option}><input type="radio" name={`reading-question-${index}`} required checked={answers[index] === optionIndex} onChange={() => { setAnswers({ ...answers, [index]: optionIndex }); setId(crypto.randomUUID()); }}/><span>{option}</span></label>)}
        {checked && <p className={answers[index] === question.correctOption ? styles.correct : styles.incorrect}>{answers[index] === question.correctOption ? "答对了。" : `再巩固一下：${question.options[question.correctOption]}`}</p>}
      </fieldset>)}
      {error && <p role="alert">{error}</p>}
      {checked && last ? <p role="status">本次答对 {(last.result as ReadingResult).correct} / {(last.result as ReadingResult).total} 题，记录已保存。</p> : <Button type="submit" disabled={busy}>{busy ? "正在保存…" : "检查答案"}</Button>}
      {!checked && last && <details><summary>最近一次自测：{(last.result as ReadingResult).correct} / {(last.result as ReadingResult).total} 题</summary>{(last.result as ReadingResult).answers.map((item) => <p key={item.word}>{item.word}：{item.correct ? "答对" : `本次选择“${item.selected}”`} · 释义：{item.meaning}</p>)}</details>}
    </form>
  </section>;
}

function ReadingSession({ lesson, vocabulary, busy, save, notify, journeyRunId, onSaved }: {
  lesson: ReadingLesson; vocabulary: SavedReadingWord[] | null; busy: boolean; save: (term: ReadingTerm) => void; notify: Notify; journeyRunId?: string; onSaved?: () => void;
}) {
  const [showPinyin, setShowPinyin] = useState(true);
  const [selected, setSelected] = useState<ReadingTerm | null>(null);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const speechId = useRef(0);
  const definitionTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const requestId = speechId;
    const currentSpeech = speech;
    setSpeaking(null);
    return () => { requestId.current++; if (currentSpeech.current) { window.speechSynthesis?.cancel(); currentSpeech.current = null; } };
  }, []);

  function readSentence(index: number) {
    if (!("speechSynthesis" in window)) return notify("无法朗读", "当前浏览器不支持设备语音，请换用支持中文朗读的浏览器。", "error");
    const request = ++speechId.current;
    window.speechSynthesis.cancel();
    if (speaking === index) { speech.current = null; setSpeaking(null); return; }
    const utterance = new SpeechSynthesisUtterance(lesson.sentences[index]);
    utterance.lang = "zh-CN"; utterance.rate = .8;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => /^zh[-_]CN$/i.test(item.lang)) ?? voices.find((item) => /^(zh([-_](SG|TW))?|cmn([-_]CN)?)$/i.test(item.lang));
    if (voices.length && !voice) { speech.current = null; setSpeaking(null); return notify("设备没有可用的普通话语音", "可以继续阅读和收藏词语，或换用提供普通话语音的设备进行朗读。", "error"); }
    if (voice) utterance.voice = voice;
    utterance.onend = () => { if (speechId.current === request) { setSpeaking(null); speech.current = null; } };
    utterance.onerror = () => {
      if (speechId.current !== request) return;
      setSpeaking(null); speech.current = null;
      notify("朗读未能完成", "请检查设备的中文语音和音频输出，再点击句子旁的朗读按钮。", "error");
    };
    speech.current = utterance; setSpeaking(index); window.speechSynthesis.speak(utterance);
  }

  const saved = selected && vocabulary?.some((item) => item.lessonId === lesson.id && item.word === selected.word);
  const definitionDetails = selected && <><p>{selected.meaning}</p><blockquote>{lesson.sentences.find((sentence) => sentence.includes(selected.word))}</blockquote><Button variant={saved ? "secondary" : "default"} disabled={busy || saved || vocabulary === null} onClick={() => save(selected)}>{saved ? <Check/> : <Bookmark/>}{saved ? "已加入生词本" : busy ? "正在保存…" : "加入生词本"}</Button></>;
  return <>
    <div className={styles.readingLayout}>
      <article className={styles.article}>
        <div className={styles.articleHeading}><div><h2>{lesson.title}</h2><p>{lesson.level} · 平台原创练习课文</p></div><label className={styles.pinyinToggle}><input type="checkbox" checked={showPinyin} onChange={(event) => setShowPinyin(event.target.checked)}/>显示拼音</label></div>
        <div className={styles.sentences} data-pinyin={showPinyin}>
          {lesson.sentences.map((sentence, index) => <div className={styles.sentence} key={sentence} data-speaking={speaking === index}>
            <p>{readingTokens(sentence, lesson).map((token, tokenIndex) => typeof token === "string" ? <span key={tokenIndex}>{token}</span> : <button key={tokenIndex} type="button" className={styles.word} data-selected={selected?.word === token.word} aria-label={`查看“${token.word}”的释义`} onClick={(event) => { setSelected(token); definitionTrigger.current = event.currentTarget; if (window.matchMedia("(max-width: 1050px)").matches) setDefinitionOpen(true); }}><ruby>{token.word}<rt>{showPinyin ? token.pinyin : ""}</rt></ruby></button>)}</p>
            <Button variant="ghost" size="icon" aria-label={speaking === index ? `停止朗读第 ${index + 1} 句` : `朗读第 ${index + 1} 句`} onClick={() => readSentence(index)}>{speaking === index ? <Square/> : <Volume2/>}</Button>
          </div>)}
        </div>
        <p className={styles.hint}>点词查看释义，点句子旁的按钮使用设备中文语音朗读。</p>
      </article>
      <aside className={styles.definition} aria-label="词语释义">
        <h2>读懂一个词</h2>
        {selected ? <div className={styles.definitionContent}><span>{selected.pinyin}</span><h3>{selected.word}</h3>{definitionDetails}</div> : <p className={styles.hint}>点一下课文里的词，读音、释义和例句会出现在这里。</p>}
      </aside>
    </div>
    <Sheet open={definitionOpen} onOpenChange={setDefinitionOpen}><SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); definitionTrigger.current?.focus(); }}><SheetHeader><SheetTitle>{selected?.word ?? "词语释义"}</SheetTitle><SheetDescription>{selected?.pinyin}</SheetDescription></SheetHeader><div className={`${styles.definitionContent} px-4 pb-6`}>{definitionDetails}</div></SheetContent></Sheet>
    <WordQuiz lesson={lesson} journeyRunId={journeyRunId} onSaved={onSaved}/>
  </>;
}

export default function ReadingWorkshop({ notify, fixedLesson, journeyRunId, onSaved, embedded = false }: { notify: Notify; fixedLesson?: ReadingLesson; journeyRunId?: string; onSaved?: () => void; embedded?: boolean }) {
  const [lessonId, setLessonId] = useState(readingLessons[0].id);
  const [vocabulary, setVocabulary] = useState<SavedReadingWord[] | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const lesson = fixedLesson ?? readingLessons.find((item) => item.id === lessonId)!;
  useEffect(() => {
    const controller = new AbortController(); const request = ++version.current;
    setError("");
    void requestJson<{ vocabulary: SavedReadingWord[] }>("/api/v1/reading/vocabulary", { signal: controller.signal, cache: "no-store" }).then((data) => {
      if (!controller.signal.aborted && request === version.current) setVocabulary(data.vocabulary);
    }).catch(() => { if (!controller.signal.aborted && request === version.current) setError("生词本暂时没有读取成功，课文仍可阅读。请重新读取后再收藏词语。"); });
    return () => controller.abort();
  }, [reload]);

  async function change(body: Record<string, unknown>, title: string) {
    setBusy(true); version.current++;
    try {
      const data = await postJson<{ vocabulary: SavedReadingWord[] }>("/api/v1/reading/vocabulary", body);
      version.current++; setVocabulary(data.vocabulary); setError("");
    } catch { notify(title, "操作结果尚未确认，请重试或重新读取生词本；重复收藏不会新增同一个词。", "error"); }
    finally { setBusy(false); }
  }

  return <section className={styles.page}>
    {!embedded && <PageHeader title="交互式阅读" description="从读懂一个词开始，慢慢读懂整个故事。"/>}
    {!fixedLesson && <div className={styles.toolbar}><label>选择课文<NativeSelect value={lessonId} onChange={(event) => setLessonId(event.target.value)}>{readingLessons.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.level}</option>)}</NativeSelect></label><a href="#reading-vocabulary">我的生词本{vocabulary ? `（${vocabulary.length}）` : ""}</a></div>}
    {error && <div className={styles.error} role="alert"><p>{error}</p><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}>重新读取生词本</Button></div>}
    <ReadingSession key={`${lesson.id}:${journeyRunId ?? ""}`} lesson={lesson} vocabulary={vocabulary} busy={busy} notify={notify} journeyRunId={journeyRunId} onSaved={onSaved} save={(term) => { void change({ action: "save", lessonId: lesson.id, word: term.word }, `收藏“${term.word}”失败`); }}/>
    {!embedded && <section id="reading-vocabulary" className={styles.vocabulary} aria-label="我的生词本">
      <div className={styles.sectionHeading}><div><h2>我的生词本</h2><p>保留课文里的读音、释义和例句，重新登录后也能回看。</p></div><Button variant="ghost" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button></div>
      {vocabulary === null ? <p className={styles.hint}>{error ? "生词本读取失败，可点击上方按钮重试。" : "正在读取生词本…"}</p> : vocabulary.length ? <ul>{vocabulary.map((item) => <li key={item.id}><div><strong>{item.word}</strong><span>{item.pinyin}</span><p>{item.meaning}</p><blockquote>{item.example}</blockquote><small>来自《{item.lessonTitle}》</small></div><Button variant="ghost" size="icon" disabled={busy} aria-label={`移除生词“${item.word}”`} onClick={() => { void change({ action: "remove", id: item.id }, `移除“${item.word}”失败`); }}><Trash2/></Button></li>)}</ul> : <p className={styles.hint}>还没有收藏的词。点课文中的词，把想复习的词收进来。</p>}
    </section>}
  </section>;
}
