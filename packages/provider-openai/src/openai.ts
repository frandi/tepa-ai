import OpenAI from "openai";
import type { LLMMessage, LLMRequestOptions, LLMResponse, ModelInfo } from "@tepa/types";
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import {
  toOpenAIInput,
  toOpenAITools,
  toFinishReason,
  extractText,
  extractToolUse,
  type ResponseOutput,
} from "./formatting.js";
import { OPENAI_MODEL_CATALOG } from "./models.js";

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_MAX_TOKENS = 64_000;

export interface OpenAIProviderOptions extends BaseLLMProviderOptions {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env variable. */
  apiKey?: string;
}

/** LLM provider implementation for OpenAI models using the Responses API. */
export class OpenAIProvider extends BaseLLMProvider {
  protected readonly providerName = "openai";
  protected readonly models: ModelInfo[] = OPENAI_MODEL_CATALOG;
  private readonly client: OpenAI;

  constructor(options: OpenAIProviderOptions = {}) {
    super(options);
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: 15 * 60 * 1000, // 15 minutes – pipeline calls can be long
    });
  }

  protected async doComplete(
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

    if (options.tools && options.tools.length > 0) {
      params.tools = toOpenAITools(options.tools);
    }

    const response = await (
      this.client.responses as unknown as {
        create: (params: Record<string, unknown>) => Promise<{
          output: ResponseOutput[];
          usage: { input_tokens: number; output_tokens: number };
          status: string;
        }>;
      }
    ).create(params);

    const toolUse = extractToolUse(response.output);
    const hasToolUse = toolUse.length > 0;

    return {
      text: extractText(response.output),
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      finishReason: hasToolUse ? "tool_use" : toFinishReason(response.status),
      ...(hasToolUse && { toolUse }),
    };
  }

  protected mapError(error: unknown): unknown {
    if (error instanceof OpenAI.AuthenticationError) {
      return new Error(
        "Authentication failed. Did you set the OPENAI_API_KEY environment variable?",
        { cause: error },
      );
    }
    return error;
  }

  protected isRetryable(error: unknown): boolean {
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

  protected getRetryAfterMs(error: unknown): number | null {
    if (error instanceof OpenAI.APIError) {
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
    return error instanceof OpenAI.RateLimitError;
  }
}
