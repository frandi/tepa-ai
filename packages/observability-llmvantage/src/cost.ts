import type { LLMLogEntry, LLMTokensUsed, ModelPricing } from "@tepa/types";

/** Pricing keyed by provider id → model id → ModelPricing. */
export type PricingTable = Record<string, Record<string, ModelPricing>>;

const PER_MILLION = 1_000_000;

/**
 * Compute the monetary cost of a single LLM call from its token usage and
 * the model's pricing. Returns `0` when pricing is undefined.
 *
 * `cacheRead` falls back to the input rate when `cacheReadPer1M` is not set
 * (i.e. the provider doesn't differentiate cached reads). `cacheWrite` falls
 * back to `inputPer1M` similarly. This is a conservative default so that
 * unknown cache pricing never under-counts cost.
 */
export function costForTokens(tokens: LLMTokensUsed, pricing?: ModelPricing): number {
  if (!pricing) return 0;

  const inputRate = pricing.inputPer1M;
  const outputRate = pricing.outputPer1M;
  const cacheReadRate = pricing.cacheReadPer1M ?? inputRate;
  const cacheWriteRate = pricing.cacheWritePer1M ?? inputRate;

  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  // `input` from providers typically already excludes cached tokens, but
  // providers vary. We treat `input` as-reported and bill cache* separately.
  const billedInput = tokens.input;

  return (
    (billedInput * inputRate +
      tokens.output * outputRate +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate) /
    PER_MILLION
  );
}

/** Convenience: derive cost for a Tepa `LLMLogEntry` given a pricing lookup. */
export function costFor(entry: LLMLogEntry, pricing?: ModelPricing): number {
  if (!entry.response) return 0;
  return costForTokens(entry.response.tokensUsed, pricing);
}

/**
 * Resolve pricing for a (provider, model) pair from a `PricingTable` with
 * graceful misses. Callers typically merge `defaultPricing` with their own
 * overrides before passing it here.
 */
export function lookupPricing(
  table: PricingTable | undefined,
  provider: string,
  model: string,
): ModelPricing | undefined {
  return table?.[provider]?.[model];
}

/**
 * Best-effort pricing snapshot in USD per 1M tokens, intended as a starting
 * point. Pricing changes; verify against each provider's pricing page before
 * relying on these for billing. Last reviewed: 2026-05.
 */
export const defaultPricing: PricingTable = {
  anthropic: {
    "claude-haiku-4-5": {
      inputPer1M: 1,
      outputPer1M: 5,
      cacheReadPer1M: 0.1,
      cacheWritePer1M: 1.25,
    },
    "claude-sonnet-4-6": {
      inputPer1M: 3,
      outputPer1M: 15,
      cacheReadPer1M: 0.3,
      cacheWritePer1M: 3.75,
    },
    "claude-opus-4-6": {
      inputPer1M: 15,
      outputPer1M: 75,
      cacheReadPer1M: 1.5,
      cacheWritePer1M: 18.75,
    },
  },
  openai: {
    "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2, cacheReadPer1M: 0.025 },
    "gpt-5": { inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.125 },
  },
  gemini: {
    "gemini-3-flash-preview": { inputPer1M: 0.3, outputPer1M: 2.5, cacheReadPer1M: 0.075 },
    "gemini-3-pro-preview": { inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.31 },
  },
};
