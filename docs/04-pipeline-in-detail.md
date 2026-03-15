# Pipeline in Detail

This is the complete technical reference for the Tepa pipeline. It assumes you've read [How Tepa Works](./03-how-tepa-works.md) and are now building something — writing custom events, designing multi-output prompts, debugging a cycle, or integrating Tepa into a larger system.

Conceptual explanations of what each component does and why the loop is structured the way it is live in How Tepa Works. This document covers the exact interfaces, validation rules, data contracts, and edge cases you need when the conceptual model isn't enough.

---

## Prompt Structure

Every pipeline run starts with a `TepaPrompt` — the input that tells Tepa what to accomplish.

```typescript
interface TepaPrompt {
  goal: string;
  context: Record<string, unknown>;
  expectedOutput: string | ExpectedOutput[];
}
```

| Field | Description |
|---|---|
| `goal` | What the pipeline should accomplish. Sent to the Planner, Executor, and Evaluator — the single source of truth for the task. |
| `context` | Arbitrary key-value data providing background information: file paths, configuration values, domain knowledge — anything the LLM needs to understand the environment. |
| `expectedOutput` | What success looks like. A simple string works for straightforward goals. Use the structured `ExpectedOutput[]` form when the evaluator needs to check specific artifacts with explicit criteria. |

### Structured `expectedOutput`

When your goal has multiple deliverables, or when you need the Evaluator to check specific artifacts against explicit criteria, use the structured form:

```typescript
interface ExpectedOutput {
  path?: string;
  description: string;
  criteria?: string[];
}
```

A simple string `expectedOutput` works for straightforward goals:

```typescript
await tepa.run({
  goal: "List the files in ./src and write a summary to ./summary.md.",
  context: { projectDir: "./src" },
  expectedOutput: "A file at ./summary.md describing the project structure.",
});
```

The structured form gives the Evaluator explicit checkpoints per artifact:

```typescript
await tepa.run({
  goal: "Create a TypeScript API client for the JSONPlaceholder API.",
  context: { projectRoot: "./my-project", language: "TypeScript" },
  expectedOutput: [
    {
      path: "src/api/jsonplaceholder.ts",
      description: "A typed API client class with methods for posts, users, and comments",
      criteria: [
        "Uses axios.create() with baseURL",
        "Methods are fully typed with return types",
        "Exports a default client instance",
      ],
    },
    {
      path: "src/api/types.ts",
      description: "TypeScript type definitions for API response shapes",
      criteria: ["Post, User, and Comment interfaces defined"],
    },
  ],
});
```

Each `criteria` entry becomes an explicit checklist item the Evaluator assesses independently. A failed criterion produces specific, targeted feedback to the Planner — not a vague "output fell short."

### Loading Prompts from Files

The `parsePromptFile` utility loads and validates prompts from YAML or JSON files:

```typescript
import { parsePromptFile } from "@tepa/core";

const prompt = await parsePromptFile("./prompts/task.yaml");
const result = await tepa.run(prompt);
```

Supported extensions: `.yaml`, `.yml`, `.json`. The loaded data is validated against the `TepaPrompt` schema using Zod — missing fields, empty goals, or malformed `expectedOutput` values throw a `TepaPromptError` with a descriptive message.

YAML prompt file example:

```yaml
goal: >
  Analyze student learning progress for Class 5B
  and produce an insight report with actionable recommendations.

context:
  classDir: ./class-5b
  gradeFile: grades.csv
  attendanceFile: attendance.csv
  gradingPolicy:
    failing: 60
    intervention: 70

expectedOutput:
  - path: ./class-5b/progress-report.md
    description: A comprehensive progress report
    criteria:
      - Class-wide performance overview with averages and pass rates
      - Per-subject trend analysis
      - Individual student flags for at-risk students
  - path: ./class-5b/flagged-students.csv
    description: Summary CSV of at-risk students
    criteria:
      - Columns include student name, overall percentage, urgency level
```

Externalizing prompts from code makes it easy to version, share, and iterate on task definitions without touching application logic.

---

## Planner

### `Plan` and `PlanStep` Interfaces

```typescript
interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}

interface PlanStep {
  id: string;           // e.g., "step_1" — unique within the plan
  description: string;  // what this step does
  tools: string[];      // tool names to call; empty array = reasoning step
  expectedOutcome: string; // what success looks like for this step
  dependencies: string[];  // IDs of steps that must complete first
  model?: string;       // optional per-step model override
}
```

`reasoning` captures the LLM's explanation for why it structured the plan this way — useful when debugging unexpected step sequences. `estimatedTokens` is the LLM's token estimate for the execution phase.

### Dependency Rules

The Planner is instructed to follow these rules when declaring dependencies. Violations are caught during plan validation before any step runs:

- **Direct dependencies only.** If step_3 depends on step_2 which depends on step_1, step_3 should list only `["step_2"]` unless it directly needs step_1's output. The Executor enforces scoped inputs: a step only receives the outputs of its declared dependencies.
- **Unique IDs.** Every step ID must be unique within the plan. Duplicates are rejected.
- **Valid references.** Every dependency must reference a step ID that exists in the same plan. Forward references to nonexistent steps are rejected.
- **No circular chains.** The Executor detects circular dependencies via topological sort and throws before any step runs.

### Reasoning Steps vs. Tool Steps

A step with an empty `tools` array is a reasoning step — the LLM produces a text response without invoking any tools. Use reasoning steps as data-distillation boundaries: summarize or extract key findings from raw tool output before downstream steps consume it. The Planner is instructed to use them this way.

### Per-Step Model Overrides

Each step can optionally specify a `model` field to override the executor's default model for that step alone. The Planner is given the list of available configured models and instructed to assign the more capable model to complex reasoning steps and the default to simpler tool-parameter-construction steps. This lets you balance quality and cost within a single plan.

### Plan Validation

After the LLM response is parsed, the plan goes through structural and semantic validation before reaching the Executor:

1. `reasoning` must be a non-empty string; `estimatedTokens` must be a non-negative number.
2. `steps` must be a non-empty array.
3. Every step must have a non-empty `id`, `description`, and `expectedOutcome`. `tools` and `dependencies` must contain only strings.
4. Step IDs must be unique across the plan.
5. Every dependency reference must resolve to an existing step ID in the same plan.
6. Every tool name referenced in any step is checked against the tool registry. Unknown tool names throw a `TepaCycleError` listing the unrecognised tool and the available alternatives.

### Re-Planning on Failure

When the Evaluator returns `fail`, the Planner switches to a revised-plan prompt:

- The system prompt instructs it to produce a **minimal revision** — fix only what failed, reuse what succeeded.
- The user message includes the original goal and expected output, the current scratchpad state (including `_execution_summary` from the previous cycle), and the evaluator's actionable feedback.
- The revised plan must be fully self-contained: all dependency references must point to step IDs within the revised plan, not the previous one.

### Parse Failure Retry

If the LLM response can't be parsed as valid JSON, the Planner retries once. The retry sends the original conversation plus the unparseable response with a simplified prompt asking for a JSON object only — no markdown, no code fences. If parsing fails again, the cycle throws a `TepaCycleError`. The pipeline catches this and returns a structured failure rather than crashing.

---

## Executor

### Topological Sorting

Before executing anything, the Executor sorts plan steps using **Kahn's algorithm** — a BFS-based topological sort that resolves all declared dependencies into a safe execution order.

```
Given: A (no deps), B (depends on A), C (no deps), D (depends on B and C)

In-degree:  A=0, B=1, C=0, D=2
Queue seed: [A, C]       ← zero in-degree, original plan order preserved

Process A → decrement B (now 0) → queue: [C, B]
Process C → decrement D (now 1) → queue: [B]
Process B → decrement D (now 0) → queue: [D]
Process D → queue empty

Sorted order: [A, C, B, D]
```

If the sorted result contains fewer steps than the original plan, a circular dependency exists. The Executor throws a `TepaCycleError` immediately — before any step runs.

When multiple steps have no dependency relationship, the original plan order is preserved. This gives the Planner control over execution sequence even among independent steps.

### Step Execution Flow

For each step in sorted order:

1. **Dependency check.** If any declared upstream dependency failed, the step is immediately marked as failed: `Skipped: dependency "step_X" failed`. Failures cascade — no tokens are spent on a step whose inputs are already broken.
2. **Scoped inputs.** The step receives only the outputs of its declared dependencies. The framework filters the output map to the step's dependency list — a step cannot read data from a step it didn't declare a dependency on.
3. **Execution.** Tool step or reasoning step (see below).
4. **Result capture.** Output is stored in the step outputs map and made available to any downstream step declaring this step as a dependency.

### Native Tool Calling

For steps with tools assigned:

1. Each tool name is looked up in the registry to get its `ToolSchema`.
2. A message is assembled: step description, expected outcome, original goal, prompt context, current scratchpad state, and the outputs of declared dependency steps.
3. The message is sent to the LLM with the tool schema attached via the provider's native tool-use API. The LLM returns a structured `tool_use` block with pre-parsed, typed parameters — no regex extraction, no free-form JSON parsing.
4. The tool's `execute` function is called directly with those parameters. The result is captured as the step's output.

If the LLM doesn't return a `tool_use` block — i.e., it responds with text instead of a tool call — the step fails with: `LLM did not call tool "X" — no tool_use block in response`.

**Multi-tool steps:** When a step specifies multiple tools, they are called sequentially in array order. Each tool goes through the full schema-lookup → LLM-call → invoke cycle. The step's output is a single value if one tool was used, or an array if multiple tools were called.

### Reasoning Steps

Steps with an empty `tools` array are executed using a reasoning-specific system prompt. The Executor sends the step description, expected outcome, goal context, scratchpad state, and dependency outputs to the LLM and captures the text response as the step's output. No tools are invoked.

### `ExecutionResult` Interface

```typescript
interface ExecutionResult {
  stepId: string;
  status: "success" | "failure";
  output: unknown;
  error?: string;
  tokensUsed: number;
  durationMs: number;
}
```

| Field | Description |
|---|---|
| `stepId` | The step's ID from the plan. |
| `status` | `"success"` if the step completed and produced output. `"failure"` if the tool wasn't found, the LLM didn't return a tool call, an exception occurred, or a dependency failed. |
| `output` | The tool's return value, the LLM's text response (reasoning steps), or `null` on failure. |
| `error` | Present only on failure — describes what went wrong. |
| `tokensUsed` | Tokens consumed by the LLM call(s) for this step. |
| `durationMs` | Wall-clock time for the step in milliseconds. |

### Automatic `_execution_summary` Write

After all steps complete, the orchestrator writes `_execution_summary` to the scratchpad:

```typescript
scratchpad.write(
  "_execution_summary",
  results.map((r) => ({
    stepId: r.stepId,
    status: r.status,
    output: r.output,
    ...(r.error ? { error: r.error } : {}),
  })),
);
```

This persists across cycles. On the next cycle, the Planner reads it and builds on what already succeeded — avoiding repeated work and making self-correction efficient.

---

## Evaluator

### What the Evaluator Checks

The evaluation message sent to the LLM includes: the goal, the full `expectedOutput` definition (including any criteria arrays), a summary of every step's result (status, output truncated to 500 characters, errors if any, tokens, and duration), and the current scratchpad state.

The system prompt instructs the LLM to apply strict verdict rules:

- `pass` **only** if the goal is fully achieved and all expected outputs are complete.
- `fail` if **any** expected output is missing, incomplete, or fails any criterion.
- Feedback on `fail` must be **specific and actionable** — referencing which steps failed and precisely what should change on the next attempt.

### `EvaluationResult` Interface

```typescript
interface EvaluationResult {
  verdict: "pass" | "fail";
  confidence: number;  // 0.0 – 1.0
  feedback?: string;   // required on fail — actionable explanation for the Planner
  summary?: string;    // optional on pass — becomes result.feedback in TepaResult
  tokensUsed: number;
}
```

`feedback` on `fail` is not just a log message — it is the exact input the Planner receives on the next cycle to guide its revision. The quality of the evaluator's feedback directly determines the quality of self-correction.

### Parse Failure Handling

Like the Planner, the Evaluator retries once if the LLM response can't be parsed. If both attempts fail, it returns a synthetic fail result with `confidence: 0` and the raw LLM response (truncated to 500 characters) as feedback. This ensures the pipeline can self-correct on the next cycle rather than crashing — the Planner will receive the raw response as context and can attempt a different approach.

---

## Pipeline Lifecycle Events

### What Each Event Receives and Can Modify

| Event | Data Received | Can Modify |
|---|---|---|
| `prePlanner` | `{ prompt, feedback? }` | The prompt sent to the Planner; the feedback text |
| `postPlanner` | `Plan` | The plan before it reaches the Executor — add, remove, or modify steps |
| `preExecutor` | `{ plan, prompt, cycle, scratchpad, previousResults? }` | The plan, prompt, and context before execution |
| `postExecutor` | `{ results, logs, tokensUsed }` | Execution results before they reach the Evaluator |
| `preEvaluator` | `{ prompt, results, scratchpad }` | The data the Evaluator will assess |
| `postEvaluator` | `EvaluationResult` | The verdict — override pass/fail, adjust confidence, or modify feedback |
| `preStep` | `{ step, cycle }` | The step definition before it executes |
| `postStep` | `{ step, result, cycle }` | The step's result after execution |

Every callback also receives a `CycleMetadata` object as its second argument:

```typescript
interface CycleMetadata {
  cycleNumber: number;
  totalCyclesUsed: number;
  tokensUsed: number;
}
```

### How Callbacks Work

Callbacks run in registration order. If a callback returns a value, that value **replaces** the data for all subsequent callbacks in the chain. If a callback returns `void`, the data passes through unchanged. Callbacks can return Promises, which the framework awaits.

### Fault-Tolerant Callbacks

By default, an error in a callback stops the pipeline. To make a callback fault-tolerant, register it as an `EventRegistration` with `continueOnError: true`:

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  events: {
    postStep: [
      {
        handler: (data) => externalLogger.log(data),
        continueOnError: true,
      },
    ],
  },
});
```

When `continueOnError` is `true` and the handler throws, the data reverts to its state before that callback ran and execution continues with the next callback in the chain.

For complete patterns — human-in-the-loop approval gates, plan safety filters, progress tracking, custom termination logic — see [Event System Patterns](./07-event-system-patterns.md).

---

## Cycles and Termination

### Full Cycle Sequence

Each call to `tepa.run()` follows this sequence:

1. **Validate.** The prompt is validated against the `TepaPrompt` schema using Zod. Invalid prompts throw a `TepaPromptError` before the loop starts.
2. **Initialize.** A fresh `Scratchpad`, `TokenTracker`, `Logger`, and `EventBus` are created. Planner, Executor, and Evaluator are instantiated with their configured models.
3. **Register tools.** All tool definitions are registered in an inline `ToolRegistry`.
4. **Loop** (1 to `maxCycles`):
   - Fire `prePlanner` → run **Planner** → fire `postPlanner`
   - Fire `preExecutor` → run **Executor** (with `preStep`/`postStep` per step) → fire `postExecutor`
   - Write `_execution_summary` to scratchpad
   - Fire `preEvaluator` → run **Evaluator** → fire `postEvaluator`
   - If `pass` → return immediately
   - If `fail` → carry evaluator feedback into next cycle

### Termination Conditions

| Condition | Status | What Happens |
|---|---|---|
| Evaluator returns `pass` | `"pass"` | Returns immediately with the evaluator's summary as `feedback`. |
| Max cycles exhausted | `"fail"` | Loop ends; last evaluator feedback is returned. |
| Token budget exceeded | `"terminated"` | `TokenTracker` throws `TepaTokenBudgetExceeded` mid-cycle. Pipeline catches it and returns with tokens used. |
| Unrecoverable error | `"fail"` | Component errors (planner parse failures after retry, cycle errors) are caught and returned as structured failures. Non-Tepa errors are wrapped in `TepaError` and re-thrown. |

The `TokenTracker` checks the budget after **every** LLM call — planner, each executor step, and evaluator. If cumulative token count exceeds the budget at any point mid-cycle, the current cycle is interrupted immediately. The check does not wait for the cycle to complete.

### `TepaResult` Interface

```typescript
interface TepaResult {
  status: "pass" | "fail" | "terminated";
  cycles: number;
  tokensUsed: number;
  outputs: OutputArtifact[];
  logs: LogEntry[];
  feedback: string;
}
```

| Field | Description |
|---|---|
| `status` | `"pass"` — goal achieved. `"fail"` — max cycles or unrecoverable error. `"terminated"` — token budget exhausted. |
| `cycles` | Number of Plan-Execute-Evaluate cycles that ran. |
| `tokensUsed` | Total tokens consumed across all LLM calls in all cycles. |
| `outputs` | Artifacts produced by the pipeline. |
| `logs` | Structured log entries. |
| `feedback` | On pass: the evaluator's summary. On fail: the evaluator's feedback or an error message. On termination: the budget-exceeded message. |

Supporting types:

```typescript
interface OutputArtifact {
  path: string;
  description: string;
  type: "file" | "data" | "report";
}

interface LogEntry {
  timestamp: number;
  cycle: number;
  step?: string;
  tool?: string;
  message: string;
  durationMs?: number;
  tokensUsed?: number;
}
```

---

## Tool Schema Flow

### How the Executor Resolves Tools

When the `Tepa` constructor receives a `tools` array, it registers each `ToolDefinition` in an inline `ToolRegistry` at the start of `run()`. The same registry serves two purposes:

- **Plan validation** — every tool name in the generated plan is checked against the registry before execution begins. Unknown tool names are caught here, not mid-execution.
- **Step execution** — the Executor looks up each step's tool by name to retrieve its schema before calling the LLM.

### `ToolSchema` Interface

```typescript
interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
}

interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}
```

Tool schemas flow through the pipeline at two points:

1. **Planning.** The Planner's system prompt includes the full tool list with all parameter definitions. This gives the LLM enough information to assign the right tools to each step and declare the right parameters.
2. **Execution.** For each tool step, the Executor passes the `ToolSchema` to the LLM via the provider's native tool-use API. The provider translates this into the LLM's native format (Anthropic's `tools` parameter, OpenAI's function calling, etc.). The LLM returns a structured `tool_use` block — typed parameters, no text parsing.

For a complete guide to defining custom tools and building third-party tool packages, see [Tool System](./06-tool-system.md).

---

## What's Next

- [**Configuration**](./05-configuration.md) — Cycle limits, token budgets, per-stage model assignments, and logging levels.
- [**Tool System**](./06-tool-system.md) — Built-in tools, custom tool definitions, and third-party packages.
- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and custom termination.
- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, logging, and custom provider implementation.
