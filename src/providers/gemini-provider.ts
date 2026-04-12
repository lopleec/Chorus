import { GoogleGenAI } from "@google/genai";
import type { ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";

export interface GeminiProviderOptions {
  apiKey: string;
  defaultModel?: string;
}

export class GeminiProvider implements TextProvider {
  readonly id = "gemini" as const;
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const contents = request.messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");
    const response = await this.client.models.generateContent({
      model: request.model ?? this.options.defaultModel ?? "gemini-2.0-flash-001",
      contents,
      config: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens
      }
    });

    return {
      text: response.text ?? "",
      raw: response,
      usage: response.usageMetadata
    };
  }
}
