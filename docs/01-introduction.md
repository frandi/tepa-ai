# Introduction

## What Is Tepa?

Tepa is a TypeScript framework for building autonomous AI agent pipelines that plan, execute, and self-correct without manual intervention.

The name comes from the Javanese concept *tepa slira* — the practice of self-reflection, measuring oneself against a standard before acting. This philosophy is embedded in the framework's core: every pipeline cycle ends with an evaluation step that measures results against the goal before deciding whether to continue, revise, or complete.

## The Problem

Building reliable AI agents is harder than it looks. Most approaches share a few recurring pain points:

- **Fragile single-shot prompts.** One prompt, one chance. If the LLM misunderstands the task or produces a partial result, there's no built-in mechanism to recover.
- **No self-correction.** When output quality falls short, the developer is left writing retry logic, parsing error messages, and bolting on ad-hoc feedback loops.
- **Tight LLM coupling.** Applications get locked into a single provider's API, making it expensive to switch models or use different models for different stages.
- **Text-based tool calling.** Many frameworks ask the LLM to produce tool invocations as free-form text or embedded JSON, which leads to escaping errors and brittle parsing.

These problems compound. A pipeline that can't self-correct, can't swap models, and can't reliably call tools is one that breaks often and is expensive to maintain.

## How Tepa Solves It

Tepa structures every task as an autonomous **Plan-Execute-Evaluate** loop:

1. **Planner** — An LLM analyzes the goal and produces a structured plan: ordered steps, each with assigned tools and declared dependencies.
2. **Executor** — Runs each step using native tool calling. The LLM returns structured tool invocations (not free-form text), and the framework handles invocation and result capture.
3. **Evaluator** — Judges the execution results against the expected output using both structural checks (do the required artifacts exist?) and qualitative checks (does the content address the goal?).
4. **Self-Correction** — If the evaluator returns a failing verdict, its feedback feeds back into the Planner for a revised plan. The loop repeats until the goal is met, a cycle limit is reached, or the token budget is exhausted.

This cycle runs autonomously. You define the goal, provide the tools, and Tepa handles the planning, execution, evaluation, and recovery.

## Key Differentiators

### LLM-Agnostic

Tepa defines a single `LLMProvider` interface with one method: `complete()`. Built-in providers exist for Anthropic, OpenAI, and Google Gemini — all interchangeable. You can assign different models to different pipeline stages (e.g., a cheaper model for planning, a more capable one for execution) or implement your own provider without touching the core.

### Native Tool Use

Tools are defined with structured schemas and passed directly to the LLM's native tool calling API. The LLM returns typed `tool_use` blocks with pre-parsed parameters — no regex extraction, no escaped JSON strings, no parsing ambiguity.

### Event-Driven Extensibility

Eight lifecycle hooks (`prePlanner`, `postPlanner`, `preExecutor`, `postExecutor`, `preEvaluator`, `postEvaluator`, `preStep`, `postStep`) let you observe, transform, or control the pipeline at every stage. Callbacks can modify data in-flight, pause execution with Promises, or inject external context — without subclassing or forking the core.

### Human-in-the-Loop Ready

The event system supports interactive workflows out of the box. Pause after planning to let a user review and approve the plan. After evaluation, let a user override a failing verdict or provide additional guidance. The framework doesn't force full autonomy — you choose how much control to hand over.

## Who Is Tepa For?

Tepa is built for developers who need AI agents to do more than generate text — agents that take action, verify their own work, and recover from mistakes.

Common use cases include:

- **Code generation and testing** — Generate code, run tests, and fix failures automatically across multiple cycles.
- **Data analysis pipelines** — Parse, analyze, and synthesize reports from structured data with LLM-driven reasoning.
- **Content and document generation** — Produce structured outputs (reports, plans, documentation) that meet specific quality criteria.
- **Automated workflows** — Chain tool calls (file I/O, shell commands, HTTP requests) into multi-step processes with built-in error recovery.

If your use case involves an LLM orchestrating tools toward a verifiable goal, Tepa provides the scaffolding.

### When Tepa Might Not Be the Best Fit

Tepa is designed for goal-oriented pipelines that run to completion. A few scenarios call for a different kind of tool:

- **Conversational agents and chatbots.** Tepa runs a pipeline from goal to result — it is not a multi-turn dialogue framework. If you're building a chat experience with back-and-forth conversation history, a conversational AI framework is a more natural fit. That said, you can invoke Tepa within a chat flow for specific messages that require complex, multi-step execution — using the conversation as the trigger and Tepa as the engine behind it.
- **Simple, single-turn tasks.** If you only need to send a prompt and get a text response, the Plan-Execute-Evaluate loop adds overhead you don't need. A direct LLM API call is simpler and cheaper.
- **Low-latency or streaming applications.** Each cycle involves multiple LLM calls (planner, executor, evaluator), and self-correction may add more cycles. Applications that require sub-second responses or progressive streaming output are better served by lighter-weight approaches.
- **Long-lived, stateful agents.** Each `run()` call is a self-contained pipeline invocation. Tepa does not maintain persistent memory across runs or manage long-running agent sessions. If you need an always-on agent with durable state, you'll want infrastructure built for that purpose.
- **Fixed, pre-defined workflows.** Tepa's strength is dynamically generating plans to find the most effective solution. If your steps are already known and never change, a traditional workflow engine or task queue is more appropriate. You can still embed Tepa as a step within a larger fixed pipeline, but it's not designed to be the orchestrator for rigid sequences.
- **Tasks without verifiable outcomes.** Tepa's evaluation step measures results against defined expected output. Open-ended tasks where success is highly subjective — such as freeform creative writing — may not benefit from the structured evaluation loop.

## Feature Summary

| Feature | Description |
|---|---|
| **Plan-Execute-Evaluate loop** | Autonomous multi-cycle pipeline with self-correction on failure |
| **Multi-provider support** | Anthropic, OpenAI, and Gemini via a unified `LLMProvider` interface |
| **Native tool calling** | Structured tool schemas passed to LLM APIs — no text parsing |
| **Built-in tools** | File system, shell execution, HTTP requests, data parsing, web search, scratchpad, and logging |
| **Event hooks** | 8 lifecycle events for observation, transformation, and control |
| **Scratchpad** | In-memory key-value store for sharing state across steps and cycles |
| **Structured prompts** | Goal, context, and expected output — loadable from YAML or JSON files |
| **Token budget** | Configurable token limits with per-cycle tracking to control LLM costs |
| **Per-stage model config** | Assign different models to planner, executor, and evaluator |
| **Sensible defaults** | Zero-config works out of the box; override only what you need |
| **Provider logging** | Automatic JSONL logging of all LLM calls with custom callback support |

## What's Next

- [**Getting Started**](./02-getting-started.md) — Install Tepa and run your first pipeline in under 10 lines.
- [**How Tepa Works**](./03-how-tepa-works.md) — A deeper look at the Plan-Execute-Evaluate cycle and package architecture.
