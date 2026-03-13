# @tepa/core

Core pipeline engine for the Tepa autonomous agent framework. Contains the orchestrator, Planner, Executor, Evaluator, event bus, configuration, and prompt parsing.

## Install

```bash
npm install @tepa/core
```

## Usage

```typescript
import { Tepa } from "@tepa/core";
import type { LLMProvider, ToolDefinition } from "@tepa/types";

const tepa = new Tepa({
  tools: [
    /* ToolDefinition objects */
  ],
  provider: myLLMProvider, // implements LLMProvider interface
  config: {
    limits: { maxCycles: 3, maxTokens: 20_000 },
  },
});

const result = await tepa.run({
  goal: "Create a TypeScript utility",
  context: { projectDir: "./src" },
  expectedOutput: "A working utility file with tests",
});
```

## API

### `Tepa`

The main orchestrator class.

```typescript
new Tepa(options: TepaOptions)
```

**`TepaOptions`:**

- `tools: ToolDefinition[]` — Tools available to the pipeline
- `provider: LLMProvider` — LLM provider for all components
- `config?: DeepPartial<TepaConfig>` — Configuration (merged with defaults)
- `events?: EventMap` — Event hook callbacks

**`tepa.run(prompt: TepaPrompt): Promise<TepaResult>`**

Runs the full pipeline loop. Returns when the evaluator passes, max cycles are reached, or the token budget is exhausted.

### `defineConfig`

Merges a partial config with sensible defaults:

```typescript
import { defineConfig } from "@tepa/core";

const config = defineConfig({
  limits: { maxCycles: 10 },
  logging: { level: "verbose" },
});
```

### `parsePromptFile`

Loads a prompt from a YAML or JSON file:

```typescript
import { parsePromptFile } from "@tepa/core";

const prompt = await parsePromptFile("./prompts/task.yaml");
```

### `EventBus`

The internal event execution engine (exposed for advanced usage):

```typescript
import { EventBus } from "@tepa/core";
import type { EventMap } from "@tepa/types";

const bus = new EventBus(events);
const result = await bus.run("prePlanner", data, cycleMetadata);
```

### Core Components

Individual components are exported for advanced usage (most users only need `Tepa`):

- `Planner` — Generates execution plans from prompts
- `Executor` — Executes plan steps using native tool calling and LLM reasoning
- `Evaluator` — Judges execution results against expected output
- `Scratchpad` — In-memory key-value store for cross-step state

### Error Types

- `TepaError` — Base error class
- `TepaConfigError` — Invalid configuration
- `TepaPromptError` — Invalid prompt
- `TepaToolError` — Tool execution failure
- `TepaCycleError` — Pipeline cycle failure
- `TepaTokenBudgetExceeded` — Token budget exhausted

## Configuration Defaults

```typescript
{
  model: {
    planner: "claude-sonnet-4-20250514",
    executor: "claude-sonnet-4-20250514",
    evaluator: "claude-sonnet-4-20250514",
  },
  limits: {
    maxCycles: 5,
    maxTokens: 10_000,
    toolTimeout: 30_000,
    retryAttempts: 1,
  },
  logging: {
    level: "standard",
  },
}
```
