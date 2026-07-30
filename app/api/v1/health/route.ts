import { env } from "cloudflare:workers";
import { loadPlatformSettings } from "../../../lib/platform-settings";

export async function GET() {
  const bindings = env as unknown as { DB?: D1Database; CONTENT?: R2Bucket };
  const settings = bindings.DB ? await loadPlatformSettings(bindings.DB) : null;
  return Response.json({
    status: bindings.DB && bindings.CONTENT ? "ok" : "degraded",
    service: "wenqu-platform", region: "sg", timestamp: new Date().toISOString(),
    providers: {
      database: bindings.DB ? "available" : "unavailable",
      storage: bindings.CONTENT ? "available" : "unavailable",
      textGeneration: settings?.aiKey || settings?.openAiKey ? "configured" : "not_configured_template_available",
      openai: settings?.openAiKey ? "configured" : "not_configured_template_available",
      aiModel: settings?.aiModel ?? "gpt-5.6-luna",
      speechScoring: settings?.speechKey ? "configured" : "not_configured_manual_review",
      retrieval: bindings.DB ? "published_keyword_available" : "unavailable",
      moderation: settings?.moderationKey ? "configured" : "rules_only",
    },
  }, { headers: { "cache-control": "no-store" } });
}
