import type { ModelInfo } from "@tepa/types";

/** Type-safe model ID constants for OpenAI models. */
export const OpenAIModels = {
  GPT_5_Mini: "gpt-5-mini",
  GPT_5: "gpt-5",
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
];
