import Anthropic from "@anthropic-ai/sdk";
import type { LLMMessage, LLMRequestOptions, LLMResponse, ModelInfo } from "@tepa/types";
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import {
  toAnthropicMessages,
  toAnthropicTools,
  toFinishReason,
  extractText,
  extractToolUse,
} from "./formatting.js";
import { ANTHROPIC_MODEL_CATALOG } from "./models.js";

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 64_000;

export interface AnthropicProviderOptions extends BaseLLMProviderOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env variable. */
  apiKey?: string;
}

/** LLM provider implementation for Anthropic Claude models. */
export class AnthropicProvider extends BaseLLMProvider {
  protected readonly providerName = "anthropic";
  protected readonly models: ModelInfo[] = ANTHROPIC_MODEL_CATALOG;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions = {}) {
    super(options);
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: 15 * 60 * 1000, // 15 minutes – pipeline calls can be long
    });
  }

  protected async doComplete(
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

    if (options.tools && options.tools.length > 0) {
      params.tools = toAnthropicTools(options.tools);
    }

    const response = await this.client.messages.create(params);

    const toolUse = extractToolUse(response.content);

    return {
      text: extractText(response.content),
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      finishReason: toFinishReason(response.stop_reason),
      ...(toolUse.length > 0 && { toolUse }),
    };
  }

  protected mapError(error: unknown): unknown {
    if (error instanceof Anthropic.AuthenticationError) {
      return new Error("Anthropic authentication failed: the provided API key is invalid.", {
        cause: error,
      });
    }
    // The SDK throws a generic Error when no API key is configured at all
    if (
      error instanceof Error &&
      error.message.includes("Could not resolve authentication method")
    ) {
      return new Error("No Anthropic API key configured.", { cause: error });
    }
    return error;
  }

  protected isRetryable(error: unknown): boolean {
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

  protected getRetryAfterMs(error: unknown): number | null {
    if (error instanceof Anthropic.APIError) {
      const retryAfter = error.headers?.["retry-after"];
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0) {
          return seconds * 1000;
        }
      }
    }
    return null;
  }

  protected isRateLimitError(error: unknown): boolean {
    return error instanceof Anthropic.RateLimitError;
  }
}
