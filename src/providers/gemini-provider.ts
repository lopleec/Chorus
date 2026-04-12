import { GoogleGenAI } from "@google/genai";
import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, TextProvider } from "../core/types.js";

export interface GeminiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export class GeminiProvider implements TextProvider {
  readonly id = "gemini" as const;
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey, apiVersion: undefined, httpOptions: options.baseUrl ? { baseUrl: options.baseUrl } : undefined });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.client.models.generateContent(this.createParams(request));

    return {
      text: response.text ?? "",
      raw: response,
      usage: response.usageMetadata
    };
  }

  async *streamText(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const stream = await this.client.models.generateContentStream(this.createParams(request));
    for await (const chunk of stream) {
      if (chunk.text) {
        yield { text: chunk.text, raw: chunk, usage: chunk.usageMetadata };
      }
    }
    yield { text: "", done: true };
  }

  private createParams(request: ProviderRequest) {
    const contents = request.messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");
    return {
      model: request.model ?? this.options.defaultModel ?? "gemini-2.0-flash-001",
      contents,
      config: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens
      }
    };
  }
}
