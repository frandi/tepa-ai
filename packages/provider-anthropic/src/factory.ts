import type { LLMProvider } from "@tepa/types";
import { AnthropicProvider, type AnthropicProviderOptions } from "./anthropic.js";

export type ProviderName = "anthropic";

/**
 * Create an LLM provider from a name string.
 * Currently supports "anthropic". Future providers (openai, gemini, etc.)
 * would be separate packages following the same pattern.
 */
export function createProvider(
  name: ProviderName,
  options?: AnthropicProviderOptions,
): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(options);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
