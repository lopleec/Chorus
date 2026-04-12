import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export class OpenAIProvider implements TextProvider {
  readonly id = "openai" as const;
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL
    });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model ?? this.options.defaultModel ?? "gpt-4o-mini",
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content
      })) as ChatCompletionMessageParam[],
      temperature: request.temperature,
      max_tokens: request.maxTokens
    });

    return {
      text: response.choices[0]?.message?.content ?? "",
      raw: response,
      usage: response.usage
    };
  }
}
