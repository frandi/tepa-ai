# Configuration

Tepa's configuration controls how many cycles the pipeline runs, how many tokens it can spend, which models drive each stage, and how much logging you see. Every setting has a sensible default — you only need to configure what you want to change.

## `TepaConfig` Structure

```typescript
interface TepaConfig {
  model: ModelConfig;
  limits: LimitsConfig;
  tools: string[];
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

## Default Values

| Setting | Default | Description |
|---|---|---|
| `model.planner` | `"claude-sonnet-4-6"` | Model used to generate and revise plans. |
| `model.executor` | `"claude-haiku-4-5"` | Model used to execute each plan step. |
| `model.evaluator` | `"claude-sonnet-4-6"` | Model used to judge execution results. |
| `limits.maxCycles` | `5` | Maximum Plan-Execute-Evaluate iterations before the pipeline stops. |
| `limits.maxTokens` | `64_000` | Total token budget across all LLM calls in all cycles. |
| `limits.toolTimeout` | `30_000` | Timeout for tool execution in milliseconds. |
| `limits.retryAttempts` | `1` | Number of retry attempts for recoverable failures. |
| `logging.level` | `"standard"` | Console output verbosity. |

These defaults are exported as `DEFAULT_CONFIG` from `@tepa/core` if you need to reference them programmatically.

## Partial Configuration with `defineConfig()`

You don't need to specify every field. Pass only what you want to override — `defineConfig()` deep-merges your partial config with the defaults and validates the result using Zod.

```typescript
import { defineConfig } from "@tepa/core";

const config = defineConfig({
  limits: { maxCycles: 10 },
});
// limits.maxCycles → 10
// limits.maxTokens → 64_000 (default)
// limits.toolTimeout → 30_000 (default)
// Everything else → defaults
```

The deep merge works at any nesting level. You can override a single model while keeping the others:

```typescript
const config = defineConfig({
  model: { planner: "claude-opus-4-6" },
});
// model.planner → "claude-opus-4-6"
// model.executor → "claude-haiku-4-5" (default)
// model.evaluator → "claude-sonnet-4-6" (default)
```

In practice, you usually pass partial config directly to the `Tepa` constructor — `defineConfig()` is called internally:

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

Calling `defineConfig()` explicitly is useful when you want to inspect or reuse the resolved config before constructing a `Tepa` instance.

## Model Configuration

The three pipeline stages — Planner, Executor, and Evaluator — each use their own model. The defaults follow a cost-efficiency pattern: a more capable model for planning and evaluation (where reasoning quality matters most), and a faster, cheaper model for execution (where the task is often just constructing tool parameters).

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  config: {
    model: {
      planner: "claude-opus-4-6",     // Complex reasoning for plan generation
      executor: "claude-sonnet-4-6",   // Mid-tier for tool execution
      evaluator: "claude-opus-4-6",    // Thorough judgment on results
    },
  },
});
```

The model strings must match what your LLM provider accepts. If you're using the OpenAI provider, these would be OpenAI model names; if using Gemini, Gemini model names. The config doesn't validate model names against the provider — it just passes them through.

### Per-Step Model Overrides

Beyond the three stage-level models, individual plan steps can override the executor model. The Planner is given the available models (planner and executor) in its system prompt and can assign a `model` field to any step:

```typescript
// The Planner might generate a plan like this:
{
  steps: [
    {
      id: "step_1",
      description: "Read and analyze the CSV data",
      tools: ["file_read"],
      expectedOutcome: "Raw CSV content loaded",
      dependencies: [],
      // No model override — uses config.model.executor (default)
    },
    {
      id: "step_2",
      description: "Synthesize findings into a narrative report",
      tools: [],
      expectedOutcome: "A well-structured analysis report",
      dependencies: ["step_1"],
      model: "claude-sonnet-4-6",  // Override: use a more capable model for reasoning
    },
  ],
}
```

During execution, if a step has a `model` field, it takes precedence over `config.model.executor`. If it doesn't, the executor default is used. This gives the Planner fine-grained control — using the cheaper model for simple tool calls and the more capable model for complex reasoning steps.

## Limits Configuration

### `maxCycles`

The maximum number of Plan-Execute-Evaluate iterations the pipeline will run. Each cycle consists of a full planning phase, execution of all steps, and evaluation of the results.

- If the Evaluator returns `pass` before reaching the limit, the pipeline returns immediately.
- If the limit is reached without a `pass`, the pipeline returns with status `"fail"` and the last evaluator feedback.

Set this based on your tolerance for retries. A simple task might pass on cycle 1. A complex code-generation task with tests might need 3-4 cycles to self-correct. Setting it too high risks burning tokens on a fundamentally broken approach.

```typescript
config: {
  limits: { maxCycles: 3 },  // Allow up to 3 attempts
}
```

### `maxTokens`

The total token budget for the entire pipeline run — across all LLM calls in all cycles (planner, every executor step, evaluator, per cycle).

The `TokenTracker` checks the budget after every LLM call. If the cumulative count exceeds the budget at any checkpoint, the current cycle is interrupted immediately and the pipeline returns with status `"terminated"`.

```typescript
config: {
  limits: { maxTokens: 200_000 },  // Cap total spend at 200K tokens
}
```

This is a hard ceiling, not a soft target. The pipeline won't gracefully finish the current cycle — it stops as soon as the budget is exceeded. Plan accordingly: if your task typically uses 50K tokens per cycle and you allow 3 cycles, set the budget to at least 150K with some headroom.

### `toolTimeout`

Timeout in milliseconds for individual tool executions.

```typescript
config: {
  limits: { toolTimeout: 60_000 },  // 60 seconds per tool call
}
```

### `retryAttempts`

Number of retry attempts for recoverable failures during pipeline execution.

```typescript
config: {
  limits: { retryAttempts: 2 },  // Retry up to 2 times
}
```

## Logging Configuration

The `level` setting controls how much the pipeline prints to the console. All three levels collect the same structured `LogEntry` data internally — the difference is only in what appears on screen.

### `"minimal"`

No console output. Log entries are still collected and available in the `TepaResult.logs` array after the run completes. Use this for production environments or when you're capturing logs programmatically.

### `"standard"` (default)

Prints a line for each significant event — cycle starts, step executions, tool calls:

```
[cycle 1] [step step_1] (file_read) Reading source files
[cycle 1] [step step_2] Analyzing code structure
[cycle 1] [step step_3] (file_write) Writing report
```

Format: `[cycle {N}] [step {ID}] ({tool}) {message}`

### `"verbose"`

Everything in `standard`, plus duration and token usage for each entry:

```
[cycle 1] [step step_1] (file_read) Reading source files (245ms) [1200 tokens]
[cycle 1] [step step_2] Analyzing code structure (1830ms) [3400 tokens]
[cycle 1] [step step_3] (file_write) Writing report (520ms) [2100 tokens]
```

Use this during development and debugging to understand where time and tokens are going.

Regardless of the level, every entry is always available after the run:

```typescript
const result = await tepa.run(prompt);

for (const entry of result.logs) {
  // entry: { timestamp, cycle, step?, tool?, message, durationMs?, tokensUsed? }
}
```

## Invalid Configuration Errors

When `defineConfig()` encounters invalid values, it throws a `TepaConfigError` with a message listing every failing field, its path, and the reason:

```typescript
import { defineConfig } from "@tepa/core";

defineConfig({
  limits: { maxCycles: -1 },
  logging: { level: "debug" },
});
// Throws TepaConfigError:
// "Invalid configuration: limits.maxCycles: Number must be greater than 0;
//  logging.level: Invalid enum value. Expected 'minimal' | 'standard' | 'verbose',
//  received 'debug'"
```

The validation rules:

| Field | Rule |
|---|---|
| `model.planner`, `model.executor`, `model.evaluator` | Non-empty string |
| `limits.maxCycles` | Positive integer (> 0) |
| `limits.maxTokens` | Positive integer (> 0) |
| `limits.toolTimeout` | Positive integer (> 0) |
| `limits.retryAttempts` | Non-negative integer (>= 0) |
| `logging.level` | One of `"minimal"`, `"standard"`, `"verbose"` |

A `TepaConfigError` is a subclass of `TepaError`, so you can catch it specifically:

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

## Loading Configuration from Files

The `loadConfig` utility reads a JSON or YAML file and returns a validated `TepaConfig`:

```typescript
import { loadConfig } from "@tepa/core";

const config = await loadConfig("./tepa.config.yaml");
```

Supported formats: `.json`, `.yaml`, `.yml`. The loaded data is passed through `defineConfig()`, so partial configs work — you only need to include the fields you want to override.

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

Unsupported file extensions throw a `TepaConfigError`.

## What's Next

- [**Tool System**](./06-tool-system.md) — Define, register, and use built-in and custom tools.
- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop, plan safety filters, progress tracking, and more.
- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, and custom provider implementation.
