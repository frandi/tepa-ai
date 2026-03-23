export interface ModelConfig {
  planner: string;
  executor: string;
  evaluator: string;
  /** Optional whitelist of model IDs the planner may assign to steps. If omitted, all provider models are available. */
  allowedModels?: string[];
}

export interface LimitsConfig {
  maxCycles: number;
  maxTokens: number;
  toolTimeout: number;
  retryAttempts: number;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TepaLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
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
