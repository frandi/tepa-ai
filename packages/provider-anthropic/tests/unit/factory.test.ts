import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  }));
  MockAnthropic.RateLimitError = class extends Error {};
  MockAnthropic.InternalServerError = class extends Error {};
  MockAnthropic.APIConnectionError = class extends Error {};
  MockAnthropic.AuthenticationError = class extends Error {};
  return { default: MockAnthropic };
});

import { createProvider } from "../../src/factory.js";
import { AnthropicProvider } from "../../src/anthropic.js";

describe("createProvider", () => {
  it('creates AnthropicProvider for "anthropic"', () => {
    const provider = createProvider("anthropic", { apiKey: "test-key" });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("passes options to the provider", () => {
    const provider = createProvider("anthropic", {
      apiKey: "my-key",
      maxRetries: 5,
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("throws for unknown provider name", () => {
    // @ts-expect-error testing invalid input
    expect(() => createProvider("openai")).toThrow("Unknown provider");
  });
});
