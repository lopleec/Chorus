import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { ChorusPaths } from "./paths.js";

export const providerCallFormatSchema = z.enum(["openai_chat", "anthropic_messages", "gemini_generate_content"]);

const customProviderSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  models: z.array(z.string().min(1)).default([]),
  callFormat: providerCallFormatSchema.default("openai_chat"),
  allowInsecureTls: z.boolean().default(false)
});

export const chorusSettingsSchema = z.object({
  agentName: z.string().default("Chorus"),
  language: z.enum(["en", "zh"]).default("zh"),
  tone: z.string().default("warm, concise, capable"),
  provider: z.string().default("mock"),
  model: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  apiKeys: z.object({
    openai: z.string().optional(),
    anthropic: z.string().optional(),
    gemini: z.string().optional()
  }).default({}),
  customProviders: z.array(customProviderSchema).default([]),
  opencode: z.object({
    enabled: z.boolean().default(false),
    syncModel: z.boolean().default(true)
  }).default({ enabled: false, syncModel: true }),
  security: z.object({
    reviewStrictness: z.enum(["malicious_only", "vulnerabilities_block"]).default("vulnerabilities_block"),
    addonCooldownMinutes: z.number().int().min(0).default(10)
  }).default({ reviewStrictness: "vulnerabilities_block", addonCooldownMinutes: 10 }),
  mcp: z.object({
    servers: z.array(z.object({
      name: z.string(),
      command: z.string(),
      args: z.array(z.string()).default([]),
      enabled: z.boolean().default(true)
    })).default([])
  }).default({ servers: [] })
});

export type ChorusSettings = z.infer<typeof chorusSettingsSchema>;
export type ProviderCallFormat = z.infer<typeof providerCallFormatSchema>;
export type CustomProviderSettings = z.infer<typeof customProviderSchema>;

export function defaultSettings(): ChorusSettings {
  return chorusSettingsSchema.parse({});
}

export function loadSettings(paths: ChorusPaths): ChorusSettings {
  if (!existsSync(paths.configPath)) {
    return defaultSettings();
  }
  return chorusSettingsSchema.parse(JSON.parse(readFileSync(paths.configPath, "utf8")));
}

export function saveSettings(paths: ChorusPaths, settings: ChorusSettings): ChorusSettings {
  const parsed = chorusSettingsSchema.parse(settings);
  writeFileSync(paths.configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

export function settingsToEnv(settings: ChorusSettings): NodeJS.ProcessEnv {
  return {
    CHORUS_PROVIDER: settings.provider,
    CHORUS_MODEL: settings.model,
    OPENAI_API_KEY: settings.apiKeys.openai,
    OPENAI_BASE_URL: settings.openaiBaseUrl,
    ANTHROPIC_API_KEY: settings.apiKeys.anthropic,
    GEMINI_API_KEY: settings.apiKeys.gemini
  };
}
