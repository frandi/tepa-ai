import OpenAI from "openai";
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";
import { toOpenAIInput, toFinishReason, extractText } from "./formatting.js";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_MAX_TOKENS = 64_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface OpenAIProviderOptions {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env variable. */
  apiKey?: string;
  /** Maximum number of retries on rate limit or transient errors. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryBaseDelayMs?: number;
}

/** LLM provider implementation for OpenAI models using the Responses API. */
export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: OpenAIProviderOptions = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: 15 * 60 * 1000, // 15 minutes – pipeline calls can be long
    });
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const input = toOpenAIInput(messages, options.systemPrompt);

    const params: Record<string, unknown> = {
      model: options.model ?? DEFAULT_MODEL,
      input,
      max_output_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    const response = await this.executeWithRetry(params);

    return {
      text: extractText(response.output),
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      finishReason: toFinishReason(response.status),
    };
  }

  private async executeWithRetry(
    params: Record<string, unknown>,
  ): Promise<any> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await (this.client.responses as any).create(params);
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
    if (error instanceof OpenAI.APIError) {
      const retryAfter = error.headers?.["retry-after"];
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0) {
          return seconds * 1000;
        }
      }
    }

    if (error instanceof OpenAI.RateLimitError) {
      return Math.max(30_000, this.retryBaseDelayMs) * Math.pow(2, attempt);
    }

    return this.retryBaseDelayMs * Math.pow(2, attempt);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.RateLimitError) {
      return true;
    }
    if (error instanceof OpenAI.InternalServerError) {
      return true;
    }
    if (error instanceof OpenAI.APIConnectionError) {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
