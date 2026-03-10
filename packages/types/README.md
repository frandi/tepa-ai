# @tepa/types

Shared TypeScript interfaces for the Tepa agent pipeline. Zero runtime dependencies — this package contains only type definitions.

## Install

```bash
npm install @tepa/types
```

## Usage

This package is primarily for **custom tool authors** who need to implement the `ToolDefinition` interface without depending on the full Tepa engine:

```typescript
import type { ToolDefinition } from "@tepa/types";

export const myTool: ToolDefinition = {
  name: "my_tool",
  description: "Does something useful",
  parameters: {
    input: { type: "string", description: "Input value", required: true },
  },
  execute: async ({ input }) => {
    return { result: `processed: ${input}` };
  },
};
```

## Exported Types

### Core Pipeline

- `TepaPrompt` — Input prompt with goal, context, and expected output
- `TepaConfig` — Pipeline configuration (models, limits, logging)
- `TepaResult` — Final pipeline output (status, cycles, tokens, logs)
- `Plan`, `PlanStep` — Structured execution plan
- `ExecutionResult` — Result from a single execution step
- `EvaluationResult` — Evaluator verdict (pass/fail with feedback)

### Tools

- `ToolDefinition` — Tool contract (name, description, parameters, execute function)
- `ParameterDef` — Tool parameter schema
- `ToolRegistry` — Interface for tool storage and lookup
- `ToolSchema` — Serializable tool schema for LLM context

### LLM Provider

- `LLMProvider` — Abstract provider interface (`complete` method)
- `LLMMessage` — Chat message (role + content)
- `LLMResponse` — Provider response (text, tokens, finish reason, tool use blocks)
- `LLMToolUseBlock` — A structured tool call returned by the LLM (id, name, input)
- `LLMRequestOptions` — Request options (model, temperature, system prompt, tool schemas)

### Events

- `EventName` — The 8 event hook points
- `EventCallback` — Callback function signature
- `EventRegistration` — Callback with `continueOnError` option
- `EventMap` — Map of event names to callback arrays
- `CycleMetadata` — Cycle number, total cycles, tokens used

### Config

- `ModelConfig` — Per-component model assignment
- `LimitsConfig` — Max cycles, token budget, timeouts
- `LoggingConfig` — Log level and output path
- `DeepPartial<T>` — Deep partial utility type
