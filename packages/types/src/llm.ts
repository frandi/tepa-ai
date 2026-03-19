import type { ToolSchema } from "./tool.js";

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

export interface LLMResponse {
  text: string;
  tokensUsed: {
    input: number;
    output: number;
  };
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
    hasSystemPrompt: boolean;
    hasTools?: boolean;
    messages?: LLMMessage[];
    systemPrompt?: string;
  };
  response?: {
    text: string;
    tokensUsed: { input: number; output: number };
    finishReason: string;
    toolUseCount?: number;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}

export type LLMLogCallback = (entry: LLMLogEntry) => void;
