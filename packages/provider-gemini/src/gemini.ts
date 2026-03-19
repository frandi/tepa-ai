import { GoogleGenAI, ApiError } from "@google/genai";
import type { LLMMessage, LLMRequestOptions, LLMResponse, ModelInfo } from "@tepa/types";
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import {
  toGeminiContents,
  toGeminiTools,
  toFinishReason,
  extractText,
  extractToolUse,
} from "./formatting.js";
import { GEMINI_MODEL_CATALOG } from "./models.js";

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_MAX_TOKENS = 64_000;

export interface GeminiProviderOptions extends BaseLLMProviderOptions {
  /** Gemini API key. Falls back to GEMINI_API_KEY or GOOGLE_API_KEY env variables. */
  apiKey?: string;
}

/** LLM provider implementation for Google Gemini models. */
export class GeminiProvider extends BaseLLMProvider {
  protected readonly providerName = "gemini";
  protected readonly models: ModelInfo[] = GEMINI_MODEL_CATALOG;
  private readonly client: GoogleGenAI;

  constructor(options: GeminiProviderOptions = {}) {
    super(options);
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    this.client = new GoogleGenAI({ apiKey });
  }

  protected async doComplete(
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

    const params: Record<string, unknown> = {
      model: options.model || DEFAULT_MODEL,
      contents,
      config,
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = toGeminiTools(options.tools);
    }

    const response = await this.client.models.generateContent(
      params as unknown as Parameters<typeof this.client.models.generateContent>[0],
    );

    const candidates = response.candidates ?? [];
    const finishReason = candidates[0]?.finishReason ?? null;
    const usage = response.usageMetadata ?? {};

    const toolUse = extractToolUse(response as unknown as Record<string, unknown>);
    const hasToolUse = toolUse.length > 0;

    return {
      text: extractText(response),
      tokensUsed: {
        input: usage.promptTokenCount ?? 0,
        output: usage.candidatesTokenCount ?? 0,
      },
      finishReason: hasToolUse ? "tool_use" : toFinishReason(finishReason),
      ...(hasToolUse && { toolUse }),
    };
  }

  protected mapError(error: unknown): unknown {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return new Error(
        "Authentication failed. Did you set the GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable?",
        { cause: error },
      );
    }
    return error;
  }

  protected isRetryable(error: unknown): boolean {
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

  protected getRetryAfterMs(_error: unknown): number | null {
    return null;
  }

  protected isRateLimitError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 429;
  }
}
