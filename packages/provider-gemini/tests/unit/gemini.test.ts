import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMMessage, LLMRequestOptions, LLMProvider } from "@tepa/types";

// Mock the @google/genai SDK before importing the provider
vi.mock("@google/genai", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string = "API error") {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  const mockGenerateContent = vi.fn();

  const MockGoogleGenAI = vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  }));

  return { GoogleGenAI: MockGoogleGenAI, ApiError };
});

import { GoogleGenAI, ApiError } from "@google/genai";
import { GeminiProvider } from "../../src/gemini.js";

function getMockGenerateContent() {
  const instance = new GoogleGenAI({ apiKey: "test" }) as any;
  return instance.models.generateContent as ReturnType<typeof vi.fn>;
}

function makeSuccessResponse(
  text: string,
  promptTokens = 10,
  candidateTokens = 20,
  finishReason = "STOP",
) {
  return {
    text,
    candidates: [{ finishReason }],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidateTokens,
    },
  };
}

describe("GeminiProvider", () => {
  let provider: GeminiProvider;
  let mockGenerateContent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiProvider({ apiKey: "test-key" });
    mockGenerateContent = getMockGenerateContent();
  });

  describe("interface compliance", () => {
    it("implements LLMProvider interface", () => {
      const _check: LLMProvider = provider;
      expect(_check.complete).toBeTypeOf("function");
    });
  });

  describe("complete", () => {
    it("sends correct parameters to Gemini API", async () => {
      mockGenerateContent.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
      const options: LLMRequestOptions = {
        model: "gemini-2.0-pro",
        maxTokens: 1024,
        temperature: 0.7,
        systemPrompt: "You are helpful.",
      };

      await provider.complete(messages, options);

      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: "gemini-2.0-pro",
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        config: {
          maxOutputTokens: 1024,
          temperature: 0.7,
          systemInstruction: "You are helpful.",
        },
      });
    });

    it("uses default model when not specified", async () => {
      mockGenerateContent.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "" },
      );

      const callArgs = mockGenerateContent.mock.calls[0]![0];
      expect(callArgs.model).toBe("gemini-3-flash-preview");
    });

    it("uses default maxOutputTokens when not specified", async () => {
      mockGenerateContent.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      const callArgs = mockGenerateContent.mock.calls[0]![0];
      expect(callArgs.config.maxOutputTokens).toBe(64_000);
    });

    it("omits temperature when not provided", async () => {
      mockGenerateContent.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      const callArgs = mockGenerateContent.mock.calls[0]![0];
      expect(callArgs.config.temperature).toBeUndefined();
    });

    it("omits systemInstruction when systemPrompt is not provided", async () => {
      mockGenerateContent.mockResolvedValueOnce(makeSuccessResponse("Hello"));

      await provider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      const callArgs = mockGenerateContent.mock.calls[0]![0];
      expect(callArgs.config.systemInstruction).toBeUndefined();
    });

    it("returns correctly formatted LLMResponse", async () => {
      mockGenerateContent.mockResolvedValueOnce(
        makeSuccessResponse("The answer is 42", 15, 25),
      );

      const result = await provider.complete(
        [{ role: "user", content: "What is the meaning of life?" }],
        { model: "gemini-3-flash-preview" },
      );

      expect(result).toEqual({
        text: "The answer is 42",
        tokensUsed: { input: 15, output: 25 },
        finishReason: "end_turn",
      });
    });

    it("handles MAX_TOKENS finish reason", async () => {
      mockGenerateContent.mockResolvedValueOnce(
        makeSuccessResponse("Truncated response", 10, 100, "MAX_TOKENS"),
      );

      const result = await provider.complete(
        [{ role: "user", content: "Tell me a long story" }],
        { model: "gemini-3-flash-preview" },
      );

      expect(result.finishReason).toBe("max_tokens");
    });

    it("handles multi-turn conversations with assistant→model mapping", async () => {
      mockGenerateContent.mockResolvedValueOnce(makeSuccessResponse("6"));

      const messages: LLMMessage[] = [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And 3+3?" },
      ];

      await provider.complete(messages, { model: "gemini-3-flash-preview" });

      const callArgs = mockGenerateContent.mock.calls[0]![0];
      expect(callArgs.contents).toEqual([
        { role: "user", parts: [{ text: "What is 2+2?" }] },
        { role: "model", parts: [{ text: "4" }] },
        { role: "user", parts: [{ text: "And 3+3?" }] },
      ]);
    });
  });

  describe("retry logic", () => {
    it("retries on 429 rate limit errors", async () => {
      const rateLimitError = new ApiError(429, "rate limited");
      mockGenerateContent
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new GeminiProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      expect(result.text).toBe("Success");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("retries on 500 server errors", async () => {
      const serverError = new ApiError(500, "internal server error");
      mockGenerateContent
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new GeminiProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      expect(result.text).toBe("Success");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("retries on 503 service unavailable errors", async () => {
      const unavailableError = new ApiError(503, "service unavailable");
      mockGenerateContent
        .mockRejectedValueOnce(unavailableError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new GeminiProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      expect(result.text).toBe("Success");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("retries on TypeError (network failures)", async () => {
      const networkError = new TypeError("fetch failed");
      mockGenerateContent
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(makeSuccessResponse("Success"));

      const fastProvider = new GeminiProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      const result = await fastProvider.complete(
        [{ role: "user", content: "Hi" }],
        { model: "gemini-3-flash-preview" },
      );

      expect(result.text).toBe("Success");
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 401 authentication errors", async () => {
      const authError = new ApiError(401, "invalid api key");
      mockGenerateContent.mockRejectedValue(authError);

      const fastProvider = new GeminiProvider({
        apiKey: "bad-key",
        retryBaseDelayMs: 1,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "gemini-3-flash-preview" },
        ),
      ).rejects.toThrow();

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 400 bad request errors", async () => {
      const badRequestError = new ApiError(400, "bad request");
      mockGenerateContent.mockRejectedValue(badRequestError);

      const fastProvider = new GeminiProvider({
        apiKey: "test-key",
        retryBaseDelayMs: 1,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "gemini-3-flash-preview" },
        ),
      ).rejects.toThrow();

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting all retries", async () => {
      const rateLimitError = new ApiError(429, "rate limited");
      mockGenerateContent.mockRejectedValue(rateLimitError);

      const fastProvider = new GeminiProvider({
        apiKey: "test-key",
        maxRetries: 2,
        retryBaseDelayMs: 1,
      });

      await expect(
        fastProvider.complete(
          [{ role: "user", content: "Hi" }],
          { model: "gemini-3-flash-preview" },
        ),
      ).rejects.toThrow();

      // 1 initial + 2 retries = 3
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });
  });
});
