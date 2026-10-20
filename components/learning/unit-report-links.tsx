import type { ReactNode } from "react";
import { unitReportUrl, type LearningSequence } from "../../lib/learning-sequence-types";
import styles from "./unit-report-links.module.css";

export function UnitReportLink({ sequenceId, children }: { sequenceId: string; children?: ReactNode }) {
  return <a className={styles.link} href={unitReportUrl(sequenceId)} target="_blank" rel="noopener">{children ?? "查看单元报告 / 打印"}</a>;
}

export function UnitReportIndex({ sequences }: { sequences: LearningSequence[] }) {
  return <section className={styles.index}><h4>单元证据报告</h4><p>查看作品、教师评价与后续安排，支持打印或保存为 PDF。</p>
    {!sequences.length ? <p>当前尚无任务组，教师关联初次作品后即可生成报告。</p> : <details><summary>查看全部 {sequences.length} 个任务组报告</summary><ul>{sequences.map((sequence) => <li key={sequence.id}><UnitReportLink sequenceId={sequence.id}>{sequence.studentName} · {sequence.title} · {sequence.objectiveTitle} · {sequence.id.slice(0, 8)}</UnitReportLink></li>)}</ul></details>}
  </section>;
}
