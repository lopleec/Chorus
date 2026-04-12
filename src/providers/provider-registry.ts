import type { ProviderId, ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";
import type { ProviderEnvConfig } from "../config/env.js";
import type { ChorusSettings } from "../config/settings.js";
import { requireProviderEnv } from "../config/env.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { CustomProvider } from "./custom-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { MockProvider } from "./mock-provider.js";
import { OpenAIProvider } from "./openai-provider.js";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, TextProvider>();
  private defaultProvider: ProviderId;

  constructor(defaultProvider: ProviderId = "mock") {
    this.defaultProvider = defaultProvider;
  }

  static fromEnv(config: ProviderEnvConfig): ProviderRegistry {
    requireProviderEnv(config);
    const registry = new ProviderRegistry(config.provider);
    registry.register(new MockProvider());
    if (config.openaiApiKey) {
      registry.register(new OpenAIProvider({
        apiKey: config.openaiApiKey,
        baseURL: config.openaiBaseUrl,
        defaultModel: config.provider === "openai" ? config.model : undefined
      }));
    }
    if (config.anthropicApiKey) {
      registry.register(new AnthropicProvider({
        apiKey: config.anthropicApiKey,
        defaultModel: config.provider === "anthropic" ? config.model : undefined
      }));
    }
    if (config.geminiApiKey) {
      registry.register(new GeminiProvider({
        apiKey: config.geminiApiKey,
        defaultModel: config.provider === "gemini" ? config.model : undefined
      }));
    }
    return registry;
  }

  static fromSettings(settings: ChorusSettings, envConfig: ProviderEnvConfig): ProviderRegistry {
    const registry = new ProviderRegistry(envConfig.provider || settings.provider);
    registry.register(new MockProvider());
    const openaiKey = envConfig.openaiApiKey ?? settings.apiKeys.openai;
    const anthropicKey = envConfig.anthropicApiKey ?? settings.apiKeys.anthropic;
    const geminiKey = envConfig.geminiApiKey ?? settings.apiKeys.gemini;

    if (openaiKey) {
      registry.register(new OpenAIProvider({
        apiKey: openaiKey,
        baseURL: envConfig.openaiBaseUrl ?? settings.openaiBaseUrl,
        defaultModel: (envConfig.provider === "openai" || settings.provider === "openai") ? envConfig.model ?? settings.model : undefined
      }));
    }
    if (anthropicKey) {
      registry.register(new AnthropicProvider({
        apiKey: anthropicKey,
        defaultModel: (envConfig.provider === "anthropic" || settings.provider === "anthropic") ? envConfig.model ?? settings.model : undefined
      }));
    }
    if (geminiKey) {
      registry.register(new GeminiProvider({
        apiKey: geminiKey,
        defaultModel: (envConfig.provider === "gemini" || settings.provider === "gemini") ? envConfig.model ?? settings.model : undefined
      }));
    }
    for (const customProvider of settings.customProviders) {
      registry.register(new CustomProvider(customProvider));
    }

    registry.ensureDefaultAvailable();
    return registry;
  }

  register(provider: TextProvider): void {
    this.providers.set(provider.id, provider);
  }

  setDefault(provider: ProviderId): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Provider "${provider}" is not registered.`);
    }
    this.defaultProvider = provider;
  }

  get(provider: ProviderId = this.defaultProvider): TextProvider {
    const found = this.providers.get(provider);
    if (!found) {
      throw new Error(`Provider "${provider}" is not registered. Check CHORUS_PROVIDER and API key environment variables.`);
    }
    return found;
  }

  ensureDefaultAvailable(): void {
    if (!this.providers.has(this.defaultProvider)) {
      throw new Error(`Provider "${this.defaultProvider}" is not registered. Configure it in onboarding or CHORUS_PROVIDER.`);
    }
  }

  list(): ProviderId[] {
    return [...this.providers.keys()];
  }

  async generateText(request: ProviderRequest, provider?: ProviderId): Promise<ProviderResponse> {
    return this.get(provider).generateText(request);
  }
}
