import type { CSSProperties } from "react";
import styles from "./progress-ring.module.css";

export function ProgressRing({ value, label }: { value: number | null; label: string }) {
  return <div className={styles.progressRing} style={{ "--progress": `${(value ?? 0) * 3.6}deg` } as CSSProperties}>
    <div><strong>{value === null ? "待评估" : `${value}%`}</strong><span>{label}</span></div>
  </div>;
}
