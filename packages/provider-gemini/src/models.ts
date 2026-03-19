import type { ModelInfo } from "@tepa/types";

/** Type-safe model ID constants for Google Gemini models. */
export const GeminiModels = {
  Gemini_3_Flash_Preview: "gemini-3-flash-preview",
  Gemini_3_Pro_Preview: "gemini-3-pro-preview",
} as const;

/** Full model catalog for the Gemini provider. */
export const GEMINI_MODEL_CATALOG: ModelInfo[] = [
  {
    id: GeminiModels.Gemini_3_Flash_Preview,
    tier: "fast",
    description:
      "Fast, cost-effective. Best for simple tool parameter construction and straightforward tasks.",
    capabilities: ["tool_use"],
  },
  {
    id: GeminiModels.Gemini_3_Pro_Preview,
    tier: "advanced",
    description: "Most capable. Use for complex reasoning, synthesis, and difficult analysis.",
    capabilities: ["tool_use"],
  },
];
