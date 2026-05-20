import type { ModelInfo } from "@tepa/types";

/** Type-safe model ID constants for OpenAI models. */
export const OpenAIModels = {
  GPT_5_Mini: "gpt-5-mini",
  GPT_5: "gpt-5",
  GPT_5_4_Mini: "gpt-5.4-mini",
} as const;

/** Full model catalog for the OpenAI provider. */
export const OPENAI_MODEL_CATALOG: ModelInfo[] = [
  {
    id: OpenAIModels.GPT_5_Mini,
    tier: "fast",
    description:
      "Fast, cost-effective. Best for simple tool parameter construction and straightforward tasks.",
    capabilities: ["tool_use"],
  },
  {
    id: OpenAIModels.GPT_5,
    tier: "advanced",
    description: "Most capable. Use for complex reasoning, synthesis, and difficult analysis.",
    capabilities: ["tool_use", "vision"],
  },
  {
    id: OpenAIModels.GPT_5_4_Mini,
    tier: "balanced",
    description:
      "Reasoning-tunable mini model. Pair with a `reasoning` effort hint (minimal/low/medium/high) to trade latency for depth across pipeline roles.",
    capabilities: ["tool_use", "reasoning"],
  },
];
