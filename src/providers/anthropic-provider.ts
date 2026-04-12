import Anthropic from "@anthropic-ai/sdk";
import type { ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

export class AnthropicProvider implements TextProvider {
  readonly id = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content
      }));

    const response = await this.client.messages.create({
      model: request.model ?? this.options.defaultModel ?? "claude-3-5-haiku-latest",
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature,
      system: system || undefined,
      messages
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      raw: response,
      usage: response.usage
    };
  }
}
