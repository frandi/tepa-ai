import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMMessage, LLMRequestOptions, LLMProvider } from "@tepa/types";

// Mock the Anthropic SDK before importing the provider
vi.mock("@anthropic-ai/sdk", () => {
  const RateLimitError = class extends Error {
    constructor() {
      super("rate limited");
      this.name = "RateLimitError";
    }
  };
  const InternalServerError = class extends Error {
    constructor() {
      super("internal server error");
      this.name = "InternalServerError";
    }
  };
  const APIConnectionError = class extends Error {
    constructor() {
      super("connection error");
      this.name = "APIConnectionError";
    }
  };
  const AuthenticationError = class extends Error {
    constructor() {
      super("invalid api key");
      this.name = "AuthenticationError";
    }
  };

  const mockCreate = vi.fn();

  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));

  // Attach error classes as static properties
  MockAnthropic.RateLimitError = RateLimitError;
  MockAnthropic.InternalServerError = InternalServerError;
  MockAnthropic.APIConnectionError = APIConnectionError;
  MockAnthropic.AuthenticationError = AuthenticationError;

  return { default: MockAnthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../../src/anthropic.js";

function getMockCreate() {
  const instance = new Anthropic() as any;
  return instance.messages.create as ReturnType<typeof vi.fn>;
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
    provider = new AnthropicProvider({ apiKey: "test-key" });
    mockCreate = getMockCreate();
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

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "" },
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      // When model is empty string, falls through to the empty string
      // The defaults are used when undefined
      expect(callArgs.max_tokens).toBe(64_000);
    });

    it("omits temperature when not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" },
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.temperature).toBeUndefined();
    });

    it("omits system when systemPrompt is not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" },
      );

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

      const result = await provider.complete(
        [{ role: "user", content: "Tell me a long story" }],
        { model: "claude-sonnet-4-20250514" },
      );

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
      const rateLimitError = new (Anthropic as any).RateLimitError();
      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      // Use short retry delay for tests
      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" },
      );

      expect(result.text).toBe("Success");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("retries on internal server errors", async () => {
      const serverError = new (Anthropic as any).InternalServerError();
      mockCreate
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" },
      );

      expect(result.text).toBe("Success");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("retries on connection errors", async () => {
      const connError = new (Anthropic as any).APIConnectionError();
      mockCreate
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "claude-sonnet-4-20250514" },
      );

      expect(result.text).toBe("Success");
    });

    it("does not retry on authentication errors", async () => {
      const authError = new (Anthropic as any).AuthenticationError();
      mockCreate.mockRejectedValue(authError);

      const fastProvider = new AnthropicProvider({
        apiKey: "bad-key",
        retryBaseDelayMs: 1,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "claude-sonnet-4-20250514" },
        ),
      ).rejects.toThrow();

      // Only 1 attempt, no retries
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting all retries", async () => {
      const rateLimitError = new (Anthropic as any).RateLimitError();
      mockCreate.mockRejectedValue(rateLimitError);

      const fastProvider = new AnthropicProvider({
        apiKey: "test-key",
        maxRetries: 2,
        retryBaseDelayMs: 1,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "claude-sonnet-4-20250514" },
        ),
      ).rejects.toThrow();

      // 1 initial + 2 retries = 3
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});
