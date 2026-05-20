import type { ReasoningEffort } from "./llm.js";

/**
 * Model assignment for a single pipeline role.
 *
 * - Plain string: just the model ID (provider defaults apply for reasoning).
 * - Object form: model ID plus an optional reasoning-effort hint that
 *   providers like OpenAI map to their native reasoning controls.
 */
export type RoleModel = string | { id: string; reasoning?: ReasoningEffort };

export interface ExecutorTiers {
  /** Model for trivial steps — tool-param construction and mechanical work. */
  low: RoleModel;
  /** Model for reasoning steps — synthesis, analysis, summarization, judgment. */
  high: RoleModel;
}

export interface ModelConfig {
  planner: RoleModel;
  evaluator: RoleModel;
  /** Two-tier executor: the planner picks a tier per step. */
  executor: ExecutorTiers;
}

export interface LimitsConfig {
  maxCycles: number;
  maxTokens: number;
  toolTimeout: number;
  retryAttempts: number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Well-known metadata keys for {@link TepaLogger} calls.
 *
 * Logger implementations should check `decorative` and skip those
 * messages on non-console channels (file, Datadog, etc.).
 */
export interface TepaLogMeta extends Record<string, unknown> {
  /**
   * When `true`, the message is purely decorative (separators, blank lines,
   * section headers) and exists only for human-readable console output.
   * Non-console transports (file, external providers) should skip these.
   */
  decorative?: boolean;
}

export interface TepaLogger {
  debug(msg: string, meta?: TepaLogMeta): void;
  info(msg: string, meta?: TepaLogMeta): void;
  warn(msg: string, meta?: TepaLogMeta): void;
  error(msg: string, meta?: TepaLogMeta): void;
}

export interface LoggingConfig {
  level: LogLevel;
  output?: string;
}

export interface TepaConfig {
  model: ModelConfig;
  limits: LimitsConfig;
  tools: string[];
  logging: LoggingConfig;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
