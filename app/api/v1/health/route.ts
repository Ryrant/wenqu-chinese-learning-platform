import { ensurePlatformRuntime } from "../../../lib/platform-runtime";
import { loadPlatformSettings } from "../../../lib/platform-settings";
import { ensurePlatformSchema } from "../../../lib/platform-store";

export async function GET() {
  let database = null;
  let storage = null;
  try {
    ({ database, storage } = await ensurePlatformRuntime());
  } catch {
    // Keep degraded health semantics when runtime is unavailable.
  }
  let settings = null;
  if (database) {
    try {
      await ensurePlatformSchema(database);
      settings = await loadPlatformSettings(database);
    } catch {
      database = null;
    }
  }
  return Response.json({
    status: database && storage ? "ok" : "degraded",
    service: "huawen-zhixing-platform", region: "sg", timestamp: new Date().toISOString(),
    providers: {
      database: database ? "available" : "unavailable",
      storage: storage ? "available" : "unavailable",
      textGeneration: settings?.aiKey || settings?.openAiKey ? "configured" : "not_configured_template_available",
      openai: settings?.openAiKey ? "configured" : "not_configured_template_available",
      aiModel: settings?.aiModel ?? "gpt-5.6-luna",
      speechScoring: settings?.speechKey ? "credentials_saved_manual_review" : "not_configured_manual_review",
      retrieval: database ? "published_keyword_available" : "unavailable",
      moderation: settings?.moderationKey ? "credentials_saved_rules_only" : "rules_only",
    },
  }, { headers: { "cache-control": "no-store" } });
}
