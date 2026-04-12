import { describe, expect, it } from "vitest";
import { readProviderEnv, requireProviderEnv } from "../../src/config/env.js";
import { ProviderRegistry } from "../../src/providers/provider-registry.js";
import { MockProvider } from "../../src/providers/mock-provider.js";

describe("provider registry", () => {
  it("uses mock provider without network access", async () => {
    const registry = new ProviderRegistry("mock");
    registry.register(new MockProvider());

    const response = await registry.generateText({
      messages: [{ role: "user", content: "ping" }]
    });

    expect(response.text).toBe("mock:ping");
  });

  it("validates missing provider API keys clearly", () => {
    const config = readProviderEnv({ CHORUS_PROVIDER: "openai" });
    expect(() => requireProviderEnv(config)).toThrow("Missing OPENAI_API_KEY");
    expect(() => ProviderRegistry.fromEnv(config)).toThrow("Missing OPENAI_API_KEY");
  });

  it("registers real providers when env keys exist", () => {
    const registry = ProviderRegistry.fromEnv({
      provider: "openai",
      model: "test-model",
      openaiApiKey: "sk-test"
    });

    expect(registry.list()).toEqual(expect.arrayContaining(["mock", "openai"]));
  });
});
