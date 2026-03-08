import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LLMMessage, LLMRequestOptions, LLMResponse, LLMLogEntry } from "@tepa/types";
import { BaseLLMProvider, type BaseLLMProviderOptions } from "../../src/base-provider.js";

class TestProvider extends BaseLLMProvider {
  protected readonly providerName = "test";

  doCompleteFn = vi.fn<(messages: LLMMessage[], options: LLMRequestOptions) => Promise<LLMResponse>>();
  isRetryableFn = vi.fn<(error: unknown) => boolean>().mockReturnValue(false);
  getRetryAfterMsFn = vi.fn<(error: unknown) => number | null>().mockReturnValue(null);
  isRateLimitErrorFn = vi.fn<(error: unknown) => boolean>().mockReturnValue(false);

  constructor(options: BaseLLMProviderOptions = {}) {
    super(options);
  }

  protected async doComplete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse> {
    return this.doCompleteFn(messages, options);
  }

  protected isRetryable(error: unknown): boolean {
    return this.isRetryableFn(error);
  }

  protected getRetryAfterMs(error: unknown): number | null {
    return this.getRetryAfterMsFn(error);
  }

  protected isRateLimitError(error: unknown): boolean {
    return this.isRateLimitErrorFn(error);
  }
}

const testMessages: LLMMessage[] = [{ role: "user", content: "Hello" }];
const testOptions: LLMRequestOptions = { model: "test-model" };
const testResponse: LLMResponse = {
  text: "Hi there",
  tokensUsed: { input: 10, output: 20 },
  finishReason: "end_turn",
};

describe("BaseLLMProvider", () => {
  let provider: TestProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new TestProvider({ defaultLog: false, retryBaseDelayMs: 1 });
    provider.doCompleteFn.mockResolvedValue(testResponse);
  });

  describe("complete", () => {
    it("delegates to doComplete and returns response", async () => {
      const result = await provider.complete(testMessages, testOptions);
      expect(result).toEqual(testResponse);
      expect(provider.doCompleteFn).toHaveBeenCalledWith(testMessages, testOptions);
    });

    it("retries on retryable errors", async () => {
      const error = new Error("transient");
      provider.doCompleteFn
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(testResponse);
      provider.isRetryableFn.mockReturnValue(true);

      const result = await provider.complete(testMessages, testOptions);
      expect(result).toEqual(testResponse);
      expect(provider.doCompleteFn).toHaveBeenCalledTimes(2);
    });

    it("throws non-retryable errors immediately", async () => {
      const error = new Error("fatal");
      provider.doCompleteFn.mockRejectedValue(error);
      provider.isRetryableFn.mockReturnValue(false);

      await expect(provider.complete(testMessages, testOptions)).rejects.toThrow("fatal");
      expect(provider.doCompleteFn).toHaveBeenCalledTimes(1);
    });

    it("throws after exhausting retries", async () => {
      const error = new Error("persistent");
      provider.doCompleteFn.mockRejectedValue(error);
      provider.isRetryableFn.mockReturnValue(true);

      const p = new TestProvider({ defaultLog: false, retryBaseDelayMs: 1, maxRetries: 2 });
      p.doCompleteFn.mockRejectedValue(error);
      p.isRetryableFn.mockReturnValue(true);

      await expect(p.complete(testMessages, testOptions)).rejects.toThrow("persistent");
      expect(p.doCompleteFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });

  describe("logging", () => {
    it("logs success entries", async () => {
      await provider.complete(testMessages, testOptions);

      const entries = provider.getLogEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.status).toBe("success");
      expect(entries[0]!.provider).toBe("test");
      expect(entries[0]!.attempt).toBe(0);
      expect(entries[0]!.response).toBeDefined();
      expect(entries[0]!.response!.text).toBe("Hi there");
      expect(entries[0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("logs retry and then success entries", async () => {
      const error = new Error("transient");
      provider.doCompleteFn
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(testResponse);
      provider.isRetryableFn.mockReturnValue(true);

      await provider.complete(testMessages, testOptions);

      const entries = provider.getLogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]!.status).toBe("retry");
      expect(entries[0]!.attempt).toBe(0);
      expect(entries[0]!.error).toBeDefined();
      expect(entries[0]!.error!.retryable).toBe(true);
      expect(entries[1]!.status).toBe("success");
      expect(entries[1]!.attempt).toBe(1);
    });

    it("logs error entries on non-retryable failure", async () => {
      provider.doCompleteFn.mockRejectedValue(new Error("fatal"));
      provider.isRetryableFn.mockReturnValue(false);

      await expect(provider.complete(testMessages, testOptions)).rejects.toThrow();

      const entries = provider.getLogEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.status).toBe("error");
      expect(entries[0]!.error!.retryable).toBe(false);
    });

    it("calls onLog callbacks", async () => {
      const callback = vi.fn();
      provider.onLog(callback);

      await provider.complete(testMessages, testOptions);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0]![0].status).toBe("success");
    });

    it("returns a copy of log entries", async () => {
      await provider.complete(testMessages, testOptions);

      const entries1 = provider.getLogEntries();
      const entries2 = provider.getLogEntries();
      expect(entries1).not.toBe(entries2);
      expect(entries1).toEqual(entries2);
    });

    it("includes request metadata in log entries", async () => {
      await provider.complete(testMessages, { model: "test-model", maxTokens: 100, temperature: 0.5, systemPrompt: "Be helpful" });

      const entry = provider.getLogEntries()[0]!;
      expect(entry.request.model).toBe("test-model");
      expect(entry.request.messageCount).toBe(1);
      expect(entry.request.totalCharLength).toBe(5); // "Hello"
      expect(entry.request.maxTokens).toBe(100);
      expect(entry.request.temperature).toBe(0.5);
      expect(entry.request.hasSystemPrompt).toBe(true);
    });

    it("includes promptPreview from last user message", async () => {
      const messages: LLMMessage[] = [
        { role: "user", content: "First message" },
        { role: "assistant", content: "Response" },
        { role: "user", content: "Generate a REST API client for the weather service" },
      ];
      await provider.complete(messages, testOptions);

      const entry = provider.getLogEntries()[0]!;
      expect(entry.request.promptPreview).toBe("Generate a REST API client for the weather service");
    });

    it("truncates long promptPreview with ellipsis", async () => {
      const longContent = "A".repeat(200);
      const messages: LLMMessage[] = [{ role: "user", content: longContent }];
      await provider.complete(messages, testOptions);

      const entry = provider.getLogEntries()[0]!;
      expect(entry.request.promptPreview.length).toBeLessThanOrEqual(123); // 120 + "..."
      expect(entry.request.promptPreview).toMatch(/\.\.\.$/);
    });
  });

  describe("defaultLog option", () => {
    it("calls console.log by default with header, prompt, and response", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const p = new TestProvider(); // defaultLog defaults to true
      p.doCompleteFn.mockResolvedValue(testResponse);

      await p.complete(testMessages, testOptions);

      // 3 lines: header, prompt preview (→), response preview (←)
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      expect(consoleSpy.mock.calls[0]![0]).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[success\]\[test\]/);
      expect(consoleSpy.mock.calls[1]![0]).toMatch(/→.*Hello/);
      expect(consoleSpy.mock.calls[2]![0]).toMatch(/←.*Hi there/);
      consoleSpy.mockRestore();
    });

    it("suppresses console.log when defaultLog is false", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await provider.complete(testMessages, testOptions); // provider has defaultLog: false

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("includeContent option", () => {
    it("excludes messages by default", async () => {
      await provider.complete(testMessages, { model: "test-model", systemPrompt: "sys" });

      const entry = provider.getLogEntries()[0]!;
      expect(entry.request.messages).toBeUndefined();
      expect(entry.request.systemPrompt).toBeUndefined();
    });

    it("includes messages when includeContent is true", async () => {
      const p = new TestProvider({ defaultLog: false, includeContent: true });
      p.doCompleteFn.mockResolvedValue(testResponse);

      await p.complete(testMessages, { model: "test-model", systemPrompt: "sys" });

      const entry = p.getLogEntries()[0]!;
      expect(entry.request.messages).toEqual(testMessages);
      expect(entry.request.systemPrompt).toBe("sys");
    });
  });

  describe("retry delay computation", () => {
    it("uses retry-after when available", async () => {
      const error = new Error("rate limited");
      provider.doCompleteFn
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(testResponse);
      provider.isRetryableFn.mockReturnValue(true);
      provider.getRetryAfterMsFn.mockReturnValue(500);

      const start = Date.now();
      await provider.complete(testMessages, testOptions);
      const elapsed = Date.now() - start;

      // Should have waited ~500ms from retry-after
      expect(elapsed).toBeGreaterThanOrEqual(400);
    });

    it("uses exponential backoff for non-rate-limit errors", async () => {
      const p = new TestProvider({ defaultLog: false, retryBaseDelayMs: 50, maxRetries: 1 });
      const error = new Error("transient");
      p.doCompleteFn
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(testResponse);
      p.isRetryableFn.mockReturnValue(true);

      const start = Date.now();
      await p.complete(testMessages, testOptions);
      const elapsed = Date.now() - start;

      // Base delay * 2^0 = 50ms
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});
