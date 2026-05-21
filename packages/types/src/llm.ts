import type { ToolSchema } from "./tool.js";

/**
 * Per-token pricing for a model, expressed as cost per 1,000,000 tokens.
 *
 * Pricing data shipped by provider packages is best-effort and may go stale;
 * callers can override via observability tooling (e.g.
 * `@tepa/observability-llmvantage`).
 */
export interface ModelPricing {
  /** Cost per 1M input tokens. */
  inputPer1M: number;
  /** Cost per 1M output tokens. */
  outputPer1M: number;
  /** Cost per 1M cached input tokens (prompt cache reads). */
  cacheReadPer1M?: number;
  /** Cost per 1M cache-creation tokens (e.g. Anthropic prompt cache writes). */
  cacheWritePer1M?: number;
  /** ISO 4217 currency code. Defaults to "USD" when omitted. */
  currency?: string;
}

/** Metadata describing a model available from a provider. */
export interface ModelInfo {
  /** Model identifier as passed to provider API (e.g. "claude-sonnet-4-6"). */
  id: string;
  /** Human-readable description for the planner prompt. */
  description: string;
  /** Capability tier: helps the planner pick appropriate models per step. */
  tier: "fast" | "balanced" | "advanced";
  /** Optional list of capabilities (e.g. "tool_use", "vision", "long_context"). */
  capabilities?: string[];
  /**
   * Optional per-token pricing. Provider packages ship best-effort defaults;
   * verify against the provider's current pricing page for production cost
   * accounting.
   */
  cost?: ModelPricing;
}

/**
 * Controls whether the LLM must, may, or must not call tools.
 *
 * - `"auto"` – model decides (default when tools are provided).
 * - `"any"`  – model must call at least one tool.
 * - `"none"` – model must not call any tool.
 * - `{ name: string }` – model must call the specified tool.
 */
export type ToolChoice = "auto" | "any" | "none" | { name: string };

/**
 * Reasoning effort hint for models that support a tunable reasoning budget
 * (e.g. OpenAI GPT-5 family via the Responses API).
 *
 * Providers that do not support per-call reasoning control should ignore this.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface LLMRequestOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Tool schemas to provide for native tool use. */
  tools?: ToolSchema[];
  /**
   * Controls tool-calling behavior. Defaults to `"auto"` when tools are provided.
   *
   * TODO: Currently only implemented by provider-gemini. Anthropic and OpenAI
   * providers need to map this to their respective tool_choice parameters.
   */
  toolChoice?: ToolChoice;
  /**
   * Reasoning effort hint. Providers map this to their native reasoning
   * controls (e.g. OpenAI `reasoning.effort`). Providers without reasoning
   * controls ignore this field.
   */
  reasoning?: ReasoningEffort;
}

/** A tool result sent back to the LLM after tool execution. */
export interface LLMToolResultBlock {
  /** The tool-call ID this result corresponds to. */
  toolUseId: string;
  /** Name of the tool that was called. */
  name: string;
  /** Serialised result (typically JSON string). */
  result: string;
}

// TODO: The toolUse and toolResult fields are currently only handled by
// provider-gemini's toGeminiContents(). The Anthropic and OpenAI provider
// formatters (toAnthropicMessages, toOpenAIInput) still ignore these fields
// and need to be updated to support multi-turn tool-use conversations.
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
  /** Tool calls made by the assistant (present on assistant messages). */
  toolUse?: LLMToolUseBlock[];
  /** Tool results provided by the user (present on user messages). */
  toolResult?: LLMToolResultBlock[];
}

/** A tool invocation returned by the LLM in its response. */
export interface LLMToolUseBlock {
  /** Provider-assigned ID for this tool call (used to correlate results). */
  id: string;
  /** Name of the tool the LLM wants to call. */
  name: string;
  /** Parsed input parameters for the tool. */
  input: Record<string, unknown>;
}

/**
 * Token counts reported by the provider for a single call.
 *
 * `input` and `output` are total prompt/completion tokens as billed by the
 * provider. `cacheRead` and `cacheWrite` are present when the provider reports
 * prompt-caching usage; not all providers expose both (OpenAI and Gemini only
 * report cached reads).
 */
export interface LLMTokensUsed {
  input: number;
  output: number;
  /** Cached input tokens reused from a prompt cache (priced lower than `input`). */
  cacheRead?: number;
  /** Tokens written to a prompt cache (Anthropic only). */
  cacheWrite?: number;
}

export interface LLMResponse {
  text: string;
  tokensUsed: LLMTokensUsed;
  finishReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  /** Tool calls requested by the LLM (present when finishReason is "tool_use"). */
  toolUse?: LLMToolUseBlock[];
}

export interface LLMProvider {
  complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>;
  /** Return the models this provider supports. */
  getModels(): ModelInfo[];
}

export type LLMLogStatus = "success" | "error" | "retry";

export interface LLMLogEntry {
  timestamp: string;
  provider: string;
  status: LLMLogStatus;
  durationMs: number;
  attempt: number;
  request: {
    model: string;
    messageCount: number;
    totalCharLength: number;
    promptPreview: string;
    maxTokens?: number;
    temperature?: number;
    reasoning?: ReasoningEffort;
    hasSystemPrompt: boolean;
    hasTools?: boolean;
    messages?: LLMMessage[];
    systemPrompt?: string;
  };
  response?: {
    text: string;
    tokensUsed: LLMTokensUsed;
    finishReason: string;
    toolUseCount?: number;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}

export type LLMLogCallback = (entry: LLMLogEntry) => void;
