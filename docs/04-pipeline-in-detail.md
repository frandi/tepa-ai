# The Pipeline in Detail

[How Tepa Works](./03-how-tepa-works.md) introduced the Plan-Execute-Evaluate cycle at a conceptual level. This section goes deeper — into the prompt structure that drives the pipeline, the internal mechanics of each component, the event system that lets you hook into every stage, and the rules that govern cycle termination.

## Prompt Structure

Every pipeline run starts with a `TepaPrompt` — the input that tells Tepa what to accomplish.

### `TepaPrompt`

```typescript
interface TepaPrompt {
  goal: string;
  context: Record<string, unknown>;
  expectedOutput: string | ExpectedOutput[];
}
```

| Field            | Description                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goal`           | What the pipeline should accomplish. This is sent to the Planner, Executor, and Evaluator — it's the single source of truth for the task.                                 |
| `context`        | Arbitrary key-value data that provides background information. File paths, configuration values, domain knowledge — anything the LLM needs to understand the environment. |
| `expectedOutput` | What success looks like. Can be a simple string description or a structured array of `ExpectedOutput` objects with paths, descriptions, and evaluation criteria.          |

### `ExpectedOutput`

When you need the Evaluator to check specific artifacts, use the structured form:

```typescript
interface ExpectedOutput {
  path?: string;
  description: string;
  criteria?: string[];
}
```

| Field         | Description                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `path`        | Optional file path or identifier for the expected artifact.                                           |
| `description` | What this output should contain or accomplish.                                                        |
| `criteria`    | Optional list of specific evaluation criteria. The Evaluator checks each one when judging the result. |

A simple string `expectedOutput` works for straightforward goals:

```typescript
await tepa.run({
  goal: "List the files in ./src and write a summary to ./summary.md.",
  context: { projectDir: "./src" },
  expectedOutput: "A file at ./summary.md describing the project structure.",
});
```

For goals with multiple deliverables, the structured form gives the Evaluator explicit checkpoints:

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
      criteria: ["Post, User, and Comment interfaces"],
    },
  ],
});
```

### Loading Prompts from Files

The `parsePromptFile` utility loads and validates prompts from YAML or JSON files:

```typescript
import { parsePromptFile } from "@tepa/core";

const prompt = await parsePromptFile("./prompts/task.yaml");
const result = await tepa.run(prompt);
```

It supports `.yaml`, `.yml`, and `.json` extensions. The loaded data is validated against the `TepaPrompt` schema using Zod — missing fields, empty goals, or malformed `expectedOutput` values throw a `TepaPromptError` with a descriptive message.

Here's what a YAML prompt file looks like:

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

## Planner

The Planner turns a goal into a structured execution plan.

### How Plans Are Generated

The Planner calls the LLM with a system prompt that includes:

1. The full list of available tools with their parameter definitions (names, types, descriptions, required flags).
2. Instructions for producing a valid `Plan` JSON object.
3. The available models (executor default and planner model) so the LLM can assign per-step model overrides.
4. Rules governing dependency structure, tool references, and plan minimality.

The user message contains the goal, context, and expected output from the `TepaPrompt`.

The LLM responds with a JSON object, which is parsed and validated.

### `Plan` and `PlanStep` Structure

```typescript
interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}

interface PlanStep {
  id: string; // e.g., "step_1"
  description: string; // what this step does
  tools: string[]; // tool names to call (empty = reasoning step)
  expectedOutcome: string; // what success looks like for this step
  dependencies: string[]; // IDs of steps that must complete first
  model?: string; // optional per-step model override
}
```

The `reasoning` field captures the LLM's explanation for why it structured the plan this way. The `estimatedTokens` field is the LLM's estimate of how many tokens the plan will consume during execution.

### Dependency Rules

The Planner is instructed to follow these rules when declaring dependencies:

- **Direct dependencies only.** If step_3 depends on step_2 which depends on step_1, step_3 should list only `["step_2"]` — not `["step_1", "step_2"]` — unless it directly needs step_1's output. The Executor enforces this: a step only receives the outputs of its declared dependencies.
- **Unique IDs.** Every step ID must be unique within the plan. Duplicates are rejected during validation.
- **Valid references.** Every dependency must reference a step ID that exists in the same plan. Forward references to nonexistent steps are rejected.
- **Reasoning steps vs. tool steps.** A step with an empty `tools` array is a reasoning step — the LLM produces text without calling tools. The Planner is instructed to use reasoning steps as data-distillation boundaries: summarize or extract key findings from raw data before downstream steps consume it.
- **Per-step model overrides.** Each step can optionally specify a `model` field. The Planner is given the available models and instructed to use the more capable model for complex reasoning and the default executor model for simple tool parameter construction.

### Re-Planning on Failure

When the Evaluator returns `fail`, the Planner switches to a revised-plan prompt. Instead of the full tool-listing system prompt, it receives a streamlined version:

- The system prompt instructs it to produce a **minimal revision** — only fix what failed, reuse what succeeded.
- The user message includes the original goal and expected output, the current scratchpad state (including `_execution_summary` from the previous cycle), and the evaluator's feedback.
- The revised plan must be self-contained: all dependency references must point to step IDs within the revised plan, not the original.

This focused approach keeps re-planning efficient. The Planner doesn't start from scratch — it knows exactly what worked and what didn't.

### Parse Failure Retry

If the LLM's response can't be parsed as valid JSON, the Planner retries once. The retry sends the original conversation plus the unparseable response back to the LLM with a simplified prompt asking for only a JSON object — no markdown, no code fences.

If parsing fails again, the cycle throws a `TepaCycleError`. The pipeline catches this and returns a structured failure result rather than crashing.

### Plan Validation

After parsing, the plan goes through structural and semantic validation:

1. **Structural checks.** The `reasoning` field must be a string. `estimatedTokens` must be a non-negative number. The `steps` array must be non-empty. Every step must have a non-empty `id`, `description`, and `expectedOutcome`. The `tools` and `dependencies` arrays must contain only strings.
2. **Uniqueness.** Duplicate step IDs are rejected.
3. **Dependency integrity.** Every referenced dependency must exist as a step ID in the plan.
4. **Tool reference validation.** Every tool name in every step is checked against the tool registry. If a step references a tool that doesn't exist, the planner throws a `TepaCycleError` listing the unknown tool and the available alternatives.

## Executor

The Executor takes a validated plan and runs each step, coordinating tool calls through the LLM's native tool-use capability.

### Topological Sorting

Before executing anything, the Executor sorts the plan steps using **Kahn's algorithm** — a standard BFS-based topological sort. This produces an execution order that respects all declared dependencies.

```
Given steps: A (no deps), B (depends on A), C (no deps), D (depends on B, C)

In-degree:  A=0, B=1, C=0, D=2
Queue seed: [A, C]      ← zero in-degree, original plan order preserved

Process A → decrement B (now 0) → queue: [C, B]
Process C → decrement D (now 1) → queue: [B]
Process B → decrement D (now 0) → queue: [D]
Process D → queue empty

Sorted: [A, C, B, D]
```

If a circular dependency is detected (i.e., the sorted result contains fewer steps than the original plan), the Executor throws a `TepaCycleError` immediately — before any step runs.

When multiple steps have no dependency relationship, the original plan order is preserved. This gives the Planner some control over execution sequence even among independent steps.

### Step Execution Flow

For each step in the sorted order:

1. **Dependency check.** If any upstream dependency has failed, the step is immediately marked as failed with the message `Skipped: dependency "step_X" failed`. Failures cascade — a downstream step won't run if its upstream dependency didn't succeed.

2. **Scoped inputs.** The step receives only the outputs of its declared dependencies — not the full output map. This is enforced by filtering the outputs map down to the step's declared dependency list. A step can't accidentally read data from a step it didn't declare a dependency on.

3. **Execution.** The step runs as either a tool step or a reasoning step (see below).

4. **Result capture.** The output is stored in the full step outputs map and made available to any downstream step that declares this step as a dependency.

### Native Tool Calling

For steps with tools assigned, the Executor follows a structured flow:

1. **Schema lookup.** Each tool name is looked up in the registry to get its `ToolSchema` (name, description, parameter definitions).

2. **Context assembly.** A message is built containing the step description, expected outcome, tool name, original goal, prompt context, current scratchpad state, and the outputs of declared dependency steps.

3. **LLM call with tool schema.** The message is sent to the LLM with the tool schema attached via the provider's native tool-use API. The LLM returns a structured `tool_use` block with pre-parsed parameters — no regex extraction, no JSON parsing from free-form text.

4. **Tool invocation.** The tool's `execute` function is called with the LLM-provided parameters. The result is captured as the step's output.

If the LLM doesn't return a `tool_use` block (i.e., it responds with text instead of a tool call), the step is marked as failed with the message: `LLM did not call tool "X" — no tool_use block in response`.

When a step specifies multiple tools, they are called sequentially in array order. Each tool goes through the full schema-lookup → LLM-call → invoke cycle. The step's output is a single value if one tool was used, or an array if multiple tools were called.

### Reasoning Steps

Steps with an empty `tools` array are reasoning steps. The Executor sends a message with the step description, expected outcome, goal context, scratchpad state, and dependency outputs to the LLM using a reasoning-specific system prompt. The LLM's text response becomes the step's output.

Reasoning steps are useful for intermediate analysis — reviewing data from a previous step, synthesizing information, or making decisions that feed into downstream tool-calling steps.

### `ExecutionResult` Structure

Each step produces an `ExecutionResult`:

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

| Field        | Description                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stepId`     | The step's ID from the plan.                                                                                                                                                   |
| `status`     | `"success"` if the step completed and produced output. `"failure"` if the tool wasn't found, the LLM didn't return a tool call, an exception occurred, or a dependency failed. |
| `output`     | The tool's return value, the LLM's text response (for reasoning steps), or `null` on failure.                                                                                  |
| `error`      | Present only on failure — describes what went wrong.                                                                                                                           |
| `tokensUsed` | Tokens consumed by the LLM call(s) for this step.                                                                                                                              |
| `durationMs` | Wall-clock time for the step in milliseconds.                                                                                                                                  |

### Automatic Scratchpad Write

After all steps complete, the orchestrator writes `_execution_summary` to the scratchpad — a simplified array of all step results:

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

This summary persists across cycles. On the next cycle, the Planner sees it and can build on what already succeeded — enabling efficient self-correction without repeating work.

## Evaluator

After all steps complete, the Evaluator judges whether the execution results meet the goal.

### What It Checks

The Evaluator instructs the LLM to assess two dimensions:

- **Structural criteria.** Were the expected outputs produced? Do files exist in the right format? Are all required artifacts present?
- **Qualitative criteria.** Is the content meaningful and correct? Are outputs specific and relevant? Does the result actually address the goal?

The evaluation message includes the goal, expected output, a summary of every step's result (status, output truncated to 500 characters, errors if any, tokens, and duration), and the current scratchpad state.

The verdict rules are explicit in the system prompt:

- `pass` only if the goal is **fully** achieved and expected outputs are complete.
- `fail` if **any** expected output is missing, incomplete, or incorrect.
- Feedback on `fail` must be specific and actionable — referencing specific steps that failed and what should change.

### `EvaluationResult` Structure

```typescript
interface EvaluationResult {
  verdict: "pass" | "fail";
  confidence: number; // 0.0 – 1.0
  feedback?: string; // required on fail — actionable explanation
  summary?: string; // optional on pass — brief description of success
  tokensUsed: number;
}
```

On `fail`, the `feedback` field is exactly what the Planner receives on the next cycle to guide its revised plan. On `pass`, the `summary` becomes the `feedback` field in the final `TepaResult`.

### Parse Failure Handling

Like the Planner, the Evaluator retries once if the LLM response can't be parsed as valid JSON. The retry sends the original conversation plus the unparseable response with a simplified prompt.

If both attempts fail, it returns a synthetic fail result with `confidence: 0` and the raw LLM response (truncated to 500 characters) as feedback. This ensures the pipeline can still self-correct on the next cycle rather than crashing — the Planner will see the feedback and can attempt a different approach.

## Pipeline Lifecycle Events

Eight lifecycle hooks let you observe, transform, or control the pipeline at every stage.

### The 8 Event Points

```
  prePlanner ──▶ Planner ──▶ postPlanner
                                  │
                                  ▼
  preExecutor ──▶ Executor ──▶ postExecutor
                     │
                     ├── preStep ──▶ Step ──▶ postStep
                     ├── preStep ──▶ Step ──▶ postStep
                     └── preStep ──▶ Step ──▶ postStep
                                  │
                                  ▼
  preEvaluator ──▶ Evaluator ──▶ postEvaluator
                                  │
                                  ▼
                            [pass → Done]
                            [fail → back to prePlanner]
```

### What Each Event Receives and Can Modify

| Event           | Data Received                                           | Can Modify                                                                  |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `prePlanner`    | `{ prompt, feedback? }`                                 | The prompt sent to the Planner; the feedback text                           |
| `postPlanner`   | `Plan`                                                  | The plan before it reaches the Executor — add, remove, or modify steps      |
| `preExecutor`   | `{ plan, prompt, cycle, scratchpad, previousResults? }` | The plan, prompt, and context before execution                              |
| `postExecutor`  | `{ results, logs, tokensUsed }`                         | Execution results before they reach the Evaluator                           |
| `preEvaluator`  | `{ prompt, results, scratchpad }`                       | The data the Evaluator will assess                                          |
| `postEvaluator` | `EvaluationResult`                                      | The verdict — can override pass/fail, adjust confidence, or modify feedback |
| `preStep`       | `{ step, cycle }`                                       | The step definition before it executes                                      |
| `postStep`      | `{ step, result, cycle }`                               | The step's result after execution                                           |

Every callback also receives a `CycleMetadata` object as its second argument:

```typescript
interface CycleMetadata {
  cycleNumber: number;
  totalCyclesUsed: number;
  tokensUsed: number;
}
```

### How Callbacks Work

Callbacks run in registration order. If a callback returns a value, that value **replaces** the data for the next callback in the chain — meaning callbacks can transform pipeline data in-flight. If a callback returns `void` (or `undefined`), the data passes through unchanged.

Callbacks can return Promises, which the framework awaits. This enables patterns like human-in-the-loop approval — pause execution, present data to a user, and resume only after approval.

By default, an error in a callback stops the pipeline. To make a callback fault-tolerant, register it as an `EventRegistration` with `continueOnError: true`:

```typescript
events: {
  postStep: [
    {
      handler: (data) => externalLogger.log(data),
      continueOnError: true,
    }
  ],
}
```

When `continueOnError` is `true` and the handler throws, the data reverts to its state before that callback ran, and execution continues with the next callback in the chain.

A deeper look at event patterns — including human-in-the-loop workflows, plan safety filters, and custom termination logic — is covered in [Event System Patterns](./07-event-system-patterns.md).

## Cycles and Termination

### Cycle Flow

Each call to `tepa.run()` follows this sequence:

1. **Validate.** The prompt is validated against the `TepaPrompt` schema using Zod. Invalid prompts throw a `TepaPromptError`.
2. **Initialize.** A fresh `Scratchpad`, `TokenTracker`, `Logger`, and `EventBus` are created. The Planner, Executor, and Evaluator are instantiated with their configured models.
3. **Register tools.** All tool definitions are registered in an inline `ToolRegistry`.
4. **Loop.** For each cycle (1 to `maxCycles`):
   - Run the **Planner** (with `prePlanner`/`postPlanner` events).
   - Run the **Executor** (with `preExecutor`/`postExecutor` and `preStep`/`postStep` events).
   - Write `_execution_summary` to the scratchpad.
   - Run the **Evaluator** (with `preEvaluator`/`postEvaluator` events).
   - If the verdict is `pass`, return immediately with status `"pass"`.
   - If the verdict is `fail`, carry the evaluator's feedback into the next cycle.

### Termination Conditions

| Condition                | Result Status  | What Happens                                                                                                                                                                                                  |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluator returns `pass` | `"pass"`       | Pipeline returns immediately with the evaluator's summary.                                                                                                                                                    |
| Max cycles exhausted     | `"fail"`       | The loop ends. The last evaluator feedback is returned.                                                                                                                                                       |
| Token budget exceeded    | `"terminated"` | The `TokenTracker` throws a `TepaTokenBudgetExceeded` error mid-cycle. The pipeline catches it and returns with the tokens used.                                                                              |
| Unrecoverable error      | `"fail"`       | Pipeline component errors (planner parse failures after retry, cycle errors) are caught and returned as structured failures rather than crashing. Non-Tepa errors are wrapped in a `TepaError` and re-thrown. |

The `TokenTracker` checks the budget after every LLM call (planner, each executor step, evaluator). If the cumulative token count exceeds the budget at any point, the current cycle is interrupted immediately.

### `TepaResult` Structure

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

| Field        | Description                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `"pass"` — goal achieved. `"fail"` — max cycles or unrecoverable error. `"terminated"` — token budget exhausted.                      |
| `cycles`     | Number of Plan-Execute-Evaluate cycles that ran.                                                                                      |
| `tokensUsed` | Total tokens consumed across all LLM calls in all cycles.                                                                             |
| `outputs`    | Artifacts produced by the pipeline (file paths, descriptions, types).                                                                 |
| `logs`       | Structured log entries with timestamps, cycle numbers, step IDs, tool names, durations, and token counts.                             |
| `feedback`   | On pass: the evaluator's summary. On fail: the evaluator's feedback or an error message. On termination: the budget-exceeded message. |

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

## Tools in the Pipeline Context

### How the Executor Resolves Tools

When the `Tepa` constructor receives a `tools` array, it registers each `ToolDefinition` in an inline `ToolRegistry` at the start of `run()`. During execution, the Executor looks up each tool name from the plan step against this registry. If a tool isn't found, the step fails with an error message listing the unknown tool name.

The same registry is used during plan validation — the Planner checks every tool reference in the generated plan against the registry before execution begins. This catches hallucinated tool names early, before any step runs.

### How Tool Schemas Are Passed to the LLM

Tool schemas flow through the pipeline at two points:

1. **Planning.** The Planner's system prompt includes the full tool list with parameter definitions — names, types, descriptions, and required flags. This gives the LLM enough information to assign the right tools to each step.

2. **Execution.** For each tool step, the Executor extracts a `ToolSchema` from the registry and passes it to the LLM via the provider's native tool-use API:

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

The provider translates this schema into the LLM's native format (e.g., Anthropic's `tools` parameter, OpenAI's `tools` with function calling). The LLM returns a structured `tool_use` block with typed parameters — no text parsing required.

For a complete guide to defining, registering, and building tools, see [Tool System](./06-tool-system.md).

## What's Next

- [**Configuration**](./05-configuration.md) — Customize cycle limits, token budgets, per-stage models, and logging levels.
- [**Tool System**](./06-tool-system.md) — Explore built-in tools and create your own.
- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and more.
- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, logging, and custom provider implementation.
