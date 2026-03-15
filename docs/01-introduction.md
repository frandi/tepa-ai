# Introduction

## What Is Tepa?

Tepa is a TypeScript framework for building AI agents that plan, execute, and **verify their own work**.

The name comes from the Javanese concept _tepa slira_ — the practice of self-reflection, measuring oneself against a standard before acting. That philosophy is the framework's core: every pipeline cycle ends not with "done" but with a question — _did it actually pass?_ — and the agent keeps going until it does, or until it honestly can't.

Most agent frameworks give you the ability to run. Tepa gives you the ability to know when you've succeeded.

---

## The Problem Worth Solving

Building reliable AI agents is harder than it looks. Most pipelines share the same failure modes:

- **Silent failure.** The agent runs, returns output, and declares success. Whether that output is correct is left to you to discover — usually downstream, usually too late.
- **No recovery path.** When something goes wrong, there's no built-in mechanism to try again with a revised approach. You write the retry logic yourself, every time.
- **Tight LLM coupling.** Lock-in to a single provider makes it expensive to switch models or use cheaper models for lighter stages.
- **Brittle tool calling.** Frameworks that ask the LLM to produce tool invocations as free-form text invite parsing errors and hard-to-debug failures.

These problems compound. An agent that can't evaluate its own output, can't self-correct, and can't reliably call tools is one that breaks quietly and is expensive to maintain.

---

## How Tepa Works

Tepa structures every task as a self-correcting **Plan → Execute → Evaluate** loop:

1. **Planner** — An LLM analyzes the goal and produces a structured plan: ordered steps, assigned tools, declared dependencies.
2. **Executor** — Runs each step using native tool calling. The LLM returns structured tool invocations — no free-form text, no string parsing — and the framework handles invocation and result capture.
3. **Evaluator** — Judges the results against the expected output using both structural checks (do the required artifacts exist?) and qualitative checks (does the content address the goal?).
4. **Self-Correction** — If the evaluator returns a failing verdict, its feedback feeds back into the Planner for a revised approach. The loop repeats until the goal is met, a cycle limit is reached, or the token budget is exhausted.

You define the goal, provide the tools, and state what success looks like. Tepa handles everything in between.

### The Result You Get Back

```ts
const result = await tepa.run({
  goal: "Create a hello world TypeScript file and verify it compiles",
  context: { projectDir: "./my-project" },
  expectedOutput: "A file at src/hello.ts that compiles without errors",
});

console.log(result.status); // "pass" | "fail" | "terminated"
console.log(result.feedback); // Summary of what happened, or why it failed
```

`status` is not a guess. It's a verdict — produced by the same evaluator that drove the agent's self-correction loop.

---

## What Makes Tepa Different

### An Evaluator Is a First-Class Citizen

Most frameworks leave the question of _"did it work?"_ to you. Tepa treats evaluation as a required step in every cycle, not an afterthought. You define success criteria upfront as `expectedOutput`; the framework measures every run against it. This makes pass/fail auditable, consistent, and independent of which LLM you're using.

### Self-Correction With Revised Planning

When the evaluator says "fail," the feedback doesn't just go to the executor for a retry — it goes back to the **Planner**. The agent reasons about _why_ it failed and produces a genuinely different approach. This is the difference between retrying and rethinking.

### LLM-Agnostic by Design

Tepa defines a single `LLMProvider` interface with one method: `complete()`. Built-in providers exist for Anthropic, OpenAI, and Google Gemini — all interchangeable. You can assign different models to different pipeline stages (e.g., a cheaper model for planning, a more capable one for execution), or implement your own provider without touching the core.

### Native Tool Use — No String Parsing

Tools are defined with structured schemas passed directly to the LLM's native tool calling API. The LLM returns typed `tool_use` blocks with pre-parsed parameters. No regex, no escaped JSON, no parsing ambiguity.

### Event-Driven Control at Every Stage

Eight lifecycle hooks — `prePlanner`, `postPlanner`, `preExecutor`, `postExecutor`, `preEvaluator`, `postEvaluator`, `preStep`, `postStep` — let you observe, modify, or pause the pipeline at any point. Callbacks can transform data in-flight, inject external context, or pause with a Promise for human review.

### Human-in-the-Loop, When You Want It

Full autonomy isn't always the goal. Tepa's event system supports interactive workflows out of the box: pause after planning to let a user review and approve steps, or let a user override a failing verdict and provide additional guidance. You decide how much control to hand over.

### Extensible by Design — Bring Your Own Tools and Providers

Tepa's core is intentionally lean: it ships the tools and LLM providers that most users need, and no more. Everything else is meant to be built and shared by the community as independent npm packages.

This is a deliberate architectural choice, not a gap. Because tools and providers are just plain objects that satisfy a typed interface, extending Tepa doesn't require forking the core repo or working around framework internals. You install `@tepa/types`, implement the interface, and plug it in.

**Adding a community tool** is as simple as installing a package:

```ts
import { Tepa } from "@tepa/core";
import { AnthropicProvider } from "@tepa/provider-anthropic";
import { fileReadTool, fileWriteTool } from "@tepa/tools";
import { redisCacheTool } from "tepa-tool-redis-cache"; // community package

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, redisCacheTool], // all tools are equal
});
```

**Adding a custom LLM provider** means extending `BaseLLMProvider` from `@tepa/provider-core`, which gives you retry logic, exponential backoff, rate limit handling, and structured logging for free. You implement one core method — `doComplete()` — and the rest is handled.

The result is a framework where the ecosystem can grow without the core growing. Third-party tools and providers are first-class citizens — Tepa treats them identically to its own built-ins.

See the [Tool System](./06-tool-system.md) and [LLM Providers](./08-llm-providers.md) docs for a full guide to building your own, and [Contributing](./10-contributing.md) if you'd like to publish yours for others to use.

---

## Where Tepa Fits Best

Tepa is purpose-built for a specific kind of task: **goal-oriented pipelines where you can define what "done" looks like**.

Common fits include:

- **Code generation and testing** — Generate code, run tests, and fix failures automatically. The test suite _is_ the expected output.
- **Data analysis pipelines** — Parse, analyze, and synthesize reports from structured data, with LLM-driven reasoning across multiple steps.
- **Document and content generation** — Produce structured outputs (reports, plans, documentation) that need to meet specific quality or completeness criteria.
- **Automated multi-step workflows** — Chain tool calls (file I/O, shell commands, HTTP requests) into processes that need to handle their own errors and recover gracefully.

The common thread: **a verifiable success condition**. If you can write an `expectedOutput` that the evaluator can measure against, Tepa can take it from there.

---

## When Tepa Isn't the Right Tool

Tepa is intentionally narrow. It does one thing well — self-correcting, goal-oriented pipelines — and it doesn't try to be everything.

Here's where another tool is likely a better fit, and how you might still use Tepa alongside it:

| Scenario                             | Why Tepa Isn't Ideal                                                            | How to Combine                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Conversational agents / chatbots** | Tepa runs a pipeline to completion — it's not a multi-turn dialogue framework   | Use your chat framework for conversation, invoke Tepa for specific turns that need multi-step execution |
| **Simple, single-turn tasks**        | The Plan-Execute-Evaluate loop adds overhead you don't need                     | Call the LLM directly; save Tepa for the complex tasks                                                  |
| **Low-latency or streaming apps**    | Multiple LLM calls per cycle; self-correction may add more                      | Use a lighter-weight approach; Tepa can still handle async background jobs                              |
| **Long-lived stateful agents**       | Each `run()` is self-contained; no persistent memory across runs                | Use a stateful agent framework for session management; trigger Tepa runs within sessions                |
| **Fixed, pre-defined workflows**     | Tepa's strength is dynamic planning; rigid step sequences don't benefit from it | Use a workflow engine for fixed sequences; Tepa can be an individual step inside one                    |
| **Open-ended creative tasks**        | Evaluation works best when success criteria are concrete                        | Skip the evaluator and use a direct LLM call; Tepa won't add value here                                 |

The goal of this list isn't to discourage — it's to help you spend your time well. Tepa works best when you reach for it deliberately, for the tasks it was designed to handle.

---

## Feature Summary

| Feature                         | Description                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Plan-Execute-Evaluate loop**  | Autonomous multi-cycle pipeline with self-correction on failure                                              |
| **Multi-provider support**      | Anthropic, OpenAI, and Gemini via a unified `LLMProvider` interface                                          |
| **Native tool calling**         | Structured tool schemas passed to LLM APIs — no text parsing                                                 |
| **Built-in tools**              | File system, shell execution, HTTP requests, data parsing, web search, scratchpad, and logging               |
| **Community tools & providers** | Any npm package implementing `ToolDefinition` or `LLMProvider` works out of the box — no core changes needed |
| **Event hooks**                 | 8 lifecycle events for observation, transformation, and human-in-the-loop control                            |
| **Scratchpad**                  | In-memory key-value store for sharing state across steps and cycles                                          |
| **Structured prompts**          | Goal, context, and expected output — loadable from YAML or JSON files                                        |
| **Token budget**                | Configurable token limits with per-cycle tracking to control LLM costs                                       |
| **Per-stage model config**      | Assign different models to planner, executor, and evaluator                                                  |
| **Sensible defaults**           | Zero-config works out of the box; override only what you need                                                |
| **Provider logging**            | Automatic JSONL logging of all LLM calls with custom callback support                                        |

---

## What's Next

- [**Getting Started**](./02-getting-started.md) — Install Tepa and run your first pipeline in under 10 lines.
- [**How Tepa Works**](./03-how-tepa-works.md) — A deeper look at the Plan-Execute-Evaluate cycle and package architecture.
