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

export interface LoggingConfig {
  level: "minimal" | "standard" | "verbose";
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
