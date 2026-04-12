import OpenAI from "openai";
import { Agent as HttpsAgent } from "node:https";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  allowInsecureTls?: boolean;
  providerName?: string;
}

export class OpenAIProvider implements TextProvider {
  readonly id = "openai" as const;
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      httpAgent: options.allowInsecureTls ? new HttpsAgent({ rejectUnauthorized: false }) : undefined
    });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const model = request.model ?? this.options.defaultModel ?? "gpt-4o-mini";
    try {
      const response = await this.client.chat.completions.create({
        model,
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
    } catch (error) {
      throw enrichProviderError(error, this.options.providerName ?? this.id, this.options.baseURL, model);
    }
  }
}

function enrichProviderError(error: unknown, provider: string, baseURL: string | undefined, model: string): Error {
  const err = error as Error & { cause?: { code?: string; message?: string }; status?: number; code?: string };
  const cause = err.cause?.message ? ` Cause: ${err.cause.message}` : "";
  const code = err.cause?.code ? ` (${err.cause.code})` : err.code ? ` (${err.code})` : "";
  let hint = "";
  if (err.cause?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
    hint = " If this is a trusted custom gateway, set allowInsecureTls=true for that custom provider in ~/.chorus/config.json or fix its certificate chain.";
  }
  return new Error(`Provider ${provider} request failed for model ${model}${baseURL ? ` at ${baseURL}` : ""}: ${err.message}${code}.${cause}${hint}`);
}
