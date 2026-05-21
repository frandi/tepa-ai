# @tepa/observability-llmvantage

Optional adapter that bridges Tepa's structured provider logs with [llmvantage](https://github.com/frandi/llmvantage) for cost tracking and cross-SDK LLM observability.

This package is **not** a dependency of `@tepa/core` or any provider package. Install it only if you want llmvantage-shaped events or per-run cost rollups.

## Install

```bash
npm install @tepa/observability-llmvantage llmvantage
```

`llmvantage` is declared as an optional peer dependency — the bridge works without it; the `tagCost` plugin requires it at runtime.

## Why two layers?

Tepa's `provider.onLog` and llmvantage capture LLM activity at different layers:

| Layer                | Captures                                                                              |
| -------------------- | ------------------------------------------------------------------------------------- |
| **llmvantage**       | Raw HTTP requests/responses via global `fetch` patch. One event per HTTP attempt.      |
| **Tepa `onLog`**     | Pipeline-aware entries with attempt #, retry status, normalized finish reasons, tool-use counts. One entry per attempt plus terminals. |

This adapter does **not** forward Tepa entries into llmvantage's pipeline — llmvantage's fetch patch already captures every Tepa LLM call. Instead, it gives you:

1. **`createLlmvantageBridge`** — turns the `onLog` stream into cost rollups, grouped per provider and per model.
2. **`tagCost`** — an llmvantage plugin that tags raw fetch events with normalized `tokens` and `cost` fields, so downstream sinks (file, HTTP shipper, console) carry cost in-band.

## Quick start: cost summary from Tepa logs

```typescript
import { createLlmvantageBridge, defaultPricing } from "@tepa/observability-llmvantage";
import { AnthropicProvider } from "@tepa/provider-anthropic";
import { Tepa } from "@tepa/core";

const bridge = createLlmvantageBridge({
  pricing: {
    ...defaultPricing,
    anthropic: {
      ...defaultPricing.anthropic,
      // Override stale defaults, or add a model the provider package doesn't ship yet
      "claude-sonnet-4-6": {
        inputPer1M: 3, outputPer1M: 15,
        cacheReadPer1M: 0.3, cacheWritePer1M: 3.75,
      },
    },
  },
});

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
provider.onLog(bridge.callback);

const tepa = new Tepa({ provider, /* ... */ });
await tepa.run(prompt);

console.log(bridge.summary());
// {
//   calls, retries, errors,
//   tokens: { input, output, cacheRead, cacheWrite },
//   cost: { total: 0.0234, currency: "USD" },
//   byProvider: { anthropic: { calls, tokens, cost } },
//   byModel: { "anthropic:claude-sonnet-4-6": { calls, tokens, cost } },
//   pricingMissing: [],
// }
```

## Quick start: cost-tagged llmvantage events

```typescript
import "llmvantage";
import { observer } from "llmvantage";
import { consoleSink } from "llmvantage/sinks/console";
import { tagCost } from "@tepa/observability-llmvantage";

observer
  .use(tagCost({ /* same pricing options as the bridge */ }))
  .pipe(consoleSink);
```

Each event delivered to `consoleSink` will now carry `tokens` and `cost: { value, currency, pricingKnown }`.

## Pricing resolution

For both the bridge and `tagCost`, pricing resolves in this order (highest priority first):

1. `BridgeOptions.pricing[provider][model]` / `CostTagOptions.pricing[provider][model]`
2. `defaultPricing[provider][model]` shipped by this package

`ModelInfo.cost` on the provider's model catalog is not consulted by v1 of this adapter; supply pricing explicitly via the `pricing` option. Use `ignoreDefaultPricing: true` to bypass the shipped snapshot entirely (useful for tests or when you want hard failure on unknown models — they will appear in `RunSummary.pricingMissing`).

Pricing data goes stale. Treat `defaultPricing` as a starting point — verify against each provider's pricing page for production billing.

## Cache token support

When the underlying SDK reports prompt-cache usage, the providers now populate `LLMResponse.tokensUsed.cacheRead` / `cacheWrite`. The bridge bills these at `cacheReadPer1M` / `cacheWritePer1M` when set on the model's `ModelPricing`, falling back to `inputPer1M` if the rates are missing (conservative default — better to over-count than under-count).

| Provider     | `cacheRead` source                              | `cacheWrite` source                       |
| ------------ | ----------------------------------------------- | ----------------------------------------- |
| Anthropic    | `usage.cache_read_input_tokens`                 | `usage.cache_creation_input_tokens`       |
| OpenAI       | `usage.input_tokens_details.cached_tokens`      | — (not reported)                          |
| Gemini       | `usageMetadata.cachedContentTokenCount`         | — (not reported)                          |

## API

See [API Reference → `@tepa/observability-llmvantage`](../../docs/11-api-reference.md#tepaobservability-llmvantage).
