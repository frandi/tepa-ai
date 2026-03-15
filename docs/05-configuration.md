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

Assigns a model to each pipeline stage.

```typescript
interface ModelConfig {
  planner: string;
  executor: string;
  evaluator: string;
}
```

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

| Setting | Default | Description |
|---|---|---|
| `model.planner` | `"claude-sonnet-4-6"` | Model used to generate and revise plans. |
| `model.executor` | `"claude-haiku-4-5"` | Model used to execute each plan step. |
| `model.evaluator` | `"claude-sonnet-4-6"` | Model used to judge execution results. |
| `limits.maxCycles` | `5` | Maximum Plan-Execute-Evaluate iterations before the pipeline stops. |
| `limits.maxTokens` | `64_000` | Total token budget across all LLM calls in all cycles. |
| `limits.toolTimeout` | `30_000` | Timeout for tool execution in milliseconds. |
| `limits.retryAttempts` | `1` | Retry attempts for recoverable step failures. |
| `logging.level` | `"standard"` | Console output verbosity. |

The defaults follow a cost-efficiency pattern: a more capable model for planning and evaluation (where reasoning quality matters most), and a faster, cheaper model for execution (where the task is often just constructing tool call parameters). You only need to override what you want to change.

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

Model strings must match what your LLM provider accepts. If you're using the OpenAI provider, these would be OpenAI model names; if using Gemini, Gemini model names. The config passes them through without validating against the provider.

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

### `"minimal"`

No console output. Log entries are still collected and available in `result.logs` after the run completes. Use this for production environments or when you're capturing logs programmatically.

### `"standard"` (default)

Prints a line for each significant event — cycle starts, step executions, tool calls:

```
[cycle 1] [step step_1] (file_read) Reading source files
[cycle 1] [step step_2] Analyzing code structure
[cycle 1] [step step_3] (file_write) Writing report
```

Format: `[cycle {N}] [step {ID}] ({tool}) {message}`

### `"verbose"`

Everything in `"standard"`, plus duration and token usage for each entry:

```
[cycle 1] [step step_1] (file_read) Reading source files (245ms) [1200 tokens]
[cycle 1] [step step_2] Analyzing code structure (1830ms) [3400 tokens]
[cycle 1] [step step_3] (file_write) Writing report (520ms) [2100 tokens]
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

| Field | Rule |
|---|---|
| `model.planner`, `model.executor`, `model.evaluator` | Non-empty string |
| `limits.maxCycles` | Positive integer (> 0) |
| `limits.maxTokens` | Positive integer (> 0) |
| `limits.toolTimeout` | Positive integer (> 0) |
| `limits.retryAttempts` | Non-negative integer (>= 0) |
| `logging.level` | One of `"minimal"`, `"standard"`, `"verbose"` |

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
