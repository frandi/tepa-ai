# How Tepa Works

This section walks through the mechanics of a Tepa pipeline — how the three core components (Planner, Executor, Evaluator) interact in a loop, how state flows between them, how the event system lets you observe and control the process, and how the packages fit together.

## The Plan-Execute-Evaluate Cycle

Every call to `tepa.run()` triggers a loop that repeats until the goal is met or a limit is reached:

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌───────────┐   │
  │  Prompt   │──▶│ Planner  │──▶│ Executor  │──▶│ Evaluator │   │
  └──────────┘   └──────────┘   └───────────┘   └───────────┘   │
                    ▲                                │            │
                    │                                ▼            │
                    │                          ┌───────────┐      │
                    │                          │  Verdict?  │     │
                    │                          └───────────┘      │
                    │                           │         │       │
                    │                         pass       fail     │
                    │                           │         │       │
                    │                           ▼         │       │
                    │                        [Done]       │       │
                    │                                     │       │
                    └─────────── feedback ─────────────────┘       │
                                + scratchpad                      │
                    ┌─────────────────────────────────────────────┘
                    │  (repeat until pass, max cycles, or token budget)
```

Here's what happens inside each cycle:

1. **Planner** receives the goal, context, expected output, and the list of available tools. It produces a structured plan — ordered steps with dependencies, tool assignments, and expected outcomes.
2. **Executor** sorts the steps by their dependencies and runs them in order. For each step, it calls the LLM with the relevant tool schemas. The LLM returns structured tool invocations, and the framework executes the tools and captures their results.
3. **Evaluator** reviews the execution results against the expected output. It checks both structure (do the required artifacts exist?) and quality (does the content actually address the goal?). It returns a verdict — `pass` or `fail` — with a confidence score and feedback.

If the verdict is `pass`, the pipeline returns. If `fail`, the evaluator's feedback and the current scratchpad state feed back into the Planner for a revised plan, and the next cycle begins.

The loop terminates when any of these conditions is met:

| Condition                               | Result status  |
| --------------------------------------- | -------------- |
| Evaluator returns `pass`                | `"pass"`       |
| Max cycles exhausted (default: 5)       | `"fail"`       |
| Token budget exceeded (default: 64,000) | `"terminated"` |

## Planner

The Planner's job is to break a goal into a dependency-ordered sequence of steps that the Executor can carry out.

### What It Receives

On the first cycle, the Planner receives:

- The prompt (goal, context, expected output)
- The full list of available tools with their parameter definitions

On subsequent cycles (re-planning after failure), it also receives:

- The evaluator's feedback explaining what went wrong
- The current scratchpad state, including the `_execution_summary` from the previous cycle

### What It Produces

The Planner calls the LLM and parses the response into a `Plan`:

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

Each step declares which tools it needs and which prior steps it depends on. Dependencies must reference step IDs within the same plan — no forward references, no circular chains.

A step with an empty `tools` array is a **reasoning step**: the LLM produces a text response without calling any tools. This is useful for analysis, synthesis, or decision-making steps that feed into downstream tool-calling steps.

### Re-Planning on Failure

When the evaluator returns `fail`, the Planner switches to a revised-plan prompt. Instead of planning from scratch, it's instructed to produce a **minimal revision** — only fixing what failed, while building on what already succeeded. The scratchpad gives it full visibility into prior execution results, so it can avoid repeating work.

### Parse Failure Retry

If the LLM's response can't be parsed as valid JSON, the Planner retries once with a simplified prompt. If parsing fails again, the cycle throws an error.

## Executor

The Executor takes a plan and runs each step, calling tools through the LLM's native tool-use capability.

### Topological Sorting

Before executing anything, the Executor sorts the plan steps using Kahn's algorithm (a standard BFS-based topological sort). This produces an execution order that respects all declared dependencies. If a circular dependency is detected, the executor throws an error immediately.

Where multiple steps have no dependency relationship, the original plan order is preserved — giving the Planner some control over execution sequence even among independent steps.

### Step Execution Flow

For each step in the sorted order:

1. **Dependency check.** If any step this one depends on has failed, it's immediately marked as failed with a skip message. Failures cascade — a downstream step won't run if its upstream dependency didn't succeed.
2. **Scoped inputs.** The step only receives the outputs of its declared dependencies, not the full output map. This is enforced by the framework — a step can't accidentally read data from a step it didn't declare a dependency on.
3. **Execution.** The step runs as either a tool step or a reasoning step (see below).
4. **Result capture.** The output is stored in the step outputs map and made available to downstream steps that declare this step as a dependency.

### Tool Steps

For steps with tools assigned, the Executor:

1. Looks up each tool in the registry to get its schema.
2. Builds a message with the step description, goal context, scratchpad state, and the outputs of dependency steps.
3. Calls the LLM with the tool schema attached. The LLM returns a structured `tool_use` block with pre-parsed parameters — no regex extraction, no JSON parsing from free-form text.
4. Invokes the tool with those parameters and captures the result.

If the LLM doesn't return a `tool_use` block (i.e., it responds with text instead of a tool call), the step is marked as failed.

### Reasoning Steps

Steps with an empty `tools` array are reasoning steps. The Executor sends the step description, expected outcome, goal context, scratchpad, and dependency outputs to the LLM, and captures the text response as the step's output. No tools are invoked.

Reasoning steps are useful for intermediate analysis — for example, reviewing data from a previous step and deciding what to do next, or synthesizing information before a downstream tool-calling step.

### Execution Result

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

## Evaluator

After all steps complete, the Evaluator judges whether the execution results meet the goal.

### What It Checks

The Evaluator instructs the LLM to assess two dimensions:

- **Structural checks.** Were expected outputs produced? Do files exist in the right format? Are all required artifacts present?
- **Qualitative checks.** Is the content meaningful and correct? Are outputs specific and relevant? Does the result actually address the goal?

The evaluation message includes the goal, expected output, a summary of every step's result (status, output, errors), and the current scratchpad state.

### Evaluation Result

```typescript
interface EvaluationResult {
  verdict: "pass" | "fail";
  confidence: number; // 0.0 – 1.0
  feedback?: string; // required on fail — actionable explanation
  summary?: string; // optional on pass — brief description of success
  tokensUsed: number;
}
```

On `fail`, the `feedback` field contains an actionable description of what fell short. This feedback is exactly what the Planner receives on the next cycle to guide its revised plan.

### Self-Correction

The self-correction loop is the core of Tepa's reliability. Here's how state flows from a failed evaluation back to a successful re-plan:

1. The Evaluator returns `verdict: "fail"` with feedback: _"The summary file was created but doesn't describe the src/utils directory."_
2. The orchestrator writes `_execution_summary` to the scratchpad (containing all step outputs and statuses from this cycle).
3. On the next cycle, the Planner receives both the evaluator's feedback and the scratchpad.
4. The Planner sees that most steps succeeded and the file was written — it only needs to re-read the missed directory and update the file. It produces a minimal revised plan.
5. The Executor runs the revised plan, and the Evaluator re-evaluates.

This loop continues until the goal is met, the cycle limit is reached, or the token budget is exhausted.

### Parse Failure Handling

Like the Planner, the Evaluator retries once if the LLM response can't be parsed. If both attempts fail, it returns a synthetic `fail` result with `confidence: 0` and the raw response as feedback — ensuring the pipeline can still self-correct on the next cycle rather than crashing.

## Scratchpad

The Scratchpad is an in-memory key-value store that persists across all steps and cycles within a single `run()` call.

```typescript
class Scratchpad {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  has(key: string): boolean;
  entries(): Record<string, unknown>;
  clear(): void;
}
```

### How State Flows

A single Scratchpad instance is created at the start of `run()` and shared across the entire pipeline:

- **Within a cycle:** Every step can read and write to the scratchpad via the `scratchpad` tool. The Executor includes the current scratchpad contents in each step's context, so downstream steps can see what upstream steps wrote.
- **Across cycles:** The scratchpad is never cleared between cycles. After each Executor run, the orchestrator writes `_execution_summary` — a simplified array of all step results (step ID, status, output, and error if any). On the next cycle, the Planner sees this summary and can build on what already succeeded.

This persistence is what enables efficient self-correction. The revised Planner doesn't start from a blank slate — it knows exactly what was accomplished, what failed, and what the evaluator found lacking.

### Scratchpad Visibility

The scratchpad contents are visible to all three components:

- **Planner** (on re-plan cycles) — sees the full scratchpad including `_execution_summary`
- **Executor** — each step sees the current scratchpad state in its context
- **Evaluator** — sees the scratchpad when judging execution results

## Event System

Eight lifecycle hooks let you observe, transform, or control the pipeline at every stage — without modifying the core.

### The 8 Events

| Event           | Fires                       | Receives                                |
| --------------- | --------------------------- | --------------------------------------- |
| `prePlanner`    | Before the Planner runs     | Prompt + feedback (if re-planning)      |
| `postPlanner`   | After the Plan is generated | The `Plan`                              |
| `preExecutor`   | Before the Executor runs    | Plan + prompt + cycle info + scratchpad |
| `postExecutor`  | After execution completes   | Execution results + logs + token count  |
| `preEvaluator`  | Before the Evaluator runs   | Prompt + results + scratchpad           |
| `postEvaluator` | After evaluation completes  | `EvaluationResult`                      |
| `preStep`       | Before each individual step | Step definition + cycle number          |
| `postStep`      | After each individual step  | Step definition + result + cycle number |

Every callback also receives a `CycleMetadata` object as its second argument:

```typescript
interface CycleMetadata {
  cycleNumber: number;
  totalCyclesUsed: number;
  tokensUsed: number;
}
```

### How It Works

Events are registered via the `events` option in the `Tepa` constructor:

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  events: {
    postPlanner: [
      (plan, cycle) => {
        console.log(`Cycle ${cycle.cycleNumber}: Plan has ${plan.steps.length} steps`);
      }
    ],
    postStep: [
      (data, cycle) => {
        console.log(`Step ${data.step.id}: ${data.result.status}`);
      }
    ],
  },
});
```

Callbacks run in registration order. If a callback returns a value, that value replaces the data for the next callback in the chain — this means callbacks can **transform** pipeline data in-flight (for example, modifying a plan before execution). If a callback returns `void`, the data passes through unchanged.

Callbacks can return Promises, which the framework awaits. This enables patterns like human-in-the-loop approval gates — pause execution, present the plan to a user, and resume only after approval.

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

A deeper look at event patterns — including human-in-the-loop workflows, plan safety filters, and custom termination logic — is covered in [Event System Patterns](./07-event-system-patterns.md).

## Package Architecture

Tepa is organized as a monorepo with focused packages:

```
@tepa/core                Main pipeline: Tepa class, Planner, Executor,
                          Evaluator, Scratchpad, EventBus, config, utilities

@tepa/types               Shared TypeScript type definitions (no runtime code)

@tepa/tools               Built-in tool implementations: file system, shell,
                          HTTP, data parsing, web search, scratchpad, logging

@tepa/provider-core       Abstract BaseLLMProvider with retry logic,
                          exponential backoff, rate limit handling, file logging

@tepa/provider-anthropic  Anthropic Claude provider
@tepa/provider-openai     OpenAI provider
@tepa/provider-gemini     Google Gemini provider
```

### How They Fit Together

```
  Your Code
     │
     ▼
 ┌──────────┐     ┌──────────────┐     ┌──────────────────┐
 │ @tepa/   │────▶│ @tepa/       │────▶│ @tepa/           │
 │ core     │     │ provider-*   │     │ provider-core    │
 └──────────┘     └──────────────┘     └──────────────────┘
     │                                          │
     │            ┌──────────────┐              │
     ├───────────▶│ @tepa/tools  │              │
     │            └──────────────┘              │
     │                   │                      │
     ▼                   ▼                      ▼
 ┌─────────────────────────────────────────────────────┐
 │                    @tepa/types                       │
 └─────────────────────────────────────────────────────┘
```

- **`@tepa/core`** is the orchestrator. It depends on `@tepa/types` for shared interfaces but has no dependency on specific providers or tools. You pass providers and tools in at construction time.
- **`@tepa/provider-*`** packages each implement the `LLMProvider` interface from `@tepa/types`, extending `BaseLLMProvider` from `@tepa/provider-core` for retry logic and logging.
- **`@tepa/tools`** exports ready-made `ToolDefinition` objects. Each tool is self-contained — you pick the ones you need and pass them to the `Tepa` constructor.
- **`@tepa/types`** is the shared contract. It contains only TypeScript types — no runtime code. Every other package depends on it.

This separation means you can swap providers, add or remove tools, and extend the pipeline through events — all without touching the core.

## What's Next

- [**The Pipeline in Detail**](./04-pipeline-in-detail.md) — Deep dive into prompt structure, plan validation, topological sorting, tool resolution, cycle termination, and every configuration option.
- [**Configuration**](./05-configuration.md) — Customize cycle limits, token budgets, per-stage models, and logging levels.
- [**Tool System**](./06-tool-system.md) — Explore built-in tools and create your own.
- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and more.
