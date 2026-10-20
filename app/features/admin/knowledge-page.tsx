import { useState } from "react";
import { numberValue, stringValue } from "@/app/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/app/components/workspace-ui";
import type { AdminProps } from "@/app/features/shared/staff-display";

export function KnowledgePage({ notify }: AdminProps) {
const [query, setQuery] = useState("");
const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
const [selectedSearchResultId, setSelectedSearchResultId] = useState("");
return <section key="knowledge-search">
    <PageHeader title="知识检索" description="从已发布的教学资料中查找内容。"/>
    <form className="panel query-panel" onSubmit={async (event) => { event.preventDefault(); try { const response = await fetch("/api/v1/knowledge/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, limit: 10 }) }); const result = await response.json() as { results?: Array<Record<string, unknown>>; error?: string }; if (!response.ok) throw new Error(result.error); setResults(result.results ?? []); } catch (reason) { notify("检索失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}><label>检索词<Input placeholder="输入主题、词语或问题…" value={query} onChange={(event) => setQuery(event.target.value)} required/></label><Button type="submit" variant="default">检索已发布知识</Button></form>
    <Card className="panel search-results"><div className="panel-heading"><div><span className="eyebrow">检索结果</span><h3>{results.length ? `命中 ${results.length} 个知识片段` : "等待检索"}</h3></div></div>{results.length ? results.map((item, index) => { const resultId = String(item.id); const expanded = selectedSearchResultId === resultId; return <div className="citation search-result" key={resultId}><span className="result-rank">{index + 1}</span><div><strong>{stringValue(item.title)}</strong><small>命中 {numberValue(item.score)} 个检索词</small><p>{stringValue(item.excerpt)}</p><Button type="button" variant="link" aria-expanded={expanded} onClick={() => setSelectedSearchResultId(expanded ? "" : resultId)}>{expanded ? "收起来源片段" : "查看来源片段"}</Button>{expanded && <div className="source-detail"><b>来源原文（只读）</b><p>{stringValue(item.content, stringValue(item.excerpt))}</p></div>}</div></div>; }) : <p className="empty-state">输入检索词后，这里会展示来源标题、命中依据和相关摘要。</p>}</Card>
  </section>;
}

export default KnowledgePage;
