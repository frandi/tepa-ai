import type { ModelInfo } from "@tepa/types";

/** Type-safe model ID constants for Google Gemini models. */
export const GeminiModels = {
  // Gemini 3.x preview
  Gemini_3_1_Pro_Preview: "gemini-3.1-pro-preview",
  Gemini_3_Flash_Preview: "gemini-3-flash-preview",
  Gemini_3_1_Flash_Lite_Preview: "gemini-3.1-flash-lite-preview",
  // Gemini 2.5 stable
  Gemini_2_5_Pro: "gemini-2.5-pro",
  Gemini_2_5_Flash: "gemini-2.5-flash",
  Gemini_2_5_Flash_Lite: "gemini-2.5-flash-lite",
} as const;

/** Full model catalog for the Gemini provider. */
export const GEMINI_MODEL_CATALOG: ModelInfo[] = [
  // --- Gemini 3.x preview ---
  {
    id: GeminiModels.Gemini_3_1_Pro_Preview,
    tier: "advanced",
    description:
      "Advanced intelligence, complex problem-solving. Preview — may change.",
    capabilities: ["tool_use"],
  },
  {
    id: GeminiModels.Gemini_3_Flash_Preview,
    tier: "fast",
    description:
      "Frontier-class performance rivaling larger models. Preview — may change.",
    capabilities: ["tool_use"],
  },
  {
    id: GeminiModels.Gemini_3_1_Flash_Lite_Preview,
    tier: "fast",
    description:
      "Fastest 3.x variant, budget-friendly. Preview — may change.",
    capabilities: ["tool_use"],
  },
  // --- Gemini 2.5 stable ---
  {
    id: GeminiModels.Gemini_2_5_Pro,
    tier: "advanced",
    description: "Most advanced stable model for complex tasks.",
    capabilities: ["tool_use"],
  },
  {
    id: GeminiModels.Gemini_2_5_Flash,
    tier: "fast",
    description:
      "Best price-performance stable model for low-latency, high-volume tasks.",
    capabilities: ["tool_use"],
  },
  {
    id: GeminiModels.Gemini_2_5_Flash_Lite,
    tier: "fast",
    description: "Fastest and most budget-friendly stable multimodal model.",
    capabilities: ["tool_use"],
  },
];
