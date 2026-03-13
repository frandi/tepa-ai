# Event System Patterns

Tepa's event system lets you observe, transform, and control the pipeline at eight lifecycle points. You can log progress, enrich inputs, filter plans, pause for human approval, or override verdicts — all without modifying pipeline internals. This section covers the callback contract, execution semantics, and practical patterns.

## Event Registration

Events are registered at initialization through the `events` option in the `Tepa` constructor:

```typescript
import { Tepa } from "@tepa/core";
import type { Plan, EvaluationResult, PostStepPayload } from "@tepa/types";

const tepa = new Tepa({
  provider: myProvider,
  tools: [
    /* ... */
  ],
  events: {
    postPlanner: [
      (data, cycle) => {
        const plan = data as Plan;
        console.log(`Cycle ${cycle.cycleNumber}: plan has ${plan.steps.length} steps`);
      },
    ],
    postStep: [
      (data) => {
        const { step, result } = data as PostStepPayload;
        console.log(`${step.id}: ${result.status}`);
      },
    ],
  },
});
```

Each key in the `events` object is an `EventName`, and the value is an array of callbacks or registration objects. Internally, Tepa creates an `EventBus` from this map when `run()` is called. The EventBus executes callbacks at the corresponding pipeline stage.

### `EventMap`

```typescript
type EventMap = {
  [K in EventName]?: Array<EventCallback | EventRegistration>;
};
```

Each entry can be a bare callback function or an `EventRegistration` object (which adds error handling options — covered below).

## Callback Contract

Every event callback follows the same signature:

```typescript
type EventCallback<TData = unknown> = (
  data: TData,
  cycle: CycleMetadata,
) => TData | void | Promise<TData | void>;
```

### Parameters

| Parameter | Type            | Description                                                          |
| --------- | --------------- | -------------------------------------------------------------------- |
| `data`    | `TData`         | The payload for this event — varies by event point (see table below) |
| `cycle`   | `CycleMetadata` | Metadata about the current pipeline cycle                            |

### `CycleMetadata`

```typescript
interface CycleMetadata {
  cycleNumber: number; // Current cycle (1-based)
  totalCyclesUsed: number; // Cycles completed before this one
  tokensUsed: number; // Total tokens consumed so far
}
```

### Return Semantics

What your callback returns determines what happens next:

| Return value                                | Effect                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `void` / `undefined`                        | Data passes through unchanged to the next callback (or back to the pipeline)        |
| A value (or `Promise` resolving to a value) | Replaces the data — the next callback (or the pipeline) receives the returned value |

This means callbacks can be **observers** (return nothing, just read) or **transformers** (return modified data).

### Promise Support

Callbacks can be synchronous or async. If a callback returns a `Promise`, the EventBus `await`s it before calling the next callback. This is what makes human-in-the-loop patterns possible — a callback can pause the pipeline by awaiting user input.

```typescript
postPlanner: [
  async (data, cycle) => {
    const plan = data as Plan;
    // Pipeline pauses here until the user responds
    const answer = await askUser("Approve this plan? (yes/no)");
    if (answer === "no") {
      // Could modify and return a different plan
    }
  },
],
```

## Execution Order

When multiple callbacks are registered for the same event, they execute sequentially in registration order. Each callback receives the output of the previous one — middleware-style chaining:

```
callback1(data) → result1
callback2(result1) → result2
callback3(result2) → result3  ← returned to pipeline
```

If a callback returns `void`, the previous data passes through unchanged:

```
callback1(data) → modifiedData
callback2(modifiedData) → void        (pass-through)
callback3(modifiedData) → finalData   ← returned to pipeline
```

The final value after all callbacks is what the pipeline uses. There is no parallel execution — callbacks are strictly sequential.

## Error Handling in Callbacks

By default, if a callback throws an error, the error propagates and aborts the pipeline. For non-critical callbacks (like logging or monitoring), you can use the `EventRegistration` form with `continueOnError`:

```typescript
interface EventRegistration<TData = unknown> {
  handler: EventCallback<TData>;
  continueOnError?: boolean; // defaults to false
}
```

### Default behavior (`continueOnError: false`)

The error propagates. The pipeline aborts with the thrown error.

### With `continueOnError: true`

The error is caught, the data reverts to its state before that callback ran, and execution continues with the next callback. The error is silently swallowed.

```typescript
events: {
  postEvaluator: [
    // Critical: modifies verdict for human-in-the-loop
    async (data) => { /* ... */ },

    // Non-critical: send metrics to monitoring
    {
      handler: (data) => {
        const result = data as EvaluationResult;
        metrics.record("evaluation", result.verdict);
        // If this throws, the pipeline continues
      },
      continueOnError: true,
    },
  ],
}
```

You can mix bare callbacks and `EventRegistration` objects in the same array. Bare callbacks default to `continueOnError: false`.

## Event Data Types

Each event point receives a specific payload. The pipeline uses the (potentially modified) return value.

| Event           | Payload Type       | Key Fields                                                                    |
| --------------- | ------------------ | ----------------------------------------------------------------------------- |
| `prePlanner`    | `PlannerInput`     | `prompt: TepaPrompt`, `feedback?: string`                                     |
| `postPlanner`   | `Plan`             | `steps: PlanStep[]`, `estimatedTokens`, `reasoning`                           |
| `preExecutor`   | `ExecutorInput`    | `plan: Plan`, `prompt: TepaPrompt`, `cycle`, `scratchpad`, `previousResults?` |
| `postExecutor`  | `ExecutorOutput`   | `results: ExecutionResult[]`, `logs: LogEntry[]`, `tokensUsed`                |
| `preEvaluator`  | `EvaluatorInput`   | `prompt: TepaPrompt`, `results: ExecutionResult[]`, `scratchpad`              |
| `postEvaluator` | `EvaluationResult` | `verdict: "pass" \| "fail"`, `confidence`, `feedback?`, `summary?`            |
| `preStep`       | `PreStepPayload`   | `step: PlanStep`, `cycle: number`                                             |
| `postStep`      | `PostStepPayload`  | `step: PlanStep`, `result: ExecutionResult`, `cycle: number`                  |

## Patterns

### Human-in-the-Loop Approval

Use `postPlanner` to pause the pipeline and present the generated plan for human review before execution begins. The callback can await interactive input — the pipeline won't proceed until the Promise resolves.

```typescript
import * as readline from "node:readline/promises";
import type { Plan } from "@tepa/types";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

events: {
  postPlanner: [
    async (data) => {
      const plan = data as Plan;

      console.log(`\nPlan: ${plan.steps.length} steps`);
      for (const step of plan.steps) {
        const tools = step.tools.length > 0 ? step.tools.join(", ") : "reasoning";
        console.log(`  ${step.id}: ${step.description} (${tools})`);
      }

      const answer = await rl.question("\nApprove this plan? (yes/no): ");
      if (answer.trim().toLowerCase() !== "yes") {
        // Option A: reject by throwing
        throw new Error("Plan rejected by user");

        // Option B: modify the plan (e.g., remove steps)
        // return { ...plan, steps: plan.steps.filter(s => !s.tools.includes("shell_execute")) };
      }
    },
  ],
}
```

### Human Override on Failure

Use `postEvaluator` to let a user accept results that the Evaluator marked as failed. Returning a modified `EvaluationResult` with `verdict: "pass"` stops the re-planning loop.

```typescript
import type { EvaluationResult } from "@tepa/types";

events: {
  postEvaluator: [
    async (data) => {
      const result = data as EvaluationResult;

      if (result.verdict === "fail") {
        console.log(`Evaluation failed (confidence: ${result.confidence})`);
        if (result.feedback) console.log(`Feedback: ${result.feedback}`);

        const answer = await rl.question("Accept results anyway? (yes/no): ");
        if (answer.trim().toLowerCase() === "yes") {
          return { ...result, verdict: "pass" as const };
        }
        // Otherwise, pipeline continues to the next cycle
      }
    },
  ],
}
```

This is the critical human-in-the-loop pattern: the pipeline checks `lastEvaluation.verdict` after the `postEvaluator` callbacks run. If a callback flips the verdict to `"pass"`, the pipeline terminates successfully.

### Plan Safety Filter

Use `postPlanner` to inspect or modify the plan before execution. This lets you enforce constraints that the LLM might not respect — such as banning certain tools or limiting step count.

```typescript
import type { Plan } from "@tepa/types";

events: {
  postPlanner: [
    (data) => {
      const plan = data as Plan;
      const restricted = ["shell_execute"];

      const filtered = plan.steps.map((step) => ({
        ...step,
        tools: step.tools.filter((t) => !restricted.includes(t)),
      }));

      return { ...plan, steps: filtered };
    },
  ],
}
```

Since the returned value replaces the original plan, the Executor never sees the restricted tools.

### Input Enrichment

Use `prePlanner` to fetch external context — from a database, API, or file system — and inject it into the prompt before planning begins.

```typescript
import type { PlannerInput } from "@tepa/types";

events: {
  prePlanner: [
    async (data) => {
      const input = data as PlannerInput;

      // Fetch latest context from an external source
      const projectStatus = await fetchProjectStatus(input.prompt.context.projectId);

      return {
        ...input,
        prompt: {
          ...input.prompt,
          context: {
            ...input.prompt.context,
            projectStatus,
            enrichedAt: new Date().toISOString(),
          },
        },
      };
    },
  ],
}
```

### Step-Level Progress Tracking

Use `preStep` and `postStep` to emit real-time updates as each step begins and completes. This is the most granular level of pipeline observability.

```typescript
import type { PreStepPayload, PostStepPayload } from "@tepa/types";

events: {
  preStep: [
    (data) => {
      const { step, cycle } = data as PreStepPayload;
      console.log(`[cycle ${cycle}] Starting: ${step.id} — ${step.description}`);
    },
  ],
  postStep: [
    (data) => {
      const { step, result } = data as PostStepPayload;
      const icon = result.status === "success" ? "OK" : "FAIL";
      console.log(`  ${step.id}: ${icon} (${result.tokensUsed} tokens, ${result.durationMs}ms)`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    },
  ],
}
```

### Custom Termination Logic

Use `postEvaluator` to abort the pipeline based on business rules, regardless of the Evaluator's verdict. For example, stop early if confidence is too low to justify another cycle.

```typescript
import type { EvaluationResult } from "@tepa/types";

events: {
  postEvaluator: [
    (data, cycle) => {
      const result = data as EvaluationResult;

      // Give up if confidence is critically low after multiple cycles
      if (result.verdict === "fail" && result.confidence < 0.2 && cycle.cycleNumber >= 2) {
        console.log("Confidence too low to justify another cycle. Accepting as-is.");
        return { ...result, verdict: "pass" as const };
      }

      // Or abort entirely based on token budget
      if (cycle.tokensUsed > 100_000 && result.verdict === "fail") {
        throw new Error("Token budget exhausted with no passing result");
      }
    },
  ],
}
```

### External Logging and Monitoring

Use `postEvaluator` to send pipeline verdicts to external monitoring systems. Mark the callback with `continueOnError` so a monitoring failure doesn't crash the pipeline.

```typescript
import type { EvaluationResult } from "@tepa/types";

events: {
  postEvaluator: [
    {
      handler: (data, cycle) => {
        const result = data as EvaluationResult;
        // Send to your monitoring service
        fetch("https://metrics.example.com/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "tepa.evaluation",
            verdict: result.verdict,
            confidence: result.confidence,
            cycle: cycle.cycleNumber,
            tokensUsed: cycle.tokensUsed,
            timestamp: new Date().toISOString(),
          }),
        });
      },
      continueOnError: true,
    },
  ],
}
```

### Data Cleanup

Use `postExecutor` to sanitize execution results before they reach the Evaluator. This is useful for stripping sensitive data, normalizing outputs, or filtering noise from step results.

```typescript
import type { ExecutorOutput } from "@tepa/types";

events: {
  postExecutor: [
    (data) => {
      const output = data as ExecutorOutput;

      const sanitized = output.results.map((r) => ({
        ...r,
        output: typeof r.output === "string"
          ? r.output.replace(/api_key=\w+/g, "api_key=***")
          : r.output,
      }));

      return { ...output, results: sanitized };
    },
  ],
}
```

## What's Next

- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, custom provider implementation, and the provider logging system.
- [**Examples and Demos**](./09-examples-and-demos.md) — See the event system in action in the study-plan demo (human-in-the-loop) and other examples.
