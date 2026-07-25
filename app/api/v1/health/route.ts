import { env } from "cloudflare:workers";

export async function GET() {
  const bindings = env as unknown as Record<string, unknown>;
  return Response.json({
    status: bindings.DB && bindings.CONTENT ? "ok" : "degraded",
    service: "wenqu-platform", region: "sg", timestamp: new Date().toISOString(),
    providers: {
      database: bindings.DB ? "available" : "unavailable",
      storage: bindings.CONTENT ? "available" : "unavailable",
      textGeneration: bindings.AI_API_KEY ? "configured" : "not_configured_template_available",
      speechScoring: bindings.SPEECH_API_KEY ? "configured" : "not_configured_manual_review",
      retrieval: bindings.DB ? "published_keyword_available" : "unavailable",
      moderation: bindings.MODERATION_API_KEY ? "configured" : "rules_only",
    },
  }, { headers: { "cache-control": "no-store" } });
}
