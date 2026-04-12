import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, TextProvider } from "../core/types.js";

export class MockProvider implements TextProvider {
  readonly id = "mock" as const;

  async generateText(request: ProviderRequest): Promise<ProviderResponse> {
    const last = [...request.messages].reverse().find((message) => message.role !== "system");
    return {
      text: `mock:${last?.content ?? ""}`,
      raw: { provider: this.id, model: request.model ?? "mock-model" },
      usage: { inputMessages: request.messages.length }
    };
  }

  async *streamText(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const response = await this.generateText(request);
    for (const chunk of response.text.match(/.{1,8}/gu) ?? [""]) {
      yield { text: chunk };
    }
    yield { text: "", raw: response.raw, usage: response.usage, done: true };
  }
}
