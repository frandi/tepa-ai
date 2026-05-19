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

Assigns a model to each pipeline phase. The Planner and Evaluator each use a single model. The Executor uses a **two-tier** setup — the Planner picks `"low"` or `"high"` per step based on whether it's trivial or reasoning-heavy.

```typescript
interface ExecutorTiers {
  /** Model for trivial steps — tool-param construction and mechanical work. */
  low: string;
  /** Model for reasoning steps — synthesis, analysis, summarization, judgment. */
  high: string;
}

interface ModelConfig {
  planner: string;
  evaluator: string;
  executor: ExecutorTiers;
}
```

The two-tier executor replaces a freeform per-step model override. The rationale is that planning and evaluation need a sharper model (their judgment shapes the whole run), while execution can split between cheap-and-fast for mechanical work and capable-and-slower for reasoning steps. See [Per-Step Tier Selection](#per-step-tier-selection) below.

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

Controls log level filtering.

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggingConfig {
  level: LogLevel;
  output?: string;
}
```

---

## Default Values

| Setting                | Default               | Description                                                         |
| ---------------------- | --------------------- | ------------------------------------------------------------------- |
| `model.planner`        | `"claude-sonnet-4-6"` | Model used to generate and revise plans.                            |
| `model.evaluator`      | `"claude-sonnet-4-6"` | Model used to judge execution results.                              |
| `model.executor.low`   | `"claude-haiku-4-5"`  | Executor model for trivial / mechanical steps.                      |
| `model.executor.high`  | `"claude-sonnet-4-6"` | Executor model for reasoning / synthesis steps.                     |
| `limits.maxCycles`     | `5`                   | Maximum Plan-Execute-Evaluate iterations before the pipeline stops. |
| `limits.maxTokens`     | `64_000`              | Total token budget across all LLM calls in all cycles.              |
| `limits.toolTimeout`   | `30_000`              | Timeout for tool execution in milliseconds.                         |
| `limits.retryAttempts` | `1`                   | Retry attempts for recoverable step failures.                       |
| `logging.level`        | `"info"`              | Log level filter (`"debug"`, `"info"`, `"warn"`, `"error"`).        |

The defaults follow a cost-efficiency pattern: the planner and evaluator share a capable model (where reasoning quality matters most), and the executor splits work between a cheap tier for tool-param construction and a capable tier for reasoning. Users who want sharper planning and evaluation can bump `planner` and `evaluator` to a top-tier model (e.g. `claude-opus-4-7`) with a one-line override.

> **Tip:** Each provider exports type-safe model constants so you don't need to memorize string IDs. See [Available Model Constants](#available-model-constants) below.

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
      level: "debug",
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

The deep merge works at any nesting level — you can override a single field (including inside nested objects like `executor`) while keeping the others:

```typescript
const config = defineConfig({
  model: { planner: "claude-opus-4-7" },
});
// model.planner       → "claude-opus-4-7"
// model.evaluator     → "claude-sonnet-4-6"   (default)
// model.executor.low  → "claude-haiku-4-5"    (default)
// model.executor.high → "claude-sonnet-4-6"   (default)

const config = defineConfig({
  model: { executor: { high: "claude-opus-4-7" } },
});
// Only the high executor tier changes — low keeps its default.
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
  planner: claude-opus-4-7
  evaluator: claude-opus-4-7
  executor:
    low: claude-haiku-4-5
    high: claude-sonnet-4-6
limits:
  maxCycles: 3
  maxTokens: 200000
logging:
  level: debug
```

Externalizing config is particularly useful when you're running Tepa pipelines across different environments (development, staging, production) with different limits and logging verbosity.

---

## Model Configuration

The three pipeline phases use their own model assignments, which you can tune independently for cost and quality.

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: "claude-opus-4-7",     // Sharp reasoning for plan generation
      evaluator: "claude-opus-4-7",   // Thorough judgment on results
      executor: {
        low: "claude-haiku-4-5",      // Fast tier for mechanical steps
        high: "claude-sonnet-4-6",    // Capable tier for reasoning steps
      },
    },
  },
});
```

Model strings must match what your LLM provider accepts. At pipeline startup, Tepa validates that all four model IDs (`planner`, `evaluator`, `executor.low`, `executor.high`) exist in the provider's model catalog — a mismatch throws a `TepaConfigError` with a clear message naming the field and listing the available models.

Each provider exports type-safe constants to avoid typos:

```typescript
import { AnthropicModels } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: AnthropicModels.Claude_Sonnet_4_6,
      evaluator: AnthropicModels.Claude_Sonnet_4_6,
      executor: {
        low: AnthropicModels.Claude_Haiku_4_5,
        high: AnthropicModels.Claude_Sonnet_4_6,
      },
    },
  },
});
```

String literals still work — the constants are just regular strings with autocomplete support.

### Per-Step Tier Selection

The Planner sees the two executor tiers in its system prompt and assigns a `tier` field — `"low"` or `"high"` — to each step it generates:

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
      tier: "low", // Trivial tool-param construction
    },
    {
      id: "step_2",
      description: "Synthesize findings into a narrative report",
      tools: [],
      expectedOutcome: "A well-structured analysis report",
      dependencies: ["step_1"],
      tier: "high", // Reasoning / synthesis
    },
  ],
}
```

When a step's `tier` is omitted, the executor defaults to `"low"`. During execution, `tier` resolves to the configured `executor.low` or `executor.high` model ID. Tier assignments are generated automatically by the Planner based on step complexity — you configure the two models, and the Planner decides which one runs each step.

### Available Model Constants

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

Tepa uses standard semantic log levels: `"debug"`, `"info"`, `"warn"`, `"error"`. The `level` setting controls the minimum severity that produces output — messages below the configured level are suppressed.

Default logging is implemented as **event default behaviors** — they run automatically after any user event callbacks. If you need to replace the default logging for a specific event, call `ctx.preventDefault()` in your event callback. See [Event System Patterns — Default Behaviors and `preventDefault()`](./07-event-system-patterns.md#default-behaviors-and-preventdefault) for details.

### Log Levels

| Level     | Shows                                                         |
| --------- | ------------------------------------------------------------- |
| `"debug"` | Everything: token counts, output previews, budget percentages |
| `"info"`  | Pipeline banners, stage summaries, step progress (default)    |
| `"warn"`  | Warnings (e.g., retry attempts, approaching budget limits)    |
| `"error"` | Errors only — silent operation otherwise                      |

### Example Output (`"info"` level)

```
> Pipeline started -- goal: "List the files in ./src..."
  Tools: 4 | Limits: 5 cycles, 64000 tokens
----------------------------------------------
[cycle 1] Planning ... 2 steps (5.4s)
[cycle 1]   -> step 1/2 (directory_list) + 922ms
[cycle 1]   -> step 2/2 (file_write) + 4.4s
[cycle 1] Execution ... 2/2 succeeded (5.3s)
[cycle 1] Evaluation ... pass | confidence 0.92 (2.3s)
----------------------------------------------
[OK] Pipeline completed -- pass | 1 cycle | 3774 tokens | 14.4s
  Models: claude-sonnet-4-6, claude-haiku-4-5
```

At `"debug"` level, additional detail appears: token counts per step, output previews, budget percentages, and per-model token breakdowns.

### Pluggable Logger

Tepa's logging system is library-agnostic. By default, a built-in console logger is used. You can pass any logger that implements the `TepaLogger` interface:

```typescript
interface TepaLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
```

Most popular logging libraries (pino, winston, console) already satisfy this interface out of the box:

```typescript
import pino from "pino";

const logger = pino({ level: "debug" });

const tepa = new Tepa({
  provider: new AnthropicProvider({ logger }),
  tools: [...],
  logger,  // All pipeline logs route through pino
  config: {
    logging: { level: "debug" },
  },
});
```

Pass the same logger to both `Tepa` and your LLM provider for unified log output. If your logger library uses different method names (e.g., bunyan's `trace` instead of `debug`), write a thin adapter:

```typescript
const tepa = new Tepa({
  logger: {
    debug: (msg, meta) => bunyanLogger.trace(meta ?? {}, msg),
    info: (msg, meta) => bunyanLogger.info(meta ?? {}, msg),
    warn: (msg, meta) => bunyanLogger.warn(meta ?? {}, msg),
    error: (msg, meta) => bunyanLogger.error(meta ?? {}, msg),
  },
  // ...
});
```

Regardless of the logger or level setting, structured `LogEntry` data is always available in the result:

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
  logging: { level: "verbose" },
});
// Throws TepaConfigError:
// "Invalid configuration: limits.maxCycles: Number must be greater than 0;
//  logging.level: Invalid enum value. Expected 'debug' | 'info' | 'warn' | 'error',
//  received 'verbose'"
```

Validation rules by field:

| Field                                                                       | Rule                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------- |
| `model.planner`, `model.evaluator`, `model.executor.low`, `model.executor.high` | Non-empty string                            |
| `limits.maxCycles`                                                          | Positive integer (> 0)                          |
| `limits.maxTokens`                                                          | Positive integer (> 0)                          |
| `limits.toolTimeout`                                                        | Positive integer (> 0)                          |
| `limits.retryAttempts`                                                      | Non-negative integer (>= 0)                     |
| `logging.level`                                                             | One of `"debug"`, `"info"`, `"warn"`, `"error"` |

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
