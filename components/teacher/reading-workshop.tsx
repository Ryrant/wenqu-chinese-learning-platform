import { lazy, useEffect, useRef, useState } from "react";
import { Eye, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState, PageHeader, SectionHeading } from "@/components/workspace/workspace-ui";
import { missingReadingCharacters, readingLessons, suggestedReadingTerms, type ReadingLesson, type ReadingTerm } from "@/lib/reading-lessons";
import type { ReadingCatalog } from "@/lib/reading-content-service";
import { postJson, requestJson } from "@/lib/workspace/api";
import type { Notify } from "@/lib/platform-types";
import styles from "./reading-workshop.module.css";

const ReadingPreview = lazy(() => import("@/components/student/reading-workshop").then((module) => ({ default: module.ReadingPreview })));
type Draft = { id: string; revision: number; classId: string; title: string; level: string; text: string; glossary: string; focus: string };
const sentences = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const focusWords = (value: string) => value.split(/[,，、\n]+/).map((word) => word.trim()).filter(Boolean);
function glossary(value: string): ReadingTerm[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error(`词语标注第 ${index + 1} 行格式不完整，请按“词语 | 拼音 | 释义”填写。`);
    return { word: parts[0], pinyin: parts[1], meaning: parts[2] };
  });
}
const glossaryText = (terms: ReadingTerm[]) => terms.map((term) => `${term.word} | ${term.pinyin} | ${term.meaning}`).join("\n");
const emptyDraft = (classId: string): Draft => ({ id: crypto.randomUUID(), revision: 0, classId, title: "", level: "A2", text: "", glossary: "", focus: "" });
function fromLesson(lesson: ReadingLesson): Draft { return { id: lesson.id, revision: lesson.source!.revision, classId: lesson.source!.classId, title: lesson.title, level: lesson.level, text: lesson.sentences.join("\n"), glossary: glossaryText(lesson.terms), focus: lesson.focusWords.join("，") }; }
function message(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "reading_lesson_changed") return "课文已被更新。编辑内容仍保留，请先核对列表中的最新版本。";
  if (code === "invalid_reading_lesson_annotations") return "请补齐正文中的中文标注，并选择至少 4 个释义不同的重点词后再发布。";
  if (code.startsWith("invalid_reading_lesson")) return "请检查标题、正文和词语标注。每行一句，最多 20 句；标注词须出现在正文，重点词须在标注中。";
  if (code && !code.includes("_")) return code;
  return "本次保存结果尚未确认，请保留编辑内容并重试或重新读取。";
}

export default function TeacherReadingWorkshop({ notify }: { notify: Notify }) {
  const [catalog, setCatalog] = useState<ReadingCatalog | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<ReadingLesson | null>(null);
  const [templateId, setTemplateId] = useState(readingLessons[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const copies = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<ReadingCatalog>("/api/v1/reading/lessons?view=teacher", { cache: "no-store", signal: controller.signal }).then((data) => { if (!controller.signal.aborted && current === version.current) { setCatalog(data); setReadError(""); } }).catch(() => { if (!controller.signal.aborted && current === version.current) setReadError("班级课文暂时没有读取成功，编辑内容仍保留，请重试。"); });
    return () => controller.abort();
  }, [reload]);
  const current = catalog?.lessons.find((item) => item.id === draft?.id);
  const classId = draft?.classId ?? "";
  function change(patch: Partial<Draft>) { if (draft) { setDraft({ ...draft, ...patch }); setPreview(null); setError(""); } }
  function makeLesson(): ReadingLesson {
    if (!draft) throw new Error("请先新建或选择课文。");
    return { id: draft.id, title: draft.title || "未命名课文预览", level: draft.level, sentences: sentences(draft.text), terms: glossary(draft.glossary), focusWords: focusWords(draft.focus) };
  }
  function suggest() {
    if (!draft) return;
    try {
      const lines = sentences(draft.text); const prior = glossary(draft.glossary).filter((term) => lines.some((line) => line.includes(term.word)));
      const merged = new Map(prior.map((term) => [term.word, term]));
      for (const term of suggestedReadingTerms(lines)) if (!merged.has(term.word)) merged.set(term.word, term);
      const terms = [...merged.values()]; const meanings = new Set<string>();
      const suggestedFocus = [...terms.filter((term) => term.word.length > 1), ...terms.filter((term) => term.word.length === 1)].filter((term) => { if (meanings.has(term.meaning)) return false; meanings.add(term.meaning); return true; }).slice(0, 6).map((term) => term.word);
      change({ glossary: glossaryText(terms), focus: draft.focus ? focusWords(draft.focus).filter((word) => merged.has(word)).join("，") : suggestedFocus.join("，") }); setError("");
    } catch (reason) { setError(message(reason)); }
  }
  async function perform(action: "draft" | "publish" | "archive") {
    if (!draft) return;
    let data: ReadingLesson | null = null;
    try { if (action !== "archive") data = makeLesson(); } catch (reason) { setError(message(reason)); return; }
    const copy = action === "draft" && current?.source?.status === "published";
    const id = copy ? copies.current.get(draft.id) ?? crypto.randomUUID() : draft.id;
    if (copy) copies.current.set(draft.id, id);
    const operation = ++version.current; setBusy(true); setError("");
    try {
      const response = await postJson<ReadingCatalog>("/api/v1/reading/lessons", { action, id, revision: copy ? 0 : draft.revision, classId, title: draft.title, level: draft.level, ...(data ? { sentences: data.sentences, terms: data.terms, focusWords: data.focusWords } : {}) });
      if (operation === version.current) { version.current++; setCatalog(response); }
      else setReload((value) => value + 1);
      const saved = response.lessons.find((item) => item.id === id); if (saved) setDraft((editing) => editing?.id === draft.id ? fromLesson(saved) : editing);
      if (copy) copies.current.delete(draft.id);
      notify(action === "publish" ? "课文已发布" : action === "archive" ? "课文已归档" : "课文草稿已保存", action === "publish" ? "班内学生现在可在交互阅读中选择这篇课文。" : "本次内容已保存。");
    } catch (reason) { setError(message(reason)); setReload((value) => value + 1); }
    finally { setBusy(false); }
  }
  return <section className={styles.page}>
    <PageHeader title="教师课文工作台" description="把自己编写或已获授权的课文，变成可点词、可朗读、可自测的班级阅读。"/>
    <div className={styles.toolbar}><Button disabled={busy || !catalog?.classes.length} onClick={() => { setDraft(emptyDraft(catalog?.classes[0]?.id ?? "")); setPreview(null); setError(""); }}><Plus/>新建课文</Button><label>示例课文<NativeSelect value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>{readingLessons.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</NativeSelect></label><Button variant="outline" disabled={busy || !catalog?.classes.length} onClick={() => { const lesson = readingLessons.find((item) => item.id === templateId)!; setDraft({ ...emptyDraft(catalog?.classes[0]?.id ?? ""), title: `${lesson.title}（班级版）`, level: lesson.level, text: lesson.sentences.join("\n"), glossary: glossaryText(lesson.terms), focus: lesson.focusWords.join("，") }); setPreview(null); setError(""); }}>以示例新建</Button><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button></div>
    {(error || readError) && <p className={styles.error} role="alert">{error || readError}</p>}
    {!catalog ? <p role="status">正在读取班级与课文…</p> : !catalog.classes.length ? <EmptyState title="先创建一个教学班" description="课文按班级发布，请先在班级管理中创建班级。"/> : <div className={styles.layout}>
      <aside className={styles.library}><h2>班级课文</h2>{catalog.lessons.length ? catalog.lessons.map((item) => <button type="button" key={item.id} disabled={busy} aria-pressed={draft?.id === item.id} onClick={() => { setDraft(fromLesson(item)); setPreview(null); setError(""); }}><strong>{item.title}</strong><small>{item.source!.className} · {item.source!.status === "published" ? "已发布" : item.source!.status === "archived" ? "已归档" : "草稿"} · 版本 {item.source!.revision}</small></button>) : <p>从空白或平台原创示例开始，保存后会出现在这里。</p>}</aside>
      {!draft ? <EmptyState title="准备一篇班级课文" description="新建正文，核对拼音与释义，再预览并发布给学生。"/> : <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void perform("publish"); }}>
        <SectionHeading title={draft.revision ? "编辑课文" : "新建班级课文"} description={current ? "新版本用于后续练习，已开始的主题轮次保留原课文快照。" : "每行填写一句正文，辅助标注后仍需核对词义与读音。"}/>
        {current && current.source!.revision !== draft.revision && <p className={styles.error} role="status">目录已有其他版本，当前编辑仍保留。核对后可从左侧重新打开最新课文。</p>}
        <fieldset disabled={busy} className={styles.fields}>
          <div className={styles.pair}><label>课文标题<Input required maxLength={100} value={draft.title} onChange={(event) => change({ title: event.target.value })}/></label><label>发布班级<NativeSelect required disabled={draft.revision > 0} value={classId} onChange={(event) => change({ classId: event.target.value })}>{catalog.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label></div>
          <label>学习水平<Input required maxLength={20} value={draft.level} onChange={(event) => change({ level: event.target.value })}/></label>
          <label>课文正文，每行一句<Textarea required rows={7} maxLength={6000} value={draft.text} onChange={(event) => change({ text: event.target.value })}/><small>最多 20 句，每句 300 字；请使用自己编写或已获授权的内容。</small></label>
          <Button variant="outline" type="button" onClick={suggest}>辅助补全已有词语标注</Button>
          <label>词语标注，每行：词语 | 拼音 | 释义<Textarea rows={10} maxLength={60000} value={draft.glossary} onChange={(event) => change({ glossary: event.target.value })}/><small>辅助补全会保留仍在正文中使用的已有标注。新词请自行补充并核对；未标注的中文会在预览时列出。</small></label>
          <label>重点词语，用逗号分隔<Input maxLength={400} value={draft.focus} onChange={(event) => change({ focus: event.target.value })}/><small>发布需要 4–12 个重点词，且释义不同，用于生成词义自测。</small></label>
          <div className={styles.actions}><Button variant="outline" type="button" onClick={() => { try { setPreview(makeLesson()); setError(""); } catch (reason) { setError(message(reason)); } }}><Eye/>预览课文</Button><Button variant="outline" type="button" onClick={() => void perform("draft")}>{current?.source?.status === "published" ? "另存为新草稿" : "保存草稿"}</Button><Button type="submit">{busy ? "正在保存…" : "发布课文"}</Button>{current && current.source?.status !== "archived" && <Button variant="ghost" type="button" onClick={() => void perform("archive")}>归档课文</Button>}</div>
        </fieldset>
      </form>}
    </div>}
    {preview && <section className={styles.preview} aria-label="课文预览"><SectionHeading title="学生阅读预览" description="检查拼音、点词释义与句子朗读；预览不写入学生记录。"/>{missingReadingCharacters(preview).length ? <p className={styles.error}>尚需补充这些字词的标注：{missingReadingCharacters(preview).join("、")}</p> : <p className={styles.note}>正文中的中文已有标注，请再核对多音字和本篇词义。</p>}<ReadingPreview key={JSON.stringify(preview)} lesson={preview} notify={notify}/></section>}
  </section>;
}
