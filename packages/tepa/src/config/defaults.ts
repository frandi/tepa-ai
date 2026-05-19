import type { TepaConfig } from "@tepa/types";

export const DEFAULT_CONFIG: TepaConfig = {
  model: {
    planner: "claude-sonnet-4-6",
    evaluator: "claude-sonnet-4-6",
    executor: {
      low: "claude-haiku-4-5",
      high: "claude-sonnet-4-6",
    },
  },
  limits: {
    maxCycles: 5,
    maxTokens: 64_000,
    toolTimeout: 30_000,
    retryAttempts: 1,
  },
  tools: [],
  logging: {
    level: "info",
  },
};
