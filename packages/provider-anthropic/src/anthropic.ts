import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";
import { toAnthropicMessages, toFinishReason, extractText } from "./formatting.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4096;
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

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
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

        const delay = this.retryBaseDelayMs * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
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
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
