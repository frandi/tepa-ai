import type { LLMLogEntry, ModelPricing } from "@tepa/types";
import { costFor, defaultPricing, lookupPricing, type PricingTable } from "./cost.js";

export interface BridgeOptions {
  /**
   * Pricing overrides. Merged on top of `defaultPricing` at the provider
   * level (per-provider object replaces, not deep-merges). When omitted,
   * `defaultPricing` is used as-is.
   */
  pricing?: PricingTable;
  /** Currency label used in `RunSummary.cost.currency`. Default `"USD"`. */
  currency?: string;
  /** Disable merging with `defaultPricing` and use `pricing` alone. */
  ignoreDefaultPricing?: boolean;
}

export interface RunTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelSummary {
  calls: number;
  tokens: RunTokens;
  cost: number;
}

export interface RunSummary {
  calls: number;
  retries: number;
  errors: number;
  tokens: RunTokens;
  cost: { total: number; currency: string };
  byModel: Record<string, ModelSummary>;
  byProvider: Record<string, ModelSummary>;
  /** Provider+model pairs encountered with no pricing entry. */
  pricingMissing: string[];
}

export interface Bridge {
  /** Wire into a provider with `provider.onLog(bridge.callback)`. */
  callback: (entry: LLMLogEntry) => void;
  /** Snapshot of cost and token totals across all entries seen so far. */
  summary(): RunSummary;
  /** Per-call cost for a specific entry, using the bridge's pricing resolution. */
  costFor(entry: LLMLogEntry): number;
  /** Discard accumulated entries. */
  reset(): void;
}

function emptyTokens(): RunTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokens(
  target: RunTokens,
  source: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): void {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead ?? 0;
  target.cacheWrite += source.cacheWrite ?? 0;
}

function mergePricing(overrides: PricingTable | undefined, useDefaults: boolean): PricingTable {
  if (!useDefaults) return overrides ?? {};
  if (!overrides) return defaultPricing;
  const merged: PricingTable = { ...defaultPricing };
  for (const [provider, models] of Object.entries(overrides)) {
    merged[provider] = { ...(merged[provider] ?? {}), ...models };
  }
  return merged;
}

/**
 * Create a bridge that consumes Tepa `LLMLogEntry`s and produces a cost
 * summary. The bridge runs alongside llmvantage; it does not push events
 * into llmvantage's pipeline (llmvantage already captures raw HTTP via its
 * fetch patch).
 */
export function createLlmvantageBridge(opts: BridgeOptions = {}): Bridge {
  const pricing = mergePricing(opts.pricing, !opts.ignoreDefaultPricing);
  const currency = opts.currency ?? "USD";

  const entries: LLMLogEntry[] = [];

  const resolvePricing = (entry: LLMLogEntry): ModelPricing | undefined =>
    lookupPricing(pricing, entry.provider, entry.request.model);

  return {
    callback(entry) {
      entries.push(entry);
    },

    costFor(entry) {
      return costFor(entry, resolvePricing(entry));
    },

    reset() {
      entries.length = 0;
    },

    summary(): RunSummary {
      const totals = emptyTokens();
      const byModel: Record<string, ModelSummary> = {};
      const byProvider: Record<string, ModelSummary> = {};
      const missing = new Set<string>();
      let calls = 0;
      let retries = 0;
      let errors = 0;
      let totalCost = 0;

      for (const entry of entries) {
        if (entry.status === "retry") {
          retries++;
          continue;
        }
        if (entry.status === "error") {
          errors++;
          continue;
        }
        // success
        calls++;
        const response = entry.response;
        if (!response) continue;

        const tokens = response.tokensUsed;
        addTokens(totals, tokens);

        const modelKey = `${entry.provider}:${entry.request.model}`;
        const modelEntry = byModel[modelKey] ?? { calls: 0, tokens: emptyTokens(), cost: 0 };
        modelEntry.calls++;
        addTokens(modelEntry.tokens, tokens);

        const providerEntry = byProvider[entry.provider] ?? {
          calls: 0,
          tokens: emptyTokens(),
          cost: 0,
        };
        providerEntry.calls++;
        addTokens(providerEntry.tokens, tokens);

        const modelPricing = resolvePricing(entry);
        if (!modelPricing) {
          missing.add(modelKey);
        } else {
          const callCost = costFor(entry, modelPricing);
          totalCost += callCost;
          modelEntry.cost += callCost;
          providerEntry.cost += callCost;
        }

        byModel[modelKey] = modelEntry;
        byProvider[entry.provider] = providerEntry;
      }

      return {
        calls,
        retries,
        errors,
        tokens: totals,
        cost: { total: totalCost, currency },
        byModel,
        byProvider,
        pricingMissing: [...missing].sort(),
      };
    },
  };
}
