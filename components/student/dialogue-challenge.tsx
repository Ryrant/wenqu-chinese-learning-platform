import { useEffect, useRef, useState } from "react";
import { Lightbulb, Plus, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/workspace/workspace-ui";
import { DialogueGoals, DialogueTranscript } from "@/components/learning/dialogue-transcript";
import { dialogueErrorMessage, type DialogueCatalog, type PublicDialogueScenario } from "@/lib/dialogue-types";
import { postJson, requestJson } from "@/lib/workspace/api";
import type { Notify } from "@/lib/platform-types";
import styles from "./dialogue-challenge.module.css";

export default function DialogueChallenge({ notify, fixedSessionId, onProgress, embedded = false }: { notify: Notify; fixedSessionId?: string; onProgress?: () => void; embedded?: boolean }) {
  const [catalog, setCatalog] = useState<DialogueCatalog | null>(null);
  const [scenarioId, setScenarioId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const version = useRef(0);
  const requests = useRef(new Map<string, { id: string; text: string }>());
  const starts = useRef(new Map<string, string>());
  const hints = useRef(new Map<string, string>());

  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    void requestJson<DialogueCatalog>(`/api/v1/dialogue${fixedSessionId ? `?sessionId=${fixedSessionId}` : ""}`, { signal: controller.signal, cache: "no-store" }).then((data) => {
      if (controller.signal.aborted || current !== version.current) return;
      setCatalog(data); setError("");
      const acknowledged = data.sessions.flatMap((session) => {
        const request = requests.current.get(session.id);
        return request && session.turns.some((turn) => turn.id === request.id && turn.kind === "student" && turn.text === request.text) ? [{ sessionId: session.id, text: request.text }] : [];
      });
      for (const item of acknowledged) requests.current.delete(item.sessionId);
      for (const [id, sessionId] of starts.current) if (data.sessions.some((session) => session.id === sessionId)) starts.current.delete(id);
      setDrafts((previous) => {
        const next = { ...previous };
        for (const item of acknowledged) if (next[item.sessionId]?.trim() === item.text) delete next[item.sessionId];
        return next;
      });
    }).catch(() => { if (!controller.signal.aborted && current === version.current) setError("情境与对话记录暂时没有读取成功，请重试。当前输入仍保留。"); });
    return () => controller.abort();
  }, [reload, fixedSessionId]);

  const choices = [...new Map([...(catalog?.scenarios ?? []), ...(catalog?.sessions.map((session) => session.scenario).filter((scenario) => !catalog.scenarios.some((current) => current.id === scenario.id)) ?? [])].map((scenario) => [scenario.id, scenario as PublicDialogueScenario])).values()];
  const fixedSession = fixedSessionId ? catalog?.sessions.find((item) => item.id === fixedSessionId) : undefined;
  const scenario = fixedSession?.scenario ?? choices.find((item) => item.id === scenarioId) ?? choices[0];
  const sessions = catalog?.sessions.filter((item) => item.scenario.id === scenario?.id) ?? [];
  const session = fixedSessionId ? fixedSession : sessions.find((item) => item.id === sessionId) ?? sessions[0];
  const available = catalog?.scenarios.some((item) => item.id === scenario?.id) ?? false;
  const answer = session ? drafts[session.id] ?? "" : "";
  useEffect(() => {
    if (!session?.pending) return;
    const timer = setTimeout(() => setReload((value) => value + 1), 2000);
    return () => clearTimeout(timer);
  }, [session?.id, session?.pending, reload]);

  async function perform(body: Record<string, unknown>) {
    version.current++; setBusy(true); setError("");
    try {
      const data = await postJson<DialogueCatalog>("/api/v1/dialogue", body);
      version.current++; setCatalog(data);
      onProgress?.();
      if (body.action === "start") { setSessionId(String(body.id)); if (scenario) starts.current.delete(scenario.id); }
      if (body.action === "send") {
        requests.current.delete(String(body.sessionId));
        setDrafts((items) => { if (items[String(body.sessionId)]?.trim() !== body.text) return items; const next = { ...items }; delete next[String(body.sessionId)]; return next; });
      }
    } catch (reason) { setError(dialogueErrorMessage(reason)); notify("本次操作尚未确认", dialogueErrorMessage(reason), "error"); setReload((value) => value + 1); }
    finally { setBusy(false); }
  }

  function start() {
    if (!scenario) return;
    const id = starts.current.get(scenario.id) ?? crypto.randomUUID(); starts.current.set(scenario.id, id);
    void perform({ action: "start", id, scenarioId: scenario.id });
  }
  function send(event: React.FormEvent) {
    event.preventDefault(); if (!session || !answer.trim()) return;
    const text = answer.trim(); const previous = requests.current.get(session.id);
    const request = previous?.text === text ? previous : { id: crypto.randomUUID(), text };
    requests.current.set(session.id, request);
    void perform({ action: "send", sessionId: session.id, requestId: request.id, revision: session.revision, text });
  }
  function hint() {
    if (!session) return;
    const key = `${session.id}:${session.revision}`; const id = hints.current.get(key) ?? crypto.randomUUID(); hints.current.set(key, id);
    void perform({ action: "hint", sessionId: session.id, requestId: id, revision: session.revision });
  }

  return <section className={styles.page}>
    {!embedded && <PageHeader title="情境对话闯关" description="把中文用在真实情境的练习中，一次说清一件事。"/>}
    <div className={styles.toolbar}>{!fixedSessionId && <label>选择情境<NativeSelect disabled={busy || !choices.length} value={scenario?.id ?? ""} onChange={(event) => { setScenarioId(event.target.value); setSessionId(""); }}>{!choices.length && <option value="">暂无可用情境</option>}{choices.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.className}{catalog?.scenarios.some((current) => current.id === item.id) ? "" : "（历史记录）"}</option>)}</NativeSelect></label>}<div><Button variant="outline" disabled={busy} onClick={() => setReload((value) => value + 1)}><RefreshCw/>重新读取</Button>{!fixedSessionId && <Button disabled={busy || !available} onClick={start}><Plus/>{session ? "开始新一轮" : "开始练习"}</Button>}</div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!catalog ? <p role="status">正在读取情境…</p> : !scenario ? <EmptyState title="等待老师发布情境" description="老师按班级发布后，就可以在这里进行对话练习。"/> : <>
      <div className={styles.layout}>
        <aside className={styles.context}><h2>{session?.scenario.title ?? scenario.title}</h2><p>{session?.scenario.brief ?? scenario.brief}</p><small>角色：{session?.scenario.roleName ?? scenario.roleName} · 发布教师：{session?.scenario.authorName ?? scenario.authorName}</small>
          {session ? <DialogueGoals session={session}/> : <ol>{scenario.goals.map((goal, index) => <li key={index}>{index + 1}. {goal.title}</li>)}</ol>}
          <p className={styles.note}>每次练习一项表达。提示会留下记录，规则匹配仅表示练过该项，语言表现仍由老师结合原文判断。</p>
        </aside>
        <section className={styles.conversation} aria-label="本轮对话">
          {session ? <>
            <div className={styles.roundHeading}><h2>{session.complete ? "本轮表达练习已完成" : "轮到你说了"}</h2>{!fixedSessionId && <label>回看轮次<NativeSelect value={session.id} disabled={busy} onChange={(event) => setSessionId(event.target.value)}>{sessions.map((item, index) => <option value={item.id} key={item.id}>记录 {sessions.length - index} · {item.complete ? "已完成" : `已练 ${item.step}/${item.scenario.goals.length} 项`}</option>)}</NativeSelect></label>}</div>
            <DialogueTranscript session={session}/>
            {session.pending && <p className={styles.note} role="status">上一条发言正在处理，完成后会自动读取结果。</p>}
            {session.complete ? <div className={styles.finished}><p>已留下完整对话，提示按钮使用了 {session.hintCount} 次。可以回看每次表达。</p>{!fixedSessionId && <Button variant="outline" disabled={busy || !available} onClick={start}>再练一轮</Button>}</div>
              : !session.canContinue ? <p className={styles.finished}>{session.journeyLocked ? "请先到主题闯关完成阅读与书写，再继续本轮对话。" : "这个情境已归档或班级权限已变化，已有记录仍可回看。"}</p>
                : <form className={styles.answer} onSubmit={send}><label>我的发言<Textarea rows={3} maxLength={600} required value={answer} disabled={busy || session.pending} onChange={(event) => setDrafts({ ...drafts, [session.id]: event.target.value })} placeholder="试着用自己的话表达，需要帮助时可以查看提示。"/></label><div><Button variant="outline" disabled={busy || session.pending} onClick={hint}><Lightbulb/>看看提示</Button><Button type="submit" disabled={busy || session.pending || !answer.trim()}><Send/>{busy ? "正在处理…" : "发送发言"}</Button></div></form>}
          </> : <div className={styles.intro}><h2>准备好开始了吗？</h2><p>对方会以“{scenario.roleName}”的身份和你交流，练习过程中可以查看提示。</p><Button disabled={busy || !available} onClick={start}>开始这一轮</Button></div>}
        </section>
      </div>
      <p className={styles.note}>展示最近 20 轮对话供回看；记录不自动写入课程成绩。{(session?.scenario ?? scenario).aiEnabled ? "本情境允许 AI 辅助回复，实际来源标在每条角色回复旁。" : "本情境使用老师设定的角色脚本。"}</p>
    </>}
  </section>;
}
