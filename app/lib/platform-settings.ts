export type PlatformSettings = {
  jwtTtlSeconds: number;
  aiKey: string;
  openAiKey: string;
  aiModel: string;
  speechKey: string;
  moderationKey: string;
};

export type PlatformSettingsInput = Partial<{
  jwtTtlSeconds: unknown;
  aiKey: unknown;
  openAiKey: unknown;
  aiModel: unknown;
  speechKey: unknown;
  moderationKey: unknown;
}>;

export type SecretStatus = { configured: boolean; suffix: string };

export type PublicPlatformSettings = {
  jwtTtlSeconds: number;
  aiModel: string;
  aiKey: SecretStatus;
  openAiKey: SecretStatus;
  speechKey: SecretStatus;
  moderationKey: SecretStatus;
};

const DEFAULTS: PlatformSettings = {
  jwtTtlSeconds: 604800,
  aiKey: "",
  openAiKey: "",
  aiModel: "gpt-5.6-luna",
  speechKey: "",
  moderationKey: "",
};

const KEY_MAP = {
  jwtTtlSeconds: "jwt_ttl_seconds",
  aiKey: "ai_api_key",
  openAiKey: "openai_api_key",
  aiModel: "ai_model",
  speechKey: "speech_api_key",
  moderationKey: "moderation_api_key",
} as const;

function stringInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function secretStatus(value: string): SecretStatus {
  return { configured: value.length > 0, suffix: value ? value.slice(-4) : "" };
}

function normalizeTtl(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 300 || parsed > 60 * 60 * 24 * 30) throw new Error("invalid_jwt_ttl_seconds");
  return Math.floor(parsed);
}

async function upsertSettings(db: D1Database, entries: Array<[string, string]>) {
  if (!entries.length) return;
  await db.batch(entries.map(([key, value]) => db.prepare(`
    INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).bind(key, value)));
}

export async function loadPlatformSettings(db: D1Database): Promise<PlatformSettings> {
  const rows = await db.prepare("SELECT key,value FROM app_settings").all<{ key: string; value: string }>();
  const values = new Map(rows.results.map((item) => [item.key, item.value]));
  const configuredTtl = Number.parseInt(values.get(KEY_MAP.jwtTtlSeconds) ?? "", 10);
  return {
    jwtTtlSeconds: Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : DEFAULTS.jwtTtlSeconds,
    aiKey: values.get(KEY_MAP.aiKey) ?? DEFAULTS.aiKey,
    openAiKey: values.get(KEY_MAP.openAiKey) ?? DEFAULTS.openAiKey,
    aiModel: values.get(KEY_MAP.aiModel) ?? DEFAULTS.aiModel,
    speechKey: values.get(KEY_MAP.speechKey) ?? DEFAULTS.speechKey,
    moderationKey: values.get(KEY_MAP.moderationKey) ?? DEFAULTS.moderationKey,
  };
}

export function publicPlatformSettings(settings: PlatformSettings): PublicPlatformSettings {
  return {
    jwtTtlSeconds: settings.jwtTtlSeconds,
    aiModel: settings.aiModel,
    aiKey: secretStatus(settings.aiKey),
    openAiKey: secretStatus(settings.openAiKey),
    speechKey: secretStatus(settings.speechKey),
    moderationKey: secretStatus(settings.moderationKey),
  };
}

export async function savePlatformSettings(db: D1Database, input: PlatformSettingsInput): Promise<PublicPlatformSettings> {
  const updates: Array<[string, string]> = [];
  const ttl = normalizeTtl(input.jwtTtlSeconds);
  if (ttl !== undefined) updates.push([KEY_MAP.jwtTtlSeconds, String(ttl)]);
  const aiModel = stringInput(input.aiModel);
  if (aiModel) updates.push([KEY_MAP.aiModel, aiModel]);
  for (const [field, key] of [
    ["aiKey", KEY_MAP.aiKey],
    ["openAiKey", KEY_MAP.openAiKey],
    ["speechKey", KEY_MAP.speechKey],
    ["moderationKey", KEY_MAP.moderationKey],
  ] as const) {
    const value = stringInput(input[field]);
    if (value) updates.push([key, value]);
  }
  await upsertSettings(db, updates);
  return publicPlatformSettings(await loadPlatformSettings(db));
}

export function aiProviderSettings(settings: PlatformSettings) {
  return { openAiKey: settings.openAiKey || settings.aiKey, model: settings.aiModel };
}
