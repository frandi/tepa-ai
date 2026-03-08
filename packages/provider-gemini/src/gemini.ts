import { GoogleGenAI, ApiError } from "@google/genai";
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";
import { toGeminiContents, toFinishReason, extractText } from "./formatting.js";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_MAX_TOKENS = 64_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface GeminiProviderOptions {
  /** Gemini API key. Falls back to GEMINI_API_KEY or GOOGLE_API_KEY env variables. */
  apiKey?: string;
  /** Maximum number of retries on rate limit or transient errors. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryBaseDelayMs?: number;
}

/** LLM provider implementation for Google Gemini models. */
export class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenAI;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    this.client = new GoogleGenAI({ apiKey });
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const contents = toGeminiContents(messages);

    const config: Record<string, unknown> = {
      maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    if (options.temperature !== undefined) {
      config.temperature = options.temperature;
    }

    if (options.systemPrompt) {
      config.systemInstruction = options.systemPrompt;
    }

    const params = {
      model: options.model || DEFAULT_MODEL,
      contents,
      config,
    };

    const response = await this.executeWithRetry(params);

    const candidates = response.candidates ?? [];
    const finishReason = candidates[0]?.finishReason ?? null;
    const usage = response.usageMetadata ?? {};

    return {
      text: extractText(response),
      tokensUsed: {
        input: usage.promptTokenCount ?? 0,
        output: usage.candidatesTokenCount ?? 0,
      },
      finishReason: toFinishReason(finishReason),
    };
  }

  private async executeWithRetry(params: Record<string, unknown>): Promise<any> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.client.models.generateContent(params as any);
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error) || attempt === this.maxRetries) {
          throw error;
        }

        const delay = this.getRetryDelay(error, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private getRetryDelay(error: unknown, attempt: number): number {
    // For rate limit errors, use a longer base delay to respect per-minute windows
    if (error instanceof ApiError && error.status === 429) {
      return Math.max(30_000, this.retryBaseDelayMs) * Math.pow(2, attempt);
    }

    return this.retryBaseDelayMs * Math.pow(2, attempt);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof ApiError) {
      const status = error.status;
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        return false;
      }
      if (status === 429 || (status !== undefined && status >= 500)) {
        return true;
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
