# Event System Patterns

Tepa's event system lets you observe, transform, and control the pipeline at eight lifecycle points — without modifying pipeline internals. This section covers the practical patterns: how to use events to build human-in-the-loop workflows, enforce safety constraints, track progress, integrate external systems, and apply custom termination logic.

If you're looking for the complete callback contract — event data types, `CycleMetadata`, execution order, and `continueOnError` — that's in [Pipeline in Detail — Pipeline Lifecycle Events](./04-pipeline-in-detail.md#pipeline-lifecycle-events). The conceptual overview of what events are and what callbacks can do is in [How Tepa Works — The Event System](./03-how-tepa-works.md#the-event-system).

---

## Quick Reference

Events are registered in the `Tepa` constructor:

```typescript
const tepa = new Tepa({
  provider: myProvider,
  tools: [...],
  events: {
    postPlanner: [(plan, cycle) => { /* ... */ }],
    postStep: [(data, cycle) => { /* ... */ }],
  },
});
```

| Event           | Fires                    | Primary Use                                        |
| --------------- | ------------------------ | -------------------------------------------------- |
| `prePlanner`    | Before planning          | Enrich prompt context, inject external data        |
| `postPlanner`   | After plan is generated  | Review, modify, or approve the plan                |
| `preExecutor`   | Before execution starts  | Modify plan or context before any step runs        |
| `postExecutor`  | After all steps complete | Sanitize results before evaluation                 |
| `preEvaluator`  | Before evaluation        | Modify what the Evaluator sees                     |
| `postEvaluator` | After evaluation         | Override verdict, send metrics, custom termination |
| `preStep`       | Before each step         | Per-step logging, pre-execution checks             |
| `postStep`      | After each step          | Per-step progress tracking, result inspection      |

**Three things a callback can do:**

- **Observe** — return nothing; data passes through unchanged
- **Transform** — return a modified value; it replaces the data for all subsequent callbacks
- **Pause** — return a Promise; the framework awaits it before continuing

For non-critical callbacks (monitoring, logging), use `continueOnError: true` so a callback failure doesn't abort the pipeline:

```typescript
events: {
  postEvaluator: [
    {
      handler: (data) => metrics.record(data),
      continueOnError: true,
    },
  ],
}
```

---

## Patterns

### Human-in-the-Loop Plan Approval

Pause the pipeline after planning and present the generated plan to a user before any execution begins. The callback awaits user input — the pipeline won't proceed until the Promise resolves.

```typescript
import * as readline from "node:readline/promises";
import type { Plan } from "@tepa/types";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const tepa = new Tepa({
  provider,
  tools,
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
          throw new Error("Plan rejected by user");
        }
        // Returning nothing (void) lets the original plan pass through unchanged
      },
    ],
  },
});
```

Throwing rejects the plan and aborts the pipeline. To modify the plan instead of rejecting it — for example, stripping dangerous steps before approval — return a new plan object:

```typescript
const answer = await rl.question("Approve, or type 'safe' to remove shell steps: ");
if (answer.trim() === "safe") {
  return {
    ...plan,
    steps: plan.steps.filter((s) => !s.tools.includes("shell_execute")),
  };
}
```

---

### Human Override on Evaluation Failure

Let a user accept results the Evaluator marked as failed. Returning a modified `EvaluationResult` with `verdict: "pass"` stops the re-planning loop and returns immediately with success.

```typescript
import type { EvaluationResult } from "@tepa/types";

events: {
  postEvaluator: [
    async (data) => {
      const result = data as EvaluationResult;

      if (result.verdict === "fail") {
        console.log(`\nEvaluation failed (confidence: ${result.confidence.toFixed(2)})`);
        if (result.feedback) console.log(`Feedback: ${result.feedback}`);

        const answer = await rl.question("Accept results anyway? (yes/no): ");
        if (answer.trim().toLowerCase() === "yes") {
          return { ...result, verdict: "pass" as const };
        }
      }
      // Returning nothing lets the original verdict pass through — pipeline continues
    },
  ],
}
```

The pipeline checks the verdict after all `postEvaluator` callbacks complete. Flipping it to `"pass"` here is treated identically to a genuine evaluator pass — the pipeline returns with `status: "pass"`.

---

### Plan Safety Filter

Inspect or rewrite the plan before execution to enforce constraints the LLM might not respect — such as banning specific tools, capping step count, or requiring certain steps to appear.

```typescript
import type { Plan } from "@tepa/types";

events: {
  postPlanner: [
    (data) => {
      const plan = data as Plan;
      const restricted = ["shell_execute", "http_request"];

      const hasForbiddenTools = plan.steps.some(
        s => s.tools.some(t => restricted.includes(t))
      );

      if (hasForbiddenTools) {
        // Option A: strip the restricted tools from steps
        return {
          ...plan,
          steps: plan.steps.map(s => ({
            ...s,
            tools: s.tools.filter(t => !restricted.includes(t)),
          })),
        };

        // Option B: reject the plan entirely
        // throw new Error(`Plan uses restricted tools: ${restricted.join(", ")}`);
      }
    },
  ],
}
```

Since the returned value replaces the original plan, the Executor never sees the restricted tools. This pattern is particularly useful in multi-tenant environments or when running Tepa pipelines against untrusted goals.

---

### Input Enrichment

Use `prePlanner` to fetch external context — from a database, API, or file system — and inject it into the prompt before planning begins. This keeps your application logic out of the goal string and makes the Planner's context richer.

```typescript
import type { PlannerInput } from "@tepa/types";

events: {
  prePlanner: [
    async (data) => {
      const input = data as PlannerInput;

      const projectStatus = await fetchProjectStatus(
        input.prompt.context.projectId as string
      );
      const teamContext = await fetchTeamContext(
        input.prompt.context.teamId as string
      );

      return {
        ...input,
        prompt: {
          ...input.prompt,
          context: {
            ...input.prompt.context,
            projectStatus,
            teamContext,
            enrichedAt: new Date().toISOString(),
          },
        },
      };
    },
  ],
}
```

This pattern is composable — register multiple `prePlanner` callbacks and each one enriches the context further, with each receiving the output of the previous.

---

### Step-Level Progress Tracking

Use `preStep` and `postStep` for real-time per-step visibility. This is the most granular level of pipeline observability — useful for UIs, progress bars, or detailed audit logs.

```typescript
import type { PreStepPayload, PostStepPayload } from "@tepa/types";

events: {
  preStep: [
    (data) => {
      const { step, cycle } = data as PreStepPayload;
      process.stdout.write(
        `[cycle ${cycle}] ${step.id}: ${step.description}... `
      );
    },
  ],
  postStep: [
    (data) => {
      const { step, result } = data as PostStepPayload;
      const status = result.status === "success" ? "✓" : "✗";
      console.log(
        `${status} (${result.durationMs}ms, ${result.tokensUsed} tokens)`
      );
      if (result.error) {
        console.log(`  → ${result.error}`);
      }
    },
  ],
}
```

Output during a run:

```
[cycle 1] step_1: List files in ./src... ✓ (245ms, 1200 tokens)
[cycle 1] step_2: Analyze project structure... ✓ (1830ms, 3400 tokens)
[cycle 1] step_3: Write summary to ./summary.md... ✓ (520ms, 2100 tokens)
```

---

### External Logging and Monitoring

Use `postEvaluator` to send pipeline verdicts to external monitoring systems. Mark the callback as `continueOnError` so a monitoring failure never aborts the pipeline.

```typescript
import type { EvaluationResult } from "@tepa/types";

events: {
  postEvaluator: [
    {
      handler: (data, cycle) => {
        const result = data as EvaluationResult;

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

For provider-level metrics — token usage per LLM call, retry counts, latency per request — use the provider's `onLog()` callback system instead. See [LLM Providers — Provider Logging System](./08-llm-providers.md#provider-logging-system).

---

### Custom Termination Logic

Use `postEvaluator` to apply business rules that override the default cycle behaviour — stopping early when confidence is too low, or aborting when cost thresholds are breached.

```typescript
import type { EvaluationResult } from "@tepa/types";

events: {
  postEvaluator: [
    (data, cycle) => {
      const result = data as EvaluationResult;

      // Stop cycling if confidence is critically low — more cycles won't help
      if (
        result.verdict === "fail" &&
        result.confidence < 0.2 &&
        cycle.cycleNumber >= 2
      ) {
        console.warn(
          `Confidence too low (${result.confidence}) after ${cycle.cycleNumber} cycles. Stopping.`
        );
        // Returning pass terminates the pipeline gracefully
        return { ...result, verdict: "pass" as const };
      }

      // Hard abort if token cost is too high without a result
      if (cycle.tokensUsed > 150_000 && result.verdict === "fail") {
        throw new Error(
          `Token budget threshold reached (${cycle.tokensUsed} tokens) without passing.`
        );
      }
    },
  ],
}
```

Note the two termination strategies: returning a modified `verdict: "pass"` terminates the pipeline _gracefully_ with `status: "pass"`. Throwing terminates it _abruptly_ with `status: "fail"` and the thrown error message as `feedback`. Choose based on whether you want to surface the early stop as success or failure to the caller.

---

### Output Sanitization

Use `postExecutor` to sanitize execution results before they reach the Evaluator — stripping sensitive data, normalizing outputs, or filtering noise from step results.

```typescript
import type { ExecutorOutput } from "@tepa/types";

events: {
  postExecutor: [
    (data) => {
      const output = data as ExecutorOutput;

      const sanitized = output.results.map((r) => ({
        ...r,
        output:
          typeof r.output === "string"
            ? r.output.replace(/api_key=\w+/gi, "api_key=***")
            : r.output,
      }));

      return { ...output, results: sanitized };
    },
  ],
}
```

This pattern is also useful when step outputs contain very large payloads — you can truncate them before the Evaluator sends them to the LLM, reducing token usage in the evaluation phase.

---

### Combining Patterns

Callbacks compose naturally — register multiple handlers for the same event and they run in sequence, each receiving the output of the previous. A common production setup combines several patterns together:

```typescript
const tepa = new Tepa({
  provider,
  tools,
  events: {
    prePlanner: [enrichContextFromDatabase],

    postPlanner: [
      enforceSafetyFilter, // Transform: strip restricted tools
      logPlanToAuditTrail, // Observe: fire and forget
      presentPlanForApproval, // Pause: await human input
    ],

    postStep: [
      { handler: sendStepMetrics, continueOnError: true }, // Non-critical
    ],

    postEvaluator: [
      applyCustomTerminationRules, // Transform: may flip verdict
      { handler: sendToMonitoring, continueOnError: true }, // Non-critical
    ],
  },
});
```

Each callback is a single-responsibility function. The composition is declarative and the order is explicit — making the pipeline's control flow readable at a glance.

---

## What's Next

- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, the provider logging system, and custom provider implementation.
- [**Examples and Demos**](./09-examples-and-demos.md) — See the event system in action in the study-plan demo (human-in-the-loop) and other runnable examples.
- [**Pipeline in Detail**](./04-pipeline-in-detail.md#pipeline-lifecycle-events) — Complete callback contract: event data types, execution order, `continueOnError` semantics.
