import { sequenceTime } from "@/lib/learning-sequence-types";
import type { PracticeDetail } from "@/lib/practice-types";
import styles from "./practice-record-detail.module.css";

export function PracticeRecordDetail({ detail, subject = "我的" }: { detail: PracticeDetail; subject?: "我的" | "学生" }) {
  return <div className={styles.detail}>
    {detail.writing && <p>{detail.writing.mode === "trace" ? "描红练习" : "独立书写"} · 重试 {detail.writing.mistakes} 次 · 主动提示 {detail.writing.hints} 次 · 本轮用时 {(detail.writing.elapsedMs / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 秒</p>}
    {detail.texts.length > 0 && <details><summary>练习内容快照</summary>{detail.texts.map((text, index) => <p key={index}>{text}</p>)}</details>}
    {detail.hints !== undefined && <p>{detail.entry.kind === "dictation" ? "本轮查看参考 " + detail.hints + " 项（含尚未作答项）" : "对话主动提示 " + detail.hints + " 次"}</p>}
    {detail.answers.map((answer, index) => <article key={index}>
      <h4>{answer.prompt}</h4>
      {answer.at && <p className={styles.meta}>{sequenceTime(answer.at)}</p>}
      <p>{subject}作答：{answer.actual}</p><p>参考答案：{answer.expected}</p>
      <p>{answer.correct ? "与参考一致" : "与参考不同"}{answer.usedReference !== undefined ? answer.usedReference ? " · 已查看参考后练习" : " · 未查看参考文字" : ""}{answer.playCount !== undefined ? " · 播放 " + answer.playCount + " 次" : ""}</p>
    </article>)}
    {detail.turns?.map((turn) => <article key={turn.id}><h4>{turn.kind === "student" ? subject + "发言" : turn.kind === "hint" ? "主动提示" : "角色回复"}</h4><p className={styles.meta}>{sequenceTime(turn.at)}{turn.provider ? " · " + ({ script: "教师脚本", openai: "AI 辅助回复", fallback: "调用失败后使用教师脚本" }[turn.provider]) : ""}</p><p>{turn.text}</p>{turn.matchedExpression && <p>规则匹配表达：{turn.matchedExpression}</p>}</article>)}
    {!detail.writing && !detail.answers.length && !detail.turns?.length && <p>本轮尚未保存作答。</p>}
  </div>;
}
