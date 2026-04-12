import type { ProviderId } from "../core/types.js";

export interface ProviderEnvConfig {
  provider: ProviderId;
  model?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
}

export function readProviderEnv(env: NodeJS.ProcessEnv = process.env): ProviderEnvConfig {
  const provider = env.CHORUS_PROVIDER?.trim() || "mock";
  return {
    provider,
    model: env.CHORUS_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY
  };
}

export function requireProviderEnv(config: ProviderEnvConfig): void {
  if (config.provider === "openai" && !config.openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY for CHORUS_PROVIDER=openai.");
  }
  if (config.provider === "anthropic" && !config.anthropicApiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY for CHORUS_PROVIDER=anthropic.");
  }
  if (config.provider === "gemini" && !config.geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY for CHORUS_PROVIDER=gemini.");
  }
}
