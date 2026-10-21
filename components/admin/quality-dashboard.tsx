import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/workspace/workspace-ui";
import styles from "@/components/admin/learning-loop-views.module.css";
import type { LoopProps } from "@/lib/learning-display";

export function AdminQualityDashboard({ data }: Pick<LoopProps, "data">) {
  const metrics = data.qualityMetrics;
  const [selectedKey, setSelectedKey] = useState("");
  const entries = metrics ? Object.entries(metrics) : [];
  const selected = metrics?.[selectedKey];
  return <section className="loop-section">
    <SectionHeading title="教学质量" description="查看当前机构的教学进度与待处理事项。"/>
    {metrics ? <><section className={styles.qualityGrid}>{entries.map(([key, metric]) => <Button variant="outline" type="button" className={styles.qualityCard} data-active={selectedKey === key} key={key} onClick={() => setSelectedKey(selectedKey === key ? "" : key)}><span>{metric.label}</span><strong>{metric.available === false ? "未授权" : <>{metric.value}{metric.unit === "percent" ? "%" : ""}</>}</strong><small>{metric.available === false ? metric.note : `${metric.numerator} / ${metric.denominator}`}</small><em>查看明细</em></Button>)}</section>
      {selected && <Card className="panel quality-detail"><div className="panel-heading"><div><h3>{selected.label}</h3><p className="text-muted-foreground">{selected.note}</p></div><Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => setSelectedKey("")}>关闭</Button></div>{selected.details.length ? selected.details.map((item) => <div className="history-row" key={item.id}><strong>{item.label}</strong>{item.meta && <small>{item.meta}</small>}</div>) : <p className="empty-state">{selected.available === false ? "有效授权后才可查看累计分析。" : "当前没有需要处理的对象。"}</p>}</Card>}
    </> : <p className="empty-state">质量指标暂不可用。</p>}
  </section>;
}

export default AdminQualityDashboard;
