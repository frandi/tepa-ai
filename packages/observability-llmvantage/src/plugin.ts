import type { LLMTokensUsed } from "@tepa/types";
import { costForTokens, defaultPricing, lookupPricing, type PricingTable } from "./cost.js";

/**
 * Minimal subset of llmvantage's `LLMEvent` shape — declared locally so this
 * package can be installed without llmvantage at type-check time. At runtime
 * the plugin is consumed by `observer.use()` and receives the real event.
 */
export interface LlmvantageEvent {
  provider: string;
  response: unknown;
  [key: string]: unknown;
}

export interface CostTagOptions {
  pricing?: PricingTable;
  ignoreDefaultPricing?: boolean;
  currency?: string;
}

interface ProviderUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  model?: string;
}

function extractUsage(event: LlmvantageEvent): ProviderUsage | null {
  const response = event.response as Record<string, unknown> | undefined;
  if (!response || typeof response !== "object") return null;

  // Anthropic: { usage: { input_tokens, output_tokens, cache_*_input_tokens }, model }
  if (event.provider === "anthropic") {
    const usage = response.usage as Record<string, number> | undefined;
    if (!usage) return null;
    return {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      model: response.model as string | undefined,
    };
  }

  // OpenAI Responses API: { usage: { input_tokens, output_tokens, input_tokens_details: { cached_tokens } }, model }
  if (event.provider === "openai") {
    const usage = response.usage as Record<string, unknown> | undefined;
    if (!usage) return null;
    const details = usage.input_tokens_details as Record<string, number> | undefined;
    return {
      input: (usage.input_tokens as number) ?? 0,
      output: (usage.output_tokens as number) ?? 0,
      cacheRead: details?.cached_tokens,
      model: response.model as string | undefined,
    };
  }

  // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount, cachedContentTokenCount }, modelVersion }
  if (event.provider === "gemini") {
    const usage = response.usageMetadata as Record<string, number> | undefined;
    if (!usage) return null;
    return {
      input: usage.promptTokenCount ?? 0,
      output: usage.candidatesTokenCount ?? 0,
      cacheRead: usage.cachedContentTokenCount,
      model: (response.modelVersion as string | undefined) ?? (response.model as string | undefined),
    };
  }

  return null;
}

/**
 * llmvantage plugin that adds `costUSD` (or configured currency) and a
 * normalized `tokens` block to each event. Register with:
 *
 *   observer.use(tagCost()).pipe(sink);
 *
 * Pricing resolution mirrors `createLlmvantageBridge` so a single config
 * keeps both layers in sync.
 */
export function tagCost(opts: CostTagOptions = {}): (event: LlmvantageEvent) => LlmvantageEvent {
  const useDefaults = !opts.ignoreDefaultPricing;
  const pricing: PricingTable = useDefaults
    ? mergePricing(opts.pricing)
    : (opts.pricing ?? {});
  const currency = opts.currency ?? "USD";

  return (event) => {
    const usage = extractUsage(event);
    if (!usage || !usage.model) return event;

    const tokens: LLMTokensUsed = {
      input: usage.input,
      output: usage.output,
      ...(usage.cacheRead != null && { cacheRead: usage.cacheRead }),
      ...(usage.cacheWrite != null && { cacheWrite: usage.cacheWrite }),
    };
    const modelPricing = lookupPricing(pricing, event.provider, usage.model);
    const cost = costForTokens(tokens, modelPricing);

    return {
      ...event,
      tokens,
      cost: { value: cost, currency, pricingKnown: modelPricing != null },
    };
  };
}

function mergePricing(overrides: PricingTable | undefined): PricingTable {
  if (!overrides) return defaultPricing;
  const merged: PricingTable = { ...defaultPricing };
  for (const [provider, models] of Object.entries(overrides)) {
    merged[provider] = { ...(merged[provider] ?? {}), ...models };
  }
  return merged;
}
