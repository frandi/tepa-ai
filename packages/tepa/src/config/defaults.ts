import type { TepaConfig } from "@tepa/types";

export const DEFAULT_CONFIG: TepaConfig = {
  model: {
    planner: "claude-sonnet-4-20250514",
    executor: "claude-sonnet-4-20250514",
    evaluator: "claude-sonnet-4-20250514",
  },
  limits: {
    maxCycles: 5,
    maxTokens: 10_000,
    toolTimeout: 30_000,
    retryAttempts: 1,
  },
  tools: [],
  logging: {
    level: "standard",
  },
};
