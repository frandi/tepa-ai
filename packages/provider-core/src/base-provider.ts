import type {
  LLMProvider,
  LLMMessage,
  LLMRequestOptions,
  LLMResponse,
  LLMLogEntry,
  LLMLogCallback,
} from "@tepa/types";
import { createFileLogWriter } from "./file-log-writer.js";

export interface BaseLLMProviderOptions {
  /** Maximum number of retries on rate limit or transient errors. Default: 3 */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff between retries. Default: 1000 */
  retryBaseDelayMs?: number;
  /** Enable default file logger. Default: true. Set false to disable. */
  defaultLog?: boolean;
  /** Directory for log files. Default: ".tepa/logs" relative to cwd. */
  logDir?: string;
  /** Include full message content in log entries. Default: false */
  includeContent?: boolean;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const RATE_LIMIT_DELAY_MULTIPLIER = 30;
const PREVIEW_MAX_LENGTH = 120;

export abstract class BaseLLMProvider implements LLMProvider {
  protected readonly maxRetries: number;
  protected readonly retryBaseDelayMs: number;
  private readonly includeContent: boolean;
  private readonly logCallbacks: LLMLogCallback[] = [];
  private readonly logHistory: LLMLogEntry[] = [];
  private readonly _logFilePath?: string;

  constructor(options: BaseLLMProviderOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.includeContent = options.includeContent ?? false;

    if (options.defaultLog !== false) {
      const writer = createFileLogWriter(options.logDir);
      this._logFilePath = writer.filePath;
      this.logCallbacks.push(writer.callback);
    }
  }

  /** Provider identifier, e.g. "anthropic", "openai", "gemini" */
  protected abstract readonly providerName: string;

  /** Execute the actual API call. Providers implement this without retry logic. */
  protected abstract doComplete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse>;

  /** Return true if the error is retryable. */
  protected abstract isRetryable(error: unknown): boolean;

  /** Extract retry-after delay from error headers, or null if unavailable. */
  protected abstract getRetryAfterMs(error: unknown): number | null;

  /** Return true if the error is a rate limit error (uses longer backoff). */
  protected abstract isRateLimitError(error: unknown): boolean;

  /** Register an additional log listener. */
  onLog(callback: LLMLogCallback): void {
    this.logCallbacks.push(callback);
  }

  /** Get a copy of accumulated log history. */
  getLogEntries(): LLMLogEntry[] {
    return [...this.logHistory];
  }

  /** Get the path to the log file, if file logging is enabled. */
  getLogFilePath(): string | undefined {
    return this._logFilePath;
  }

  async complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse> {
    const requestInfo = this.buildRequestInfo(messages, options);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const start = Date.now();

      try {
        const response = await this.doComplete(messages, options);
        const durationMs = Date.now() - start;

        this.emitLog({
          timestamp: new Date().toISOString(),
          provider: this.providerName,
          status: "success",
          durationMs,
          attempt,
          request: requestInfo,
          response: {
            text: response.text,
            tokensUsed: response.tokensUsed,
            finishReason: response.finishReason,
            ...(response.toolUse && { toolUseCount: response.toolUse.length }),
          },
        });

        return response;
      } catch (error) {
        lastError = error;
        const durationMs = Date.now() - start;
        const retryable = this.isRetryable(error);
        const isLastAttempt = attempt === this.maxRetries;

        if (!retryable || isLastAttempt) {
          this.emitLog({
            timestamp: new Date().toISOString(),
            provider: this.providerName,
            status: "error",
            durationMs,
            attempt,
            request: requestInfo,
            error: {
              message: error instanceof Error ? error.message : String(error),
              retryable,
            },
          });
          throw error;
        }

        this.emitLog({
          timestamp: new Date().toISOString(),
          provider: this.providerName,
          status: "retry",
          durationMs,
          attempt,
          request: requestInfo,
          error: {
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        });

        const delay = this.computeDelay(error, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private buildRequestInfo(messages: LLMMessage[], options: LLMRequestOptions) {
    const totalCharLength = messages.reduce((sum, m) => sum + m.content.length, 0);

    // Build a preview from the last user message (most relevant context)
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    const rawPreview = lastUserMessage?.content ?? options.systemPrompt ?? "";
    const promptPreview = truncate(rawPreview, PREVIEW_MAX_LENGTH);

    const info: LLMLogEntry["request"] = {
      model: options.model,
      messageCount: messages.length,
      totalCharLength,
      promptPreview,
      hasSystemPrompt: !!options.systemPrompt,
    };

    if (options.maxTokens !== undefined) info.maxTokens = options.maxTokens;
    if (options.temperature !== undefined) info.temperature = options.temperature;
    if (options.tools && options.tools.length > 0) info.hasTools = true;

    if (this.includeContent) {
      info.messages = messages;
      if (options.systemPrompt) info.systemPrompt = options.systemPrompt;
    }

    return info;
  }

  private computeDelay(error: unknown, attempt: number): number {
    // Prefer explicit retry-after from the API
    const retryAfter = this.getRetryAfterMs(error);
    if (retryAfter !== null && retryAfter > 0) {
      return retryAfter;
    }

    // Rate limit errors get a longer backoff (30x base delay)
    if (this.isRateLimitError(error)) {
      return this.retryBaseDelayMs * RATE_LIMIT_DELAY_MULTIPLIER * Math.pow(2, attempt);
    }

    return this.retryBaseDelayMs * Math.pow(2, attempt);
  }

  private emitLog(entry: LLMLogEntry): void {
    this.logHistory.push(entry);
    for (const cb of this.logCallbacks) {
      cb(entry);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function truncate(text: string, maxLength: number): string {
  // Collapse whitespace/newlines into single spaces for readable previews
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return collapsed.slice(0, maxLength) + "...";
}
