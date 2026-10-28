import { useEffect, useRef } from "react";
import { Check, Lightbulb } from "lucide-react";
import type { DialogueSession } from "@/lib/dialogue-types";
import styles from "./dialogue-transcript.module.css";

export function DialogueGoals({ session }: { session: DialogueSession }) {
  return <section className={styles.goals} aria-label="本轮表达练习"><h2>本轮表达练习</h2><ol>{session.scenario.goals.map((goal, index) => <li key={index} data-current={session.step === index} data-complete={session.step > index}><span>{session.step > index ? <Check/> : index + 1}</span><p>{goal.title}</p></li>)}</ol><p>已练习 {session.step} / {session.scenario.goals.length} 项 · 提示按钮 {session.hintCount} 次</p></section>;
}

export function DialogueTranscript({ session, review = false }: { session: DialogueSession; review?: boolean }) {
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = review ? 0 : log.current.scrollHeight; }, [session.id, session.turns.length, review]);
  return <div ref={log} className={styles.transcript} role="log" aria-label="对话记录" aria-live={review ? "off" : "polite"} tabIndex={0}>
    {session.turns.map((turn) => <article key={turn.id} className={styles.turn} data-kind={turn.kind}>
      <div className={styles.turnHeading}><strong>{turn.kind === "student" ? review ? session.studentName : "你" : turn.kind === "hint" ? <><Lightbulb/>练习提示</> : session.scenario.roleName}</strong>
        {turn.kind === "role" && <small>{turn.provider === "openai" ? "AI 辅助回复" : turn.provider === "fallback" ? "AI 不可用，已用教师脚本" : "教师脚本"}</small>}</div>
      <p>{turn.text}</p>
      {review && turn.matchedExpression && <small className={styles.match}>匹配表达：{turn.matchedExpression} · {session.scenario.goals[turn.step]?.title}</small>}
    </article>)}
  </div>;
}
