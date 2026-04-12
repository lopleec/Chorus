import Anthropic from "@anthropic-ai/sdk";
import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, TextProvider } from "../core/types.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class AnthropicProvider implements TextProvider {
  readonly id = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const body = this.createBody(request);
    const response = await this.client.messages.create(body);

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

  async *streamText(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const stream = await this.client.messages.create({
      ...this.createBody(request),
      stream: true
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
        yield { text: event.delta.text, raw: event };
      }
      if (event.type === "message_delta") {
        yield { text: "", raw: event, usage: event.usage };
      }
    }
    yield { text: "", done: true };
  }

  private createBody(request: ProviderRequest) {
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

    return {
      model: request.model ?? this.options.defaultModel ?? "claude-3-5-haiku-latest",
      max_tokens: request.maxTokens ?? 1024,
      temperature: request.temperature,
      system: system || undefined,
      messages
    };
  }
}
