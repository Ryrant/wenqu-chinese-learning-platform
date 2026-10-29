import { lazy, useCallback, useEffect, useRef, useState } from "react";
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
import { readingDraftMatchesLesson, readingDraftTextLimit, readLocalReadingDrafts, removeConfirmedReadingDraft, saveLocalReadingDraft, type ReadingDraft as Draft, type StoredReadingDraft } from "@/lib/reading-draft";
import { sequenceTime } from "@/lib/learning-sequence-types";
import styles from "./reading-workshop.module.css";

const ReadingPreview = lazy(() => import("@/components/student/reading-workshop").then((module) => ({ default: module.ReadingPreview })));
const sentences = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const focusWords = (value: string) => value.split(/[,，、\n]+/).map((word) => word.trim()).filter(Boolean);
function glossary(terms: Draft["terms"]): ReadingTerm[] {
  return terms.map((term, index) => {
    const word = term.word.trim(); const pinyin = term.pinyin.trim(); const meaning = term.meaning.trim();
    if (!word || !pinyin || !meaning) throw new Error(`词语标注第 ${index + 1} 项尚不完整，请填写词语、拼音和释义，或移除该项。`);
    return { word, pinyin, meaning };
  });
}
const draftTerms = (terms: ReadingTerm[]) => terms.map((term) => ({ ...term, id: crypto.randomUUID() }));
const emptyDraft = (classId: string): Draft => ({ id: crypto.randomUUID(), revision: 0, classId, title: "", level: "A2", text: "", terms: [], focus: "" });
function fromLesson(lesson: ReadingLesson): Draft { return { id: lesson.id, revision: lesson.source!.revision, classId: lesson.source!.classId, title: lesson.title, level: lesson.level, text: lesson.sentences.join("\n"), terms: draftTerms(lesson.terms), focus: lesson.focusWords.join("，") }; }
function message(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  if (code === "reading_lesson_changed") return "课文已被更新。编辑内容仍保留，请先核对列表中的最新版本。";
  if (code === "invalid_reading_lesson_annotations") return "请补齐正文中的中文标注，并选择至少 4 个释义不同的重点词后再发布。";
  if (code.startsWith("invalid_reading_lesson")) return "请检查标题、正文和词语标注。每行一句，最多 20 句；标注词须出现在正文，重点词须在标注中。";
  if (code && !code.includes("_")) return code;
  return "本次保存结果尚未确认，请保留编辑内容并重试或重新读取。";
}

export default function TeacherReadingWorkshop({ notify, tenantId, userId }: { notify: Notify; tenantId: string; userId: string }) {
  const [catalog, setCatalog] = useState<ReadingCatalog | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<ReadingLesson | null>(null);
  const [templateId, setTemplateId] = useState(readingLessons[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [localDrafts, setLocalDrafts] = useState<StoredReadingDraft[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [storageError, setStorageError] = useState("");
  const liveDraft = useRef<Draft | null>(null);
  const liveDirty = useRef(false);
  const visible = useRef(true);
  const storageFailure = useRef(false);
  const version = useRef(0);
  const copies = useRef(new Map<string, string>());
  const readDeviceDrafts = useCallback(() => {
    try {
      const data = readLocalReadingDrafts(window.localStorage, { tenantId, userId });
      setLocalDrafts(data.drafts); setUnreadable(data.unreadable.length); setStorageError("");
    } catch (reason) {
      console.warn("reading_draft_read_failed", { reason: reason instanceof Error ? reason.name : "storage_error" });
      setStorageError("此设备的草稿暂时无法读取；页面中的编辑仍保留，可手动保存到服务器。");
    }
  }, [tenantId, userId]);
  const persistDevice = useCallback((editing: Draft) => {
    try {
      const saved = saveLocalReadingDraft(window.localStorage, { tenantId, userId }, editing);
      setLocalDrafts((current) => [saved, ...current.filter((item) => item.draft.id !== editing.id)]); setStorageError(""); storageFailure.current = false;
      return true;
    } catch (reason) {
      if (!storageFailure.current) console.warn("reading_draft_write_failed", { lessonId: editing.id, reason: reason instanceof Error ? reason.name : "storage_error" });
      storageFailure.current = true;
      setStorageError("未能保存到此设备，当前编辑仍在页面中。请手动保存到服务器后再切换课文，也可重试本机保存。");
      return false;
    }
  }, [tenantId, userId]);
  useEffect(() => {
    visible.current = true; readDeviceDrafts();
    const flush = () => { if (liveDirty.current && liveDraft.current) persistDevice(liveDraft.current); };
    window.addEventListener("pagehide", flush);
    return () => { visible.current = false; window.removeEventListener("pagehide", flush); flush(); };
  }, [readDeviceDrafts, persistDevice]);
  useEffect(() => {
    if (!draft || !dirty) return;
    const timer = setTimeout(() => { if (liveDirty.current && liveDraft.current === draft) persistDevice(draft); }, 400);
    return () => clearTimeout(timer);
  }, [draft, dirty, persistDevice]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<ReadingCatalog>("/api/v1/reading/lessons?view=teacher", { cache: "no-store", signal: controller.signal }).then((data) => { if (!controller.signal.aborted && current === version.current) { setCatalog(data); setReadError(""); } }).catch(() => { if (!controller.signal.aborted && current === version.current) setReadError("班级课文暂时没有读取成功，编辑内容仍保留，请重试。"); });
    return () => controller.abort();
  }, [reload]);
  const current = catalog?.lessons.find((item) => item.id === draft?.id);
  const classId = draft?.classId ?? "";
  const conflict = !!draft && !!catalog && (current ? current.source!.revision !== draft.revision || current.source!.status === "archived" : draft.revision > 0);
  const canConfirm = !!draft && conflict && current?.source?.status !== "archived" && readingDraftMatchesLesson(draft, current);
  const filtered = catalog?.lessons.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (!filterClass || item.source?.classId === filterClass) && (!filterStatus || item.source?.status === filterStatus)) ?? [];
  const savedOnDevice = draft && localDrafts.find((item) => item.draft.id === draft.id && JSON.stringify(item.draft) === JSON.stringify(draft));
  function applyDraft(next: Draft, changed: boolean) {
    liveDraft.current = next; liveDirty.current = changed; setDraft(next); setDirty(changed); setPreview(null); setError("");
  }
  function openDraft(next: Draft, changed = false) {
    if (liveDirty.current && liveDraft.current && !persistDevice(liveDraft.current)) return;
    applyDraft(next, changed);
  }
  function change(patch: Partial<Draft>) { if (draft) applyDraft({ ...draft, ...patch }, true); }
  function changeTerm(id: string, patch: Partial<ReadingTerm>) {
    if (!draft) return;
    const previous = draft.terms.find((term) => term.id === id);
    change({ terms: draft.terms.map((term) => term.id === id ? { ...term, ...patch } : term), ...(patch.word !== undefined && previous?.word.trim() ? { focus: focusWords(draft.focus).map((word) => word === previous.word.trim() ? patch.word!.trim() : word).filter(Boolean).join("，") } : {}) });
  }
  function makeLesson(editing = draft): ReadingLesson {
    if (!editing) throw new Error("请先新建或选择课文。");
    return { id: editing.id, title: editing.title || "未命名课文预览", level: editing.level, sentences: sentences(editing.text), terms: glossary(editing.terms), focusWords: focusWords(editing.focus) };
  }
  function suggest() {
    if (!draft) return;
    try {
      const lines = sentences(draft.text); const prior = glossary(draft.terms).filter((term) => lines.some((line) => line.includes(term.word)));
      const merged = new Map(prior.map((term) => [term.word, term]));
      for (const term of suggestedReadingTerms(lines)) if (!merged.has(term.word)) merged.set(term.word, term);
      const terms = [...merged.values()]; const meanings = new Set<string>();
      const suggestedFocus = [...terms.filter((term) => term.word.length > 1), ...terms.filter((term) => term.word.length === 1)].filter((term) => { if (meanings.has(term.meaning)) return false; meanings.add(term.meaning); return true; }).slice(0, 6).map((term) => term.word);
      change({ terms: terms.map((term) => ({ ...term, id: draft.terms.find((item) => item.word.trim() === term.word)?.id ?? crypto.randomUUID() })), focus: draft.focus ? focusWords(draft.focus).filter((word) => merged.has(word)).join("，") : suggestedFocus.join("，") }); setError("");
    } catch (reason) { setError(message(reason)); }
  }
  async function perform(action: "draft" | "publish" | "archive") {
    if (!draft) return;
    const origin = draft; const wasDirty = liveDirty.current;
    if (action === "publish" && conflict && !canConfirm) { setError("服务器版本已有变化，请先核对服务器版本，或将当前内容另存为新草稿。"); return; }
    if (action === "archive" && wasDirty && !persistDevice(origin)) return;
    let data: ReadingLesson | null = null;
    try { if (action !== "archive") data = makeLesson(origin); } catch (reason) { setError(message(reason)); return; }
    const copy = action === "draft" && (current?.source?.status === "published" || conflict) && !canConfirm;
    const copyKey = JSON.stringify({ ...origin, terms: data?.terms });
    const id = copy ? copies.current.get(copyKey) ?? crypto.randomUUID() : origin.id;
    if (copy) copies.current.set(copyKey, id);
    const operation = ++version.current; setBusy(true); setError("");
    try {
      const response = await postJson<ReadingCatalog>("/api/v1/reading/lessons", { action, id, revision: copy ? 0 : origin.revision, classId: origin.classId, title: origin.title, level: origin.level, ...(data ? { sentences: data.sentences, terms: data.terms, focusWords: data.focusWords } : {}) });
      if (operation === version.current) { version.current++; setCatalog(response); }
      else setReload((value) => value + 1);
      const saved = response.lessons.find((item) => item.id === id); if (!saved) throw new Error("reading_save_unconfirmed");
      if (action !== "archive") {
        try { removeConfirmedReadingDraft(window.localStorage, { tenantId, userId }, origin); readDeviceDrafts(); }
        catch (reason) { console.warn("reading_draft_cleanup_failed", { lessonId: origin.id, reason: reason instanceof Error ? reason.name : "storage_error" }); setStorageError("内容已保存到服务器，但此设备的旧草稿未能清理；恢复时请核对服务器版本。"); }
      }
      if (liveDraft.current?.id === origin.id && JSON.stringify(liveDraft.current) === JSON.stringify(origin) && (action !== "archive" || !wasDirty)) applyDraft(fromLesson(saved), false);
      if (copy) copies.current.delete(copyKey);
      if (visible.current) notify(action === "publish" ? "课文已发布" : action === "archive" ? "课文已归档" : "课文草稿已保存到服务器", action === "publish" ? "班内学生现在可在交互阅读中选择这篇课文。" : action === "archive" && wasDirty ? "归档完成，未提交的编辑仍保留在此设备。" : "本次内容已保存到服务器。");
    } catch (reason) { setError(message(reason)); setReload((value) => value + 1); }
    finally { setBusy(false); }
  }
  return <section className={styles.page}>
    <PageHeader title="教师课文工作台" description="把自己编写或已获授权的课文，变成可点词、可朗读、可自测的班级阅读。"/>
    <div className={styles.toolbar}><Button disabled={busy || !catalog?.classes.length} onClick={() => openDraft(emptyDraft(catalog?.classes[0]?.id ?? ""))}><Plus/>新建课文</Button><label>示例课文<NativeSelect value={templateId} disabled={busy} onChange={(event) => setTemplateId(event.target.value)}>{readingLessons.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</NativeSelect></label><Button variant="outline" disabled={busy || !catalog?.classes.length} onClick={() => { const lesson = readingLessons.find((item) => item.id === templateId)!; openDraft({ ...emptyDraft(catalog?.classes[0]?.id ?? ""), title: `${lesson.title}（班级版）`, level: lesson.level, text: lesson.sentences.join("\n"), terms: draftTerms(lesson.terms), focus: lesson.focusWords.join("，") }, true); }}>以示例新建</Button><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button></div>
    {(error || readError) && <p className={styles.error} role="alert">{error || readError}</p>}
    {storageError && <div className={styles.error} role="alert"><p>{storageError}</p>{draft && dirty && <Button variant="outline" disabled={busy} onClick={() => persistDevice(draft)}>重试保存到此设备</Button>}</div>}
    {(localDrafts.length > 0 || unreadable > 0) && <details className={styles.recovery}><summary>恢复此设备草稿（{localDrafts.length}）</summary><p className={styles.note}>仅保存在当前浏览器与设备，尚未提交到服务器；切换账号或机构后分别管理。</p>{unreadable > 0 && <p className={styles.error}>有 {unreadable} 份本机草稿格式无法识别，原始内容未删除。</p>}{localDrafts.map((item) => <div key={item.draft.id}><strong>{item.draft.title || "未命名课文"}</strong><small>{catalog?.classes.find((entry) => entry.id === item.draft.classId)?.name ?? "原班级待读取"} · 保存于 {sequenceTime(item.savedAt)} · {item.baseRevision ? "基于服务器版本 " + item.baseRevision : "尚未确认保存到服务器"}</small><Button variant="outline" disabled={busy || (dirty && draft?.id === item.draft.id)} onClick={() => openDraft(structuredClone(item.draft), true)}>恢复这份本机草稿</Button></div>)}</details>}
    {!catalog && (readError ? <EmptyState title="班级课文暂未载入" description="请点击重新读取，当前编辑内容仍保留。"/> : <p role="status">正在读取班级与课文…</p>)}
    {catalog && !catalog.classes.length && <EmptyState title="先创建一个教学班" description="课文按班级发布，请先在班级管理中创建班级。"/>}
    {(!!catalog?.classes.length || draft) && <div className={styles.layout}>
      <aside className={styles.library}><h2>班级课文</h2><label>搜索课文标题<Input type="search" value={search} onChange={(event) => setSearch(event.target.value)}/></label><label>筛选班级<NativeSelect value={filterClass} onChange={(event) => setFilterClass(event.target.value)}><option value="">全部任教班级</option>{catalog?.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label><label>发布状态<NativeSelect value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></NativeSelect></label><p className={styles.note}>显示 {filtered.length}/{catalog?.lessons.length ?? 0} 篇；筛选保留当前编辑。</p><div className={styles.lessonList}>{filtered.map((item) => <button className={styles.lessonButton} type="button" key={item.id} disabled={busy} aria-pressed={draft?.id === item.id} onClick={() => openDraft(fromLesson(item))}><strong>{item.title}</strong><small>{item.source!.className} · {item.source!.status === "published" ? "已发布" : item.source!.status === "archived" ? "已归档" : "草稿"} · 版本 {item.source!.revision}</small></button>)}</div>{!filtered.length && <p className={styles.note}>{catalog?.lessons.length ? "没有匹配的课文，可调整标题、班级或发布状态筛选。" : "从空白或平台原创示例开始，保存后会出现在这里。"}</p>}</aside>
      {!draft ? <EmptyState title="准备一篇班级课文" description="新建正文，核对拼音与释义，再预览并发布给学生。"/> : <form className={styles.editor} onSubmit={(event) => { event.preventDefault(); void perform("publish"); }}>
        <SectionHeading title={draft.revision ? "编辑课文" : "新建班级课文"} description={current ? "新版本用于后续练习，已开始的主题轮次保留原课文快照。" : "每行填写一句正文，辅助标注后仍需核对词义与读音。"}/>
        {conflict && <div className={styles.conflict} role="status"><p>{draft.revision ? "本机编辑基于服务器版本 " + draft.revision + "；" : "本机草稿尚未确认保存；"}{current ? "服务器当前为版本 " + current.source!.revision + (current.source!.status === "archived" ? "，且课文已归档。" : "。") : "原课文已不在当前可读取范围。"}当前内容已保留，请核对服务器版本或另存为新草稿。{canConfirm ? "服务器已保存相同内容，可确认保存结果。" : ""}</p>{current && <div className={styles.actions}><Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(current)}>查看服务器版本</Button><Button type="button" variant="outline" disabled={busy} onClick={() => openDraft(fromLesson(current))}>以服务器版本重新编辑</Button></div>}</div>}
        <p className={styles.note} role="status">{busy ? "正在保存到服务器…" : dirty ? storageError ? "当前修改尚未保存到服务器；此设备保存也未成功，请保留页面。" : savedOnDevice ? "已保存到此设备 · " + sequenceTime(savedOnDevice.savedAt) + "；当前修改尚未保存到服务器。" : "正在保存到此设备…当前修改尚未保存到服务器。" : draft.revision ? "已保存到服务器 · 版本 " + draft.revision + (current?.source?.status === "archived" ? " · 已归档。" : "。") : "尚未保存到服务器；编辑后会自动保存到此设备。"}</p>
        <fieldset disabled={busy} className={styles.fields}>
          <div className={styles.pair}><label>课文标题<Input required maxLength={100} value={draft.title} onChange={(event) => change({ title: event.target.value })}/></label><label>发布班级<NativeSelect required disabled={draft.revision > 0} value={classId} onChange={(event) => change({ classId: event.target.value })}>{!catalog?.classes.some((item) => item.id === classId) && <option value={classId} disabled>原班级暂不可用</option>}{catalog?.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label></div>
          <label>学习水平<Input required maxLength={20} value={draft.level} onChange={(event) => change({ level: event.target.value })}/></label>
          <label>课文正文，每行一句<Textarea required rows={7} maxLength={readingDraftTextLimit} value={draft.text} onChange={(event) => change({ text: event.target.value })}/><small>最多 20 句，每句 300 字；请使用自己编写或已获授权的内容。</small></label>
          <Button variant="outline" type="button" onClick={suggest}>辅助补全已有词语标注</Button>
          <section className={styles.annotations} aria-label="词语标注列表"><h3>词语、拼音与释义</h3><p className={styles.note}>逐项核对本篇读音和词义。辅助补全保留正文中仍使用的已有标注，未覆盖的中文会在预览时列出。</p><div className={styles.termList}>{draft.terms.map((term, index) => <fieldset key={term.id} className={styles.termRow}><legend>词语标注第 {index + 1} 项{focusWords(draft.focus).includes(term.word.trim()) ? " · 重点词" : ""}</legend><div className={styles.pair}><label>词语<Input aria-label={`第 ${index + 1} 项词语`} maxLength={30} value={term.word} onChange={(event) => changeTerm(term.id, { word: event.target.value })}/></label><label>拼音<Input aria-label={`第 ${index + 1} 项拼音`} maxLength={120} value={term.pinyin} onChange={(event) => changeTerm(term.id, { pinyin: event.target.value })}/></label></div><label>释义<Textarea aria-label={`第 ${index + 1} 项释义`} rows={2} maxLength={500} value={term.meaning} onChange={(event) => changeTerm(term.id, { meaning: event.target.value })}/></label><Button type="button" variant="ghost" aria-label={`移除词语标注第 ${index + 1} 项`} onClick={() => change({ terms: draft.terms.filter((item) => item.id !== term.id), focus: focusWords(draft.focus).filter((word) => word !== term.word.trim()).join("，") })}>移除此项</Button></fieldset>)}</div><Button type="button" variant="outline" disabled={draft.terms.length >= 300} onClick={() => change({ terms: [...draft.terms, { id: crypto.randomUUID(), word: "", pinyin: "", meaning: "" }] })}>新增词语标注</Button></section>
          <label>重点词语，用逗号分隔<Input maxLength={400} value={draft.focus} onChange={(event) => change({ focus: event.target.value })}/><small>发布需要 4–12 个重点词，且释义不同，用于生成词义自测。</small></label>
          <div className={styles.actions}><Button variant="outline" type="button" onClick={() => { try { setPreview(makeLesson()); setError(""); } catch (reason) { setError(message(reason)); } }}><Eye/>预览课文</Button><Button variant="outline" type="button" disabled={!catalog?.classes.some((item) => item.id === classId)} onClick={() => void perform(canConfirm && current?.source?.status === "published" ? "publish" : "draft")}>{canConfirm ? "确认服务器保存结果" : current?.source?.status === "published" || conflict ? "另存为新草稿" : "保存草稿到服务器"}</Button><Button type="submit" disabled={conflict || !catalog?.classes.some((item) => item.id === classId)}>{busy ? "正在保存…" : "发布课文"}</Button>{current && current.source?.status !== "archived" && <Button variant="ghost" type="button" onClick={() => void perform("archive")}>归档课文</Button>}</div>
        </fieldset>
      </form>}
    </div>}
    {preview && <section className={styles.preview} aria-label="课文预览"><SectionHeading title="学生阅读预览" description="检查拼音、点词释义与句子朗读；预览不写入学生记录。"/>{missingReadingCharacters(preview).length ? <p className={styles.error}>尚需补充这些字词的标注：{missingReadingCharacters(preview).join("、")}</p> : <p className={styles.note}>正文中的中文已有标注，请再核对多音字和本篇词义。</p>}<ReadingPreview key={JSON.stringify(preview)} lesson={preview} notify={notify}/></section>}
  </section>;
}
