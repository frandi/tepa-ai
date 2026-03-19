import type { ModelInfo } from "@tepa/types";

/** Type-safe model ID constants for Anthropic Claude models. */
export const AnthropicModels = {
  Claude_Haiku_4_5: "claude-haiku-4-5",
  Claude_Sonnet_4_6: "claude-sonnet-4-6",
  Claude_Opus_4_6: "claude-opus-4-6",
} as const;

/** Full model catalog for the Anthropic provider. */
export const ANTHROPIC_MODEL_CATALOG: ModelInfo[] = [
  {
    id: AnthropicModels.Claude_Haiku_4_5,
    tier: "fast",
    description:
      "Fast, cost-effective. Best for simple tool parameter construction and straightforward tasks.",
    capabilities: ["tool_use"],
  },
  {
    id: AnthropicModels.Claude_Sonnet_4_6,
    tier: "balanced",
    description:
      "Balanced performance. Good for planning, analysis, and moderately complex reasoning.",
    capabilities: ["tool_use", "vision"],
  },
  {
    id: AnthropicModels.Claude_Opus_4_6,
    tier: "advanced",
    description:
      "Most capable. Use for complex multi-step reasoning, synthesis, and difficult analysis.",
    capabilities: ["tool_use", "vision"],
  },
];
