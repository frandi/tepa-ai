import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMMessage, LLMRequestOptions, LLMProvider } from "@tepa/types";

// Mock the Anthropic SDK before importing the provider
vi.mock("@anthropic-ai/sdk", () => {
  const APIError = class extends Error {
    status: number;
    headers: Record<string, string>;
    constructor(status = 0, message = "api error") {
      super(message);
      this.name = "APIError";
      this.status = status;
      this.headers = {};
    }
  };
  const RateLimitError = class extends APIError {
    constructor() {
      super(429, "rate limited");
      this.name = "RateLimitError";
    }
  };
  const InternalServerError = class extends APIError {
    constructor() {
      super(500, "internal server error");
      this.name = "InternalServerError";
    }
  };
  const APIConnectionError = class extends Error {
    constructor() {
      super("connection error");
      this.name = "APIConnectionError";
    }
  };
  const AuthenticationError = class extends APIError {
    constructor() {
      super(401, "invalid api key");
      this.name = "AuthenticationError";
    }
  };

  const mockCreate = vi.fn();

  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));

  // Attach error classes as static properties
  MockAnthropic.APIError = APIError;
  MockAnthropic.RateLimitError = RateLimitError;
  MockAnthropic.InternalServerError = InternalServerError;
  MockAnthropic.APIConnectionError = APIConnectionError;
  MockAnthropic.AuthenticationError = AuthenticationError;

  return { default: MockAnthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../src/anthropic.js";

function getMockCreate() {
  const instance = new Anthropic() as unknown as { messages: { create: ReturnType<typeof vi.fn> } };
  return instance.messages.create;
}

function makeSuccessResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    stop_reason: "end_turn",
  };
}

describe("AnthropicProvider", () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({ apiKey: "test-key", defaultLog: false });
    mockCreate = getMockCreate();
    mockCreate.mockReset();
  });

  describe("interface compliance", () => {
    it("implements LLMProvider interface", () => {
      const _check: LLMProvider = provider;
      expect(_check.complete).toBeTypeOf("function");
    });
  });

  describe("complete", () => {
    it("sends correct parameters to Anthropic API", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const options: LLMRequestOptions = {
        model: "claude-sonnet-4-20250514",
        maxTokens: 1024,
        temperature: 0.7,
        systemPrompt: "You are helpful.",
      };

      await provider.complete(messages, options);

      expect(mockCreate).toHaveBeenCalledWith({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        temperature: 0.7,
        system: "You are helpful.",
        messages: [{ role: "user", content: "Hi" }],
      });
    });

    it("uses default model and max_tokens when not specified", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete([{ role: "user", content: "Hi" }], { model: "" });

      const callArgs = mockCreate.mock.calls[0]![0];
      // When model is empty string, falls through to the empty string
      // The defaults are used when undefined
      expect(callArgs.max_tokens).toBe(64_000);
    });

    it("omits temperature when not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete([{ role: "user", content: "Hi" }], {
        model: "claude-sonnet-4-20250514",
      });

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.temperature).toBeUndefined();
    });

    it("omits system when systemPrompt is not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete([{ role: "user", content: "Hi" }], {
        model: "claude-sonnet-4-20250514",
      });

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.system).toBeUndefined();
    });

    it("returns correctly formatted LLMResponse", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("The answer is 42", 15, 25));

      const result = await provider.complete(
        [{ role: "user", content: "What is the meaning of life?" }],
        { model: "claude-sonnet-4-20250514" },
      );

      expect(result).toEqual({
        text: "The answer is 42",
        tokensUsed: { input: 15, output: 25 },
        finishReason: "end_turn",
      });
    });

    it("handles max_tokens finish reason", async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Truncated response" }],
        usage: { input_tokens: 10, output_tokens: 100 },
        stop_reason: "max_tokens",
      });

      const result = await provider.complete([{ role: "user", content: "Tell me a long story" }], {
        model: "claude-sonnet-4-20250514",
      });

      expect(result.finishReason).toBe("max_tokens");
    });

    it("handles multi-turn conversations", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("6"));

      const messages: LLMMessage[] = [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ];

      await provider.complete(messages, { model: "claude-sonnet-4-20250514" });

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.messages).toHaveLength(3);
      expect(callArgs.messages[2]).toEqual({ role: "user", content: "And 3+3?" });
    });
  });

  describe("retry logic", () => {
    it("retries on rate limit errors", async () => {
      const rateLimitError = new (
        Anthropic as unknown as Record<string, new () => Error>
      ).RateLimitError();
      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      // Use short retry delay for tests
      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      const result = await fastProvider.complete([{ role: "user", content: "Hi" }], {
        model: "claude-sonnet-4-20250514",
      });

      expect(result.text).toBe("Success");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("retries on internal server errors", async () => {
      const serverError = new (
        Anthropic as unknown as Record<string, new () => Error>
      ).InternalServerError();
      mockCreate
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      const result = await fastProvider.complete([{ role: "user", content: "Hi" }], {
        model: "claude-sonnet-4-20250514",
      });

      expect(result.text).toBe("Success");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("retries on connection errors", async () => {
      const connError = new (
        Anthropic as unknown as Record<string, new () => Error>
      ).APIConnectionError();
      mockCreate
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      const result = await fastProvider.complete([{ role: "user", content: "Hi" }], {
        model: "claude-sonnet-4-20250514",
      });

      expect(result.text).toBe("Success");
    });

    it("does not retry on authentication errors and provides helpful message", async () => {
      const authError = new (
        Anthropic as unknown as Record<string, new () => Error>
      ).AuthenticationError();
      mockCreate.mockRejectedValue(authError);

      const fastProvider = new AnthropicProvider({
        apiKey: "bad-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      await expect(
        fastProvider.complete([{ role: "user", content: "Hi" }], {
          model: "claude-sonnet-4-20250514",
        }),
      ).rejects.toThrow("Did you set the ANTHROPIC_API_KEY environment variable?");

      // Only 1 attempt, no retries
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("provides helpful message when no API key is configured at all", async () => {
      const noKeyError = new Error(
        "Could not resolve authentication method. Expected either apiKey or authToken to be set.",
      );
      mockCreate.mockRejectedValue(noKeyError);

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      await expect(
        fastProvider.complete([{ role: "user", content: "Hi" }], {
          model: "claude-sonnet-4-20250514",
        }),
      ).rejects.toThrow("No Anthropic API key configured.");

      await expect(
        fastProvider.complete([{ role: "user", content: "Hi" }], {
          model: "claude-sonnet-4-20250514",
        }),
      ).rejects.toThrow("Create a .env file with: ANTHROPIC_API_KEY=sk-ant-");
    });

    it("throws after exhausting all retries", async () => {
      const rateLimitError = new (
        Anthropic as unknown as Record<string, new () => Error>
      ).RateLimitError();
      mockCreate.mockRejectedValue(rateLimitError);

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        maxRetries: 2,
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      await expect(
        fastProvider.complete([{ role: "user", content: "Hi" }], {
          model: "claude-sonnet-4-20250514",
        }),
      ).rejects.toThrow();

      // 1 initial + 2 retries = 3
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe("getModels", () => {
    it("returns the Anthropic model catalog", () => {
      const models = provider.getModels();
      expect(models.length).toBeGreaterThanOrEqual(3);

      const ids = models.map((m) => m.id);
      expect(ids).toContain("claude-haiku-4-5");
      expect(ids).toContain("claude-sonnet-4-6");
      expect(ids).toContain("claude-opus-4-6");
    });

    it("returns models with valid tier and description", () => {
      const models = provider.getModels();
      const validTiers = ["fast", "balanced", "advanced"];
      for (const m of models) {
        expect(validTiers).toContain(m.tier);
        expect(m.description.length).toBeGreaterThan(0);
        expect(m.id.length).toBeGreaterThan(0);
      }
    });
  });
});
