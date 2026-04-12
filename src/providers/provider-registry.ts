import type { ProviderId, ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";
import type { ProviderEnvConfig } from "../config/env.js";
import { requireProviderEnv } from "../config/env.js";
import { AnthropicProvider } from "./anthropic-provider.js";
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

  list(): ProviderId[] {
    return [...this.providers.keys()];
  }

  async generateText(request: ProviderRequest, provider?: ProviderId): Promise<ProviderResponse> {
    return this.get(provider).generateText(request);
  }
}
