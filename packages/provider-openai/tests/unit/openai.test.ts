import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMMessage, LLMRequestOptions, LLMProvider } from "@tepa/types";

// Mock the OpenAI SDK before importing the provider
vi.mock("openai", () => {
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

  const MockOpenAI = Object.assign(
    vi.fn().mockImplementation(() => ({
      responses: { create: mockCreate },
    })),
    { APIError, RateLimitError, InternalServerError, APIConnectionError, AuthenticationError },
  );

  return { default: MockOpenAI };
});

import OpenAI from "openai";
import { OpenAIProvider } from "../../src/openai.js";

function getMockCreate() {
  const instance = new OpenAI() as any;
  return instance.responses.create as ReturnType<typeof vi.fn>;
}

function makeSuccessResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    status: "completed",
  };
}

describe("OpenAIProvider", () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: "test-key", defaultLog: false });
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
    it("sends correct parameters to OpenAI Responses API", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const options: LLMRequestOptions = {
        model: "gpt-4.1",
        maxTokens: 1024,
        temperature: 0.7,
        systemPrompt: "You are helpful.",
      };

      await provider.complete(messages, options);

      expect(mockCreate).toHaveBeenCalledWith({
        model: "gpt-4.1",
        input: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hi" },
        ],
        max_output_tokens: 1024,
        temperature: 0.7,
      });
    });

    it("uses default model and max_output_tokens when not specified", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "" },
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.max_output_tokens).toBe(64_000);
    });

    it("omits temperature when not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4.1" },
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.temperature).toBeUndefined();
    });

    it("omits system message when systemPrompt is not provided", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4.1" },
      );

      const callArgs = mockCreate.mock.calls[0]![0];
      const input = callArgs.input as any[];
      expect(input.every((m: any) => m.role !== "system")).toBe(true);
    });

    it("returns correctly formatted LLMResponse", async () => {
      mockCreate.mockResolvedValueOnce(makeSuccessResponse("The answer is 42", 15, 25));

      const result = await provider.complete(
        [{ role: "user", content: "What is the meaning of life?" }],
        { model: "gpt-4.1" },
      );

      expect(result).toEqual({
        text: "The answer is 42",
        tokensUsed: { input: 15, output: 25 },
        finishReason: "end_turn",
      });
    });

    it("handles incomplete status as max_tokens", async () => {
      mockCreate.mockResolvedValueOnce({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Truncated response" }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 100 },
        status: "incomplete",
      });

      const result = await provider.complete(
        [{ role: "user", content: "Tell me a long story" }],
        { model: "gpt-4.1" },
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

      await provider.complete(messages, { model: "gpt-4.1" });

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.input).toHaveLength(3);
      expect(callArgs.input[2]).toEqual({ role: "user", content: "And 3+3?" });
    });
  });

  describe("retry logic", () => {
    it("retries on rate limit errors", async () => {
      const rateLimitError = new (OpenAI as any).RateLimitError();
      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new OpenAIProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4.1" },
      );

      expect(result.text).toBe("Success");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("retries on internal server errors", async () => {
      const serverError = new (OpenAI as any).InternalServerError();
      mockCreate
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new OpenAIProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4.1" },
      );

      expect(result.text).toBe("Success");
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("retries on connection errors", async () => {
      const connError = new (OpenAI as any).APIConnectionError();
      mockCreate
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new OpenAIProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gpt-4.1" },
      );

      expect(result.text).toBe("Success");
    });

    it("does not retry on authentication errors", async () => {
      const authError = new (OpenAI as any).AuthenticationError();
      mockCreate.mockRejectedValue(authError);

      const fastProvider = new OpenAIProvider({
        apiKey: "bad-key",
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "gpt-4.1" },
        ),
      ).rejects.toThrow();

      // Only 1 attempt, no retries
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting all retries", async () => {
      const rateLimitError = new (OpenAI as any).RateLimitError();
      mockCreate.mockRejectedValue(rateLimitError);

      const fastProvider = new OpenAIProvider({
        apiKey: "test-key",
        maxRetries: 2,
        retryBaseDelayMs: 1,
        defaultLog: false,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "gpt-4.1" },
        ),
      ).rejects.toThrow();

      // 1 initial + 2 retries = 3
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});
