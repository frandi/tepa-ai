# Configuration

Every Tepa setting has a sensible default — a zero-config pipeline works out of the box. This section covers what each setting controls, when you'd want to change it, and how to apply configuration at the level that suits your workflow: inline in the constructor, as a reusable config object, or loaded from a file.

---

## `TepaConfig` Structure

```typescript
interface TepaConfig {
  model: ModelConfig;
  limits: LimitsConfig;
  logging: LoggingConfig;
}
```

### `ModelConfig`

Assigns a model to each pipeline stage and optionally constrains which models the Planner can assign to individual steps.

```typescript
interface ModelConfig {
  planner: string;
  executor: string;
  evaluator: string;
  allowedModels?: string[];
}
```

The `allowedModels` field is an optional whitelist of model IDs the Planner may assign to plan steps. When omitted, the Planner can choose from all models in the provider's catalog. When set, only those models (plus the executor, which is always auto-included) are available. See [Model Catalog and Allowed Models](#model-catalog-and-allowed-models) below.

### `LimitsConfig`

Controls resource boundaries for the pipeline run.

```typescript
interface LimitsConfig {
  maxCycles: number;
  maxTokens: number;
  toolTimeout: number;
  retryAttempts: number;
}
```

### `LoggingConfig`

Controls console output verbosity.

```typescript
interface LoggingConfig {
  level: "minimal" | "standard" | "verbose";
  output?: string;
}
```

---

## Default Values

| Setting                | Default               | Description                                                         |
| ---------------------- | --------------------- | ------------------------------------------------------------------- |
| `model.planner`        | `"claude-sonnet-4-6"` | Model used to generate and revise plans.                            |
| `model.executor`       | `"claude-haiku-4-5"`  | Model used to execute each plan step.                               |
| `model.evaluator`      | `"claude-sonnet-4-6"` | Model used to judge execution results.                              |
| `limits.maxCycles`     | `5`                   | Maximum Plan-Execute-Evaluate iterations before the pipeline stops. |
| `limits.maxTokens`     | `64_000`              | Total token budget across all LLM calls in all cycles.              |
| `limits.toolTimeout`   | `30_000`              | Timeout for tool execution in milliseconds.                         |
| `limits.retryAttempts` | `1`                   | Retry attempts for recoverable step failures.                       |
| `logging.level`        | `"standard"`          | Console output verbosity.                                           |

The defaults follow a cost-efficiency pattern: a more capable model for planning and evaluation (where reasoning quality matters most), and a faster, cheaper model for execution (where the task is often just constructing tool call parameters). You only need to override what you want to change.

> **Tip:** Each provider exports type-safe model constants so you don't need to memorize string IDs. See [Model Catalog and Allowed Models](#model-catalog-and-allowed-models) below.

These defaults are exported as `DEFAULT_CONFIG` from `@tepa/core` if you need to reference them programmatically.

---

## Applying Configuration

### Inline in the Constructor

The most common approach — pass a partial config directly to `Tepa`. Only include the fields you want to override:

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    limits: {
      maxCycles: 3,
      maxTokens: 400_000,
    },
    logging: {
      level: "verbose",
    },
  },
});
```

### With `defineConfig()`

`defineConfig()` deep-merges your partial config with the defaults and validates the result using Zod. It's called internally by the `Tepa` constructor, but you can call it explicitly when you want to inspect or reuse the resolved config before constructing an instance:

```typescript
import { defineConfig } from "@tepa/core";

const config = defineConfig({
  limits: { maxCycles: 10 },
});
// limits.maxCycles → 10
// limits.maxTokens → 64_000 (default)
// Everything else → defaults
```

The deep merge works at any nesting level — you can override a single model while keeping the others:

```typescript
const config = defineConfig({
  model: { planner: "claude-opus-4-6" },
});
// model.planner  → "claude-opus-4-6"
// model.executor → "claude-haiku-4-5" (default)
// model.evaluator → "claude-sonnet-4-6" (default)
```

### From a File

The `loadConfig` utility reads a JSON or YAML file and returns a validated `TepaConfig`:

```typescript
import { loadConfig } from "@tepa/core";

const config = await loadConfig("./tepa.config.yaml");
const tepa = new Tepa({ provider, tools, config });
```

Supported formats: `.json`, `.yaml`, `.yml`. The loaded data is passed through `defineConfig()`, so partial configs work — only include what you want to override. Unsupported file extensions throw a `TepaConfigError`.

```yaml
# tepa.config.yaml
model:
  planner: claude-opus-4-6
limits:
  maxCycles: 3
  maxTokens: 200000
logging:
  level: verbose
```

Externalizing config is particularly useful when you're running Tepa pipelines across different environments (development, staging, production) with different limits and logging verbosity.

---

## Model Configuration

The three pipeline stages use their own model assignments, which you can tune independently for cost and quality.

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: "claude-opus-4-6",    // Complex reasoning for plan generation
      executor: "claude-sonnet-4-6", // Mid-tier for tool execution
      evaluator: "claude-opus-4-6",  // Thorough judgment on results
    },
  },
});
```

Model strings must match what your LLM provider accepts. At pipeline startup, Tepa validates that `planner`, `executor`, and `evaluator` all exist in the provider's model catalog — a mismatch throws a `TepaConfigError` with a clear message listing the available models.

Each provider exports type-safe constants to avoid typos:

```typescript
import { AnthropicModels } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: AnthropicModels.Claude_Sonnet_4_6,
      executor: AnthropicModels.Claude_Haiku_4_5,
      evaluator: AnthropicModels.Claude_Sonnet_4_6,
    },
  },
});
```

String literals still work — the constants are just regular strings with autocomplete support.

### Per-Step Model Overrides

Beyond the three stage-level models, individual plan steps can override the executor model. The Planner is given the available models in its system prompt and can assign a `model` field to any step it generates:

```typescript
// A plan the Planner might generate:
{
  steps: [
    {
      id: "step_1",
      description: "Read and load the CSV data",
      tools: ["file_read"],
      expectedOutcome: "Raw CSV content loaded",
      dependencies: [],
      // No model field — uses config.model.executor
    },
    {
      id: "step_2",
      description: "Synthesize findings into a narrative report",
      tools: [],
      expectedOutcome: "A well-structured analysis report",
      dependencies: ["step_1"],
      model: "claude-sonnet-4-6", // Override: more capable model for reasoning
    },
  ],
}
```

During execution, a step's `model` field takes precedence over `config.model.executor`. Steps without a `model` field use the executor default. This gives the Planner fine-grained control — using the cheaper model for straightforward tool calls and the more capable model for complex reasoning steps.

Per-step overrides are generated automatically by the Planner based on step complexity. You don't set them manually — you configure which models are available, and the Planner decides how to use them.

### Model Catalog and Allowed Models

Each provider declares a **model catalog** — the set of models it supports, with metadata (tier, description, capabilities) that helps the Planner make intelligent choices. The Planner's system prompt includes this catalog so it can assign the most appropriate model to each step.

By default, the Planner has access to **all** models in the provider's catalog. Use `allowedModels` to restrict this to a subset:

```typescript
import { AnthropicProvider, AnthropicModels } from "@tepa/provider-anthropic";

// Cost-conscious: only allow haiku and sonnet for step assignment
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: AnthropicModels.Claude_Sonnet_4_6,
      executor: AnthropicModels.Claude_Haiku_4_5,
      evaluator: AnthropicModels.Claude_Sonnet_4_6,
      allowedModels: [
        AnthropicModels.Claude_Haiku_4_5,
        AnthropicModels.Claude_Sonnet_4_6,
      ],
    },
  },
});
```

```typescript
// Full access: allow the Planner to use Opus for complex reasoning steps
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: AnthropicModels.Claude_Sonnet_4_6,
      executor: AnthropicModels.Claude_Haiku_4_5,
      evaluator: AnthropicModels.Claude_Sonnet_4_6,
      allowedModels: [
        AnthropicModels.Claude_Haiku_4_5,
        AnthropicModels.Claude_Sonnet_4_6,
        AnthropicModels.Claude_Opus_4_6,
      ],
    },
  },
});
```

**Key behaviors:**

- **Omit `allowedModels`** — the Planner sees the full provider catalog (default, zero-config).
- **Set `allowedModels`** — only those models appear in the Planner's prompt. The `executor` model is always auto-included even if you forget to list it.
- **Validation** — every entry in `allowedModels` is validated against the provider catalog at startup. Typos throw a `TepaConfigError`.

**Available model constants by provider:**

| Provider  | Import                                            | Constants                                                  |
| --------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Anthropic | `AnthropicModels` from `@tepa/provider-anthropic` | `Claude_Haiku_4_5`, `Claude_Sonnet_4_6`, `Claude_Opus_4_6` |
| OpenAI    | `OpenAIModels` from `@tepa/provider-openai`       | `GPT_5_Mini`, `GPT_5`                                      |
| Gemini    | `GeminiModels` from `@tepa/provider-gemini`       | `Gemini_3_Flash_Preview`, `Gemini_3_Pro_Preview`           |

---

## Limits Configuration

### `maxCycles`

The maximum number of Plan-Execute-Evaluate iterations. If the Evaluator returns `pass` before the limit is reached, the pipeline returns immediately. If the limit is reached without a `pass`, the pipeline returns with `status: "fail"` and the last evaluator feedback.

```typescript
config: {
  limits: { maxCycles: 3 },
}
```

Set this based on your task's complexity and your tolerance for retries. A simple summarization task may pass on cycle 1. A code generation task with tests may need 3–4 cycles to self-correct to a passing state. Setting it too high risks spending tokens on a fundamentally broken approach — if the pipeline hasn't passed by cycle 3 or 4, more cycles rarely help without changing the goal or tools.

### `maxTokens`

The total token budget for the entire pipeline run — across all LLM calls in all cycles (planner, every executor step, evaluator).

```typescript
config: {
  limits: { maxTokens: 200_000 },
}
```

The `TokenTracker` checks the budget after every LLM call. If the cumulative count exceeds the budget, the current cycle is interrupted immediately and the pipeline returns with `status: "terminated"`. It does not wait for the cycle to complete.

This is a hard ceiling, not a soft target. Plan accordingly: if your task typically uses 50K tokens per cycle and you allow 3 cycles, set the budget to at least 150K with some headroom for variance.

### `toolTimeout`

Timeout in milliseconds for individual tool executions. If a tool's `execute` function doesn't resolve within this window, the step fails with a timeout error.

```typescript
config: {
  limits: { toolTimeout: 60_000 }, // 60 seconds per tool call
}
```

The default 30 seconds suits most file, shell, and HTTP tools. Increase it for tools that call slow external APIs or run long-running processes. The timeout applies per tool invocation, not per step — a step that calls two tools has two independent timeout windows.

### `retryAttempts`

The number of retry attempts for recoverable step failures during execution — situations where a tool call fails due to a transient error (a network blip, a temporarily unavailable service) rather than a logic error in the plan.

```typescript
config: {
  limits: { retryAttempts: 2 }, // Retry up to 2 times before marking the step as failed
}
```

A value of `1` (the default) means one retry attempt — two total tries. A value of `0` means no retries — the step fails immediately on the first error. This setting does not affect the Plan-Execute-Evaluate self-correction loop itself, which is governed by `maxCycles`. It only applies to recoverable failures within a single step execution.

Increase this for pipelines that depend on external services with occasional transient failures. Keep it low (or at `0`) for pipelines where a step failure is more likely to reflect a plan logic issue that self-correction should address.

---

## Logging Configuration

The `level` setting controls how much the pipeline prints to the console. All three levels collect the same structured `LogEntry` data internally — the difference is only what appears on screen during a run.

Default logging is implemented as **event default behaviors** — they run automatically after any user event callbacks. If you need to replace the default logging for a specific event, call `ctx.preventDefault()` in your event callback. See [Event System Patterns — Default Behaviors and `preventDefault()`](./07-event-system-patterns.md#default-behaviors-and-preventdefault) for details.

### `"minimal"`

No console output. Log entries are still collected and available in `result.logs` after the run completes. Use this for production environments or when you're capturing logs programmatically.

### `"standard"` (default)

Prints a pipeline banner, per-step progress with timing, stage summaries, and a final summary with model names:

```
▶ Pipeline started — goal: "List the files in ./src..."
  Tools: 4 | Limits: 5 cycles, 64000 tokens
──────────────────────────────────────────────
[cycle 1] Planning ··· 2 steps (5.4s)
[cycle 1]   → step 1/2 (directory_list) ✓ 922ms
[cycle 1]   → step 2/2 (file_write) ✓ 4.4s
[cycle 1] Execution ··· 2/2 succeeded (5.3s)
[cycle 1] Evaluation ··· pass · confidence 0.92 (2.3s)
──────────────────────────────────────────────
✔ Pipeline completed — pass · 1 cycle · 3774 tokens · 14.4s
  Models: claude-sonnet-4-6, claude-haiku-4-5
```

### `"verbose"`

Everything in `"standard"`, plus token counts per step, output previews, token budget percentage, and a per-model token breakdown:

```
▶ Pipeline started — goal: "List the files in ./src..."
  Tools: 4 | Limits: 5 cycles, 64000 tokens
──────────────────────────────────────────────
[cycle 1] Planning ··· 3 steps (1285 tokens, 1.1s)
[cycle 1]   → step 1/3 (directory_list) ✓ 1.3s [802 tokens] [{"name":"config.js"...
[cycle 1]   → step 2/3 ✓ 9.3s [556 tokens] ## Analysis...
[cycle 1]   → step 3/3 (file_write) ✓ 3.0s [1495 tokens] {"path":"./summary.md"...
[cycle 1] Execution ··· 3/3 succeeded (2853 tokens, 13.6s)
[cycle 1] Evaluation ··· pass · confidence 0.97 (1381 tokens, 2.6s)
           Budget: 6915/64000 (10.8%)
──────────────────────────────────────────────
✔ Pipeline completed — pass · 1 cycle · 5534/64000 tokens (8.6%) · 22.8s
  Models: claude-sonnet-4-6: 2681, claude-haiku-4-5: 2853
```

Use this during development and debugging to understand where time and tokens are going.

Regardless of the level setting, every entry is always available in the result:

```typescript
const result = await tepa.run(prompt);

for (const entry of result.logs) {
  // entry: { timestamp, cycle, step?, tool?, message, durationMs?, tokensUsed? }
}
```

---

## Invalid Configuration Errors

When `defineConfig()` encounters invalid values, it throws a `TepaConfigError` with a message listing every failing field, its path, and the reason:

```typescript
defineConfig({
  limits: { maxCycles: -1 },
  logging: { level: "debug" },
});
// Throws TepaConfigError:
// "Invalid configuration: limits.maxCycles: Number must be greater than 0;
//  logging.level: Invalid enum value. Expected 'minimal' | 'standard' | 'verbose',
//  received 'debug'"
```

Validation rules by field:

| Field                                                | Rule                                          |
| ---------------------------------------------------- | --------------------------------------------- |
| `model.planner`, `model.executor`, `model.evaluator` | Non-empty string                              |
| `model.allowedModels`                                | Optional array of non-empty strings           |
| `limits.maxCycles`                                   | Positive integer (> 0)                        |
| `limits.maxTokens`                                   | Positive integer (> 0)                        |
| `limits.toolTimeout`                                 | Positive integer (> 0)                        |
| `limits.retryAttempts`                               | Non-negative integer (>= 0)                   |
| `logging.level`                                      | One of `"minimal"`, `"standard"`, `"verbose"` |

`TepaConfigError` is a subclass of `TepaError`, so you can catch it specifically:

```typescript
import { TepaConfigError } from "@tepa/core";

try {
  const tepa = new Tepa({ provider, tools, config: userConfig });
} catch (err) {
  if (err instanceof TepaConfigError) {
    console.error("Bad config:", err.message);
  }
}
```

---

## What's Next

- [**Tool System**](./06-tool-system.md) — Built-in tools, custom tool definitions, and third-party packages.
- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and more.
- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, and custom provider implementation.
