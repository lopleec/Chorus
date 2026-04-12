import type { ProviderRequest, ProviderResponse, TextProvider } from "../core/types.js";

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
}
