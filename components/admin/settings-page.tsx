import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/workspace/workspace-ui";
import type { AdminProps } from "@/lib/staff-display";

const SERVICE_NAMES: Record<string, string> = {
  database: "数据库",
  storage: "文件存储",
  retrieval: "知识检索",
  generation: "内容生成",
  speech: "语音评测",
  moderation: "内容审核",
};

const SERVICE_STATUS: Record<string, { label: string; tone: string }> = {
  available: { label: "已读取", tone: "healthy" },
  configured_unverified: { label: "未验证", tone: "builtin" },
  unconfigured: { label: "未配置", tone: "manual" },
  built_in: { label: "内置功能", tone: "builtin" },
  template: { label: "内置模式", tone: "builtin" },
  manual: { label: "人工复核", tone: "manual" },
  rules: { label: "基础规则", tone: "builtin" },
  error: { label: "异常", tone: "error" },
};

export function SettingsPage({ data, refresh, notify }: AdminProps) {
const [settingsBusy, setSettingsBusy] = useState(false);
const [jwtTtlSeconds, setJwtTtlSeconds] = useState(String(data.platformSettings?.jwtTtlSeconds ?? 604800));
const [aiModel, setAiModel] = useState(data.platformSettings?.aiModel ?? "gpt-5.6-luna");
const [aiKey, setAiKey] = useState("");
const [openAiKey, setOpenAiKey] = useState("");
const [speechKey, setSpeechKey] = useState("");
const [moderationKey, setModerationKey] = useState("");
const serviceEntries = Object.entries(data.services);
const secretLabel = (item?: { configured: boolean; suffix: string }) => item?.configured ? `已配置，尾号 ${item.suffix}` : "未配置";
async function saveSettings(event: React.FormEvent) {
    event.preventDefault(); setSettingsBusy(true);
    try {
      const response = await fetch("/api/v1/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jwtTtlSeconds: Number(jwtTtlSeconds), aiModel, aiKey, openAiKey, speechKey, moderationKey }) });
      const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "保存失败");
      setAiKey(""); setOpenAiKey(""); setSpeechKey(""); setModerationKey("");
      notify("平台设置已保存", "新的请求将使用更新后的设置。");
      try { await refresh(); }
      catch (reason) { notify("平台设置已保存", `状态刷新失败：${reason instanceof Error ? reason.message : "请刷新页面"}`, "error"); }
    } catch (reason) { notify("保存平台设置失败", reason instanceof Error ? reason.message : "请重试", "error"); }
    finally { setSettingsBusy(false); }
  }
return <section key="platform-settings">
    <PageHeader title="平台设置" description="管理模型、服务凭据与登录会话。"/>
    <section className="settings-layout"><form className="panel form-card" onSubmit={saveSettings}><h3>运行配置</h3><div className="field-row"><label>会话有效期（秒）<Input type="number" min="300" max="2592000" value={jwtTtlSeconds} onChange={(event) => setJwtTtlSeconds(event.target.value)} required/></label><label>AI 模型<Input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder="gpt-5.6-luna" required/></label></div><label>通用 AI Key <small>{secretLabel(data.platformSettings?.aiKey)}</small><Input type="password" value={aiKey} onChange={(event) => setAiKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>OpenAI Key <small>{secretLabel(data.platformSettings?.openAiKey)}</small><Input type="password" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>语音评测 Key <small>{secretLabel(data.platformSettings?.speechKey)}</small><Input type="password" value={speechKey} onChange={(event) => setSpeechKey(event.target.value)} placeholder="留空则保留现有值"/></label><label>内容审核 Key <small>{secretLabel(data.platformSettings?.moderationKey)}</small><Input type="password" value={moderationKey} onChange={(event) => setModerationKey(event.target.value)} placeholder="留空则保留现有值"/></label><Button type="submit" variant="default" disabled={settingsBusy}>{settingsBusy ? "保存中…" : "保存平台设置"}</Button></form><Card className="panel service-health"><div className="panel-heading"><div><span className="eyebrow">当前运行模式</span><h3>服务配置与运行方式</h3></div></div>{serviceEntries.map(([key, service]) => { const status = SERVICE_STATUS[service.status] ?? SERVICE_STATUS.error; return <div className="service-row" key={key}><span className={`service-dot ${status.tone}`}/><p><strong>{SERVICE_NAMES[key] ?? key}<small>{key}</small></strong><span>{service.label}</span></p><b className={`service-badge ${status.tone}`}>{status.label}</b></div>; })}</Card></section>
  </section>;
}

export default SettingsPage;
