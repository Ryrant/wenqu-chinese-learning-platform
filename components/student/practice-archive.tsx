import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionHeading, EmptyState } from "@/components/workspace/workspace-ui";
import { PracticeRecordDetail } from "@/components/learning/practice-record-detail";
import { requestJson } from "@/lib/workspace/api";
import { sequenceTime } from "@/lib/learning-sequence-types";
import { learningAnalyticsMessage } from "@/lib/learning-analytics";
import type { PracticeDetail, PracticeKind, PracticeMetric, PracticeOverview } from "@/lib/practice-types";
import styles from "./practice-archive.module.css";

const labels: Record<PracticeKind, string> = { writing: "汉字书写", reading: "阅读自测", vocabulary: "生词复习", dictation: "听写", journey: "主题闯关" };
function metricText(item: PracticeMetric) {
  if (item.kind === "writing") return item.rounds + " 轮保存记录 · 主动提示 " + item.hints + " 次";
  if (item.kind === "journey") return "开始 " + item.rounds + " 轮 · 三关完成 " + item.completed + " 轮";
  const result = item.total ? (item.kind === "vocabulary" ? "首次作答答对 " : item.kind === "dictation" ? "与参考一致 " : "自测答对 ") + item.correct + "/" + item.total : "尚未作答";
  return item.rounds + " 轮 · " + result + (item.kind === "dictation" ? " · 已作答中 " + item.referenceViewed + " 项查看过参考" : "");
}
export default function PracticeArchive({ revision }: { revision: string }) {
  const [period, setPeriod] = useState<7 | 30>(30);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string[]>([]);
  const [committedPrevious, setCommittedPrevious] = useState<string[]>([]);
  const [data, setData] = useState<PracticeOverview | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState("");
  const [detail, setDetail] = useState<PracticeDetail | null>(null);
  const [detailError, setDetailError] = useState<{ key: string; message: string } | null>(null);
  const [detailReading, setDetailReading] = useState(false);
  const version = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); const current = ++version.current;
    setReading(true);
    const query = new URLSearchParams({ period: String(period), ...(cursor ? { cursor } : {}) });
    void requestJson<PracticeOverview>("/api/v1/practice/overview?" + query, { signal: controller.signal, cache: "no-store" }).then((value) => {
      if (!controller.signal.aborted && current === version.current) { setData(value); setCommittedPrevious(previous); setError(""); setReading(false); }
    }).catch(() => { if (!controller.signal.aborted && current === version.current) { setError("练习记录暂时没有读取成功，已加载内容仍保留，请重试。"); setReading(false); } });
    return () => controller.abort();
  }, [period, cursor, previous, reload, revision]);
  const selected = data?.records.find((item) => item.kind + ":" + item.id === expanded);
  const visibleDetail = detail && detail.entry.kind + ":" + detail.entry.id === expanded ? detail : null;
  useEffect(() => {
    if (!selected || reading) return;
    const controller = new AbortController(); setDetailReading(true); setDetailError(null);
    const query = new URLSearchParams({ recordKind: selected.kind, recordId: selected.id });
    void requestJson<PracticeDetail>("/api/v1/practice/overview?" + query, { signal: controller.signal, cache: "no-store" }).then((value) => {
      if (!controller.signal.aborted) { setDetail(value); setDetailReading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setDetailError({ key: selected.kind + ":" + selected.id, message: "这份原始记录暂未读取成功，请重新读取；已加载的记录仍保留。" }); setDetailReading(false); } });
    return () => controller.abort();
  }, [selected, reading, reload]);
  return <section className={styles.section} aria-label="日常练习档案">
    <SectionHeading title="日常练习" description="回看书写、阅读、生词、听写与主题记录，了解每轮实际做过什么。"/>
    <div className={styles.toolbar}><label>记录范围<NativeSelect value={period} onChange={(event) => { version.current++; setReading(true); setPeriod(Number(event.target.value) as 7 | 30); setCursor(null); setPrevious([]); }}><option value={7}>最近 7 天</option><option value={30}>最近 30 天</option></NativeSelect></label><Button variant="outline" disabled={reading} onClick={() => { version.current++; setReading(true); setReload((value) => value + 1); }}><RefreshCw/>重新读取</Button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {reading && <p role="status">{data ? "正在读取选定范围，当前仍展示上次读取的记录。" : "正在读取日常练习…"}</p>}
    {!data ? !reading && <EmptyState title="日常练习暂未载入" description="点击重新读取，恢复本人已保存的练习记录。"/> : <>
      <p className={styles.note}>当前显示：{sequenceTime(data.rangeStart)} 至 {sequenceTime(data.asOf)}。按保存或开始时间排列，进度展示读取时最新保存结果。</p>
      {data.metrics ? <dl className={styles.metrics}>{data.metrics.map((item) => <div key={item.kind}><dt>{labels[item.kind]}</dt><dd>{metricText(item)}</dd></div>)}</dl> : <p className={styles.note}>{learningAnalyticsMessage(data.consentStatus)} 本人的原始练习仍可在下方回看。</p>}
      {data.records.length ? <ol className={styles.records}>{data.records.map((item) => {
        const key = item.kind + ":" + item.id;
        return <li key={key}><div className={styles.identity}><div><h4>{item.title}</h4><p>{labels[item.kind]} · {sequenceTime(item.createdAt)} · {item.status === "finished" ? "已保存完成" : item.status === "ended" ? "提前结束" : "进行中"}</p></div><Button variant="outline" size="sm" aria-expanded={expanded === key} onClick={() => setExpanded(expanded === key ? "" : key)}>{expanded === key ? "收起记录" : "查看原始记录"}</Button></div><p>{item.summary}</p>
          {expanded === key && <div className={styles.detail}>{detailReading && <p role="status">正在读取本轮保存记录…</p>}{detailError?.key === expanded && <p role="alert" className={styles.error}>{detailError.message}</p>}{visibleDetail && <PracticeRecordDetail detail={visibleDetail}/>}<Button asChild variant="ghost"><Link to={item.href}>{item.kind === "writing" ? "再练这个字" : item.kind === "reading" ? "重新阅读课文" : "打开这轮记录"}</Link></Button></div>}
        </li>;
      })}</ol> : <EmptyState title="这个时间范围内还没有练习记录" description="完成书写、阅读自测，或开始生词、听写和主题练习后，就会出现在这里。"/>}
      <div className={styles.pagination}><Button variant="outline" disabled={reading || data.period !== period || !committedPrevious.length} onClick={() => { version.current++; setReading(true); setCursor(committedPrevious.at(-1)!); setPrevious(committedPrevious.slice(0, -1)); setReload((value) => value + 1); }}>上一页</Button><Button variant="outline" disabled={reading || data.period !== period || !data.nextCursor} onClick={() => { version.current++; setReading(true); setPrevious([...committedPrevious, data.currentCursor]); setCursor(data.nextCursor); setReload((value) => value + 1); }}>下一页</Button>{cursor && <Button variant="ghost" disabled={reading} onClick={() => { version.current++; setReading(true); setCursor(null); setPrevious([]); setReload((value) => value + 1); }}>回到最近记录</Button>}</div>
      <p className={styles.note}>各模块分别记录，不把主题与子练习相加计分；书写用时仅表示该轮书写练习，练习情况不转换为能力等级或课程成绩。</p>
    </>}
  </section>;
}
