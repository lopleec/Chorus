import { AnthropicProvider } from "./anthropic-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import type { CustomProviderSettings } from "../config/settings.js";
import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, TextProvider } from "../core/types.js";

export class CustomProvider implements TextProvider {
  readonly id: string;
  private readonly delegate: TextProvider;

  constructor(private readonly settings: CustomProviderSettings) {
    this.id = settings.name;
    const defaultModel = settings.models[0];
    if (settings.callFormat === "anthropic_messages") {
      this.delegate = new AnthropicProvider({
        apiKey: settings.apiKey ?? "not-configured",
        baseURL: settings.baseUrl,
        defaultModel
      });
      return;
    }
    if (settings.callFormat === "gemini_generate_content") {
      this.delegate = new GeminiProvider({
        apiKey: settings.apiKey ?? "not-configured",
        baseUrl: settings.baseUrl,
        defaultModel
      });
      return;
    }
    this.delegate = new OpenAIProvider({
      apiKey: settings.apiKey ?? "not-configured",
      baseURL: settings.baseUrl,
      defaultModel,
      allowInsecureTls: settings.allowInsecureTls,
      providerName: settings.name
    });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    return this.delegate.generateText({
      ...request,
      model: request.model ?? this.settings.models[0]
    });
  }

  async *streamText(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const next = {
      ...request,
      model: request.model ?? this.settings.models[0]
    };
    if (this.delegate.streamText) {
      yield* this.delegate.streamText(next);
      return;
    }
    const response = await this.delegate.generateText(next);
    yield { text: response.text, raw: response.raw, usage: response.usage, done: true };
  }
}
