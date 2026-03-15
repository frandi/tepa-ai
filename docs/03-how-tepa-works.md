# How Tepa Works

This section builds a mental model of Tepa's core loop — what each component does, why the cycle is structured the way it is, and how state flows from a goal to a verified result. It's the right read after Getting Started, before you start building something non-trivial.

If you're looking for the complete technical reference — full interfaces, event data contracts, prompt structure, termination rules, edge cases — that's in [Pipeline in Detail](./04-pipeline-in-detail.md).

---

## The Plan-Execute-Evaluate Loop

Every call to `tepa.run()` triggers a loop. It keeps running until one of three things happens: the agent passes its own evaluation, it runs out of allowed cycles, or it exhausts its token budget.

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌───────────┐   │
  │  Prompt  │──▶│ Planner  │──▶│ Executor  │──▶│ Evaluator │   │
  └──────────┘   └──────────┘   └───────────┘   └───────────┘   │
                    ▲                                │            │
                    │                                ▼            │
                    │                          ┌───────────┐      │
                    │                          │  Verdict? │      │
                    │                          └───────────┘      │
                    │                           │         │       │
                    │                         pass       fail     │
                    │                           │         │       │
                    │                           ▼         │       │
                    │                        [Done]       │       │
                    │                                     │       │
                    └─────────── feedback ────────────────┘       │
                                + scratchpad                      │
                    ┌─────────────────────────────────────────────┘
                    │  (repeat until pass, max cycles, or token budget)
```

The loop terminates on the first condition that fires:

| Condition | Result |
|---|---|
| Evaluator returns `pass` | `"pass"` |
| Max cycles exhausted (default: 5) | `"fail"` |
| Token budget exceeded (default: 64,000) | `"terminated"` |

Here's what happens inside each component.

---

## The Planner

The Planner's job is to turn your goal into a sequence of actionable steps — each with a tool assignment, a declared dependency, and a description of what success looks like for that step.

It receives three things: the goal and expected output you provided, the full list of tools available to the agent, and — on retry cycles — the evaluator's feedback from the previous attempt plus a summary of what already succeeded.

What it produces is a **structured plan**: an ordered list of steps with declared dependencies between them. A step can depend on the output of a prior step. A step with no tools assigned is a *reasoning step* — the LLM produces a text analysis rather than invoking a tool, which is useful for distilling or interpreting data before a downstream tool-calling step consumes it.

**On failure, the Planner doesn't start over — it revises.** It sees exactly what succeeded and what didn't in the previous cycle, and produces a minimal revision: only fix what failed, build on what worked. This keeps self-correction efficient rather than wasteful.

---

## The Executor

The Executor takes the plan and runs each step in the correct order, enforcing dependencies so no step runs before the data it needs is ready.

Before executing anything, it performs a **topological sort** of the plan steps — resolving all declared dependencies into a safe execution order. If a circular dependency exists, it throws immediately before any step runs.

Each step then runs in sequence:

- If a step's upstream dependency failed, the step is automatically skipped. Failures cascade — Tepa won't waste tokens running a step whose inputs are already broken.
- Each step only receives the outputs of its *declared* dependencies — not the full result set. This is enforced by the framework, preventing a step from accidentally consuming data it didn't explicitly ask for.
- For tool steps, the LLM receives the step description along with the tool's schema and returns a **structured `tool_use` block** — typed parameters, no free-form text, no string parsing. The framework invokes the tool directly with those parameters.
- For reasoning steps, the LLM produces a text response that becomes that step's output, available to any downstream step that depends on it.

The key design principle here: **the Executor never guesses.** It only calls tools the Planner explicitly assigned. It only passes data that was explicitly declared as a dependency. There's no implicit state sharing between steps — everything flows through the dependency graph.

---

## The Evaluator

After all steps complete, the Evaluator asks the only question that matters: *did the result actually meet the goal?*

It assesses two dimensions simultaneously:

- **Structural:** Do the expected outputs exist? Are required files present, in the right format, at the right paths?
- **Qualitative:** Is the content meaningful and correct? Does it actually address the goal — not just superficially satisfy the form?

The Evaluator returns a verdict: `pass` or `fail`. On `fail`, it produces **actionable feedback** — specific, referencing which steps fell short and what should change. This feedback is exactly what the Planner receives on the next cycle. It's not a log message; it's a instruction for improvement.

On `pass`, the evaluator's summary becomes the `feedback` field in the final `TepaResult` — a human-readable confirmation of what was accomplished.

**This is the part most agent frameworks leave to you.** In Tepa, the evaluation is a first-class step in every cycle, not something you bolt on afterward. `result.status` is a verdict, not a guess.

---

## The Scratchpad

The Scratchpad is an in-memory key-value store that persists across all steps and all cycles within a single `run()` call. It's how state flows through the pipeline without being passed explicitly through every step.

Steps can read and write to it freely using the built-in `scratchpadTool`. After every cycle, the framework automatically writes a `_execution_summary` key — a record of every step's ID, status, output, and any errors. On the next cycle, the Planner reads this summary to understand exactly what happened before.

This is what makes self-correction efficient. The Planner doesn't re-examine the world from scratch — it reads the scratchpad and knows which steps succeeded, which failed, and what the evaluator found lacking. It revises accordingly.

Three components see the scratchpad:

- **Planner** (on re-plan cycles) — reads `_execution_summary` to understand prior results
- **Executor** — each step sees the current scratchpad state in its context
- **Evaluator** — reads the scratchpad when judging execution results

---

## The Event System

Eight lifecycle hooks let you observe, transform, or control the pipeline at any stage — without modifying the core.

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

Events are registered in the `Tepa` constructor:

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  events: {
    postPlanner: [
      (plan, cycle) => {
        console.log(`Cycle ${cycle.cycleNumber}: ${plan.steps.length} steps planned`);
      },
    ],
    postStep: [
      (data, cycle) => {
        console.log(`Step ${data.step.id}: ${data.result.status}`);
      },
    ],
  },
});
```

Every callback receives the pipeline data for that stage and a `CycleMetadata` object with `cycleNumber`, `totalCyclesUsed`, and `tokensUsed`.

Three things callbacks can do:

**Observe** — read pipeline data, log it, send it to an external system. Return nothing and the data passes through unchanged.

**Transform** — return a modified version of the data and it replaces the original for all subsequent callbacks in the chain. This means you can rewrite a plan before the Executor sees it, or adjust an evaluation verdict before it feeds back to the Planner.

**Pause** — return a Promise. The framework awaits it. This is how human-in-the-loop workflows work: pause after planning, present the plan to a user for review, resume only after approval.

For deeper patterns — approval gates, safety filters, progress tracking, custom termination logic — see [Event System Patterns](./07-event-system-patterns.md).

---

## Package Architecture

Tepa is a monorepo where each package has a single responsibility and a clean dependency boundary:

```
@tepa/types              ← shared interfaces, zero runtime code
    ↑
    ├── @tepa/core        ← pipeline engine: Planner, Executor, Evaluator,
    │                       Scratchpad, EventBus, TokenTracker, config
    │
    ├── @tepa/tools       ← built-in tool implementations
    │
    └── @tepa/provider-core   ← BaseLLMProvider with retry, backoff,
            ↑                   rate limit handling, and logging
            ├── @tepa/provider-anthropic
            ├── @tepa/provider-openai
            └── @tepa/provider-gemini
```

The key design principle: **`@tepa/core` has no dependency on any provider or tool package.** You pass providers and tools in at construction time. This is why swapping providers is a one-line change, and why community tools are first-class citizens alongside built-ins — the core doesn't know the difference.

`@tepa/types` is the shared contract. It contains only TypeScript type definitions — no runtime code. Every other package depends on it, and any external package implementing `ToolDefinition` or extending `BaseLLMProvider` from `@tepa/provider-core` integrates with Tepa without touching the core.

---

## Putting It Together

When you call `tepa.run()`:

1. Your `goal`, `context`, and `expectedOutput` become the prompt that drives every component.
2. The Planner reads your tools and produces a dependency-ordered plan.
3. The Executor resolves the dependency graph and runs each step, passing structured data between them.
4. The Evaluator judges the result against your `expectedOutput` and either returns a verdict or feeds actionable feedback back to the Planner.
5. The Scratchpad carries state across steps and cycles so the agent always builds on what it already knows.
6. Your event callbacks — if any — observe or shape the pipeline at every stage.

All of that, inside a single `await tepa.run()`.

---

## What's Next

- [**Pipeline in Detail**](./04-pipeline-in-detail.md) — The complete technical reference: full interfaces, prompt structure, plan validation rules, tool schema flow, event data contracts, and termination edge cases. Read this when you're building something non-trivial.
- [**Configuration**](./05-configuration.md) — Cycle limits, token budgets, per-stage model assignments, and logging levels.
- [**Tool System**](./06-tool-system.md) — Built-in tools, custom tool definitions, and third-party packages.
- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and more.
