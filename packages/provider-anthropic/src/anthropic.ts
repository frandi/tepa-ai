import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";
import { toAnthropicMessages, toFinishReason, extractText } from "./formatting.js";

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 64_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface AnthropicProviderOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env variable. */
  apiKey?: string;
  /** Maximum number of retries on rate limit or transient errors. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryBaseDelayMs?: number;
}

/** LLM provider implementation for Anthropic Claude models. */
export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
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
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(messages),
    };

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    if (options.systemPrompt) {
      params.system = options.systemPrompt;
    }

    const response = await this.executeWithRetry(params);

    return {
      text: extractText(response.content),
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      finishReason: toFinishReason(response.stop_reason),
    };
  }

  private async executeWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.client.messages.create(params);
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
    // Use retry-after header from rate limit responses when available
    if (error instanceof Anthropic.APIError) {
      const retryAfter = error.headers?.["retry-after"];
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0) {
          return seconds * 1000;
        }
      }
    }

    // For rate limit errors, use a longer base delay (30s) to respect per-minute windows
    if (error instanceof Anthropic.RateLimitError) {
      return Math.max(30_000, this.retryBaseDelayMs) * Math.pow(2, attempt);
    }

    return this.retryBaseDelayMs * Math.pow(2, attempt);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Anthropic.RateLimitError) {
      return true;
    }
    if (error instanceof Anthropic.InternalServerError) {
      return true;
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return true;
    }
    if (error instanceof Anthropic.APIError && error.status === 529) {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
