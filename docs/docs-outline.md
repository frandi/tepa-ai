# Tepa Documentation — Outline

## 1. Introduction

> File: `docs/01-introduction.md`

- Opening hook — what is Tepa and why it exists (etymology: "tepa slira")
- The problem: building reliable AI agent pipelines is hard (fragile single-shot prompts, no self-correction, tight LLM coupling)
- How Tepa solves it: autonomous Plan-Execute-Evaluate loop with self-correction
- Key differentiators: LLM-agnostic, event-driven extensibility, native tool use, human-in-the-loop ready
- Who is Tepa for (developers building AI-powered automation, data pipelines, code generation, etc.)
- High-level feature summary (multi-provider, built-in tools, event hooks, scratchpad, structured prompts)

## 2. Getting Started

> File: `docs/02-getting-started.md`

- Prerequisites (Node.js, API key)
- Install the essentials (`@tepa/core`, a provider, `@tepa/tools`)
- Minimal working example (~10 lines: create provider, pick tools, run)
- Understanding the result (`TepaResult` — status, cycles, logs)
- What just happened — brief walkthrough of the loop that ran behind the scenes
- Next steps pointers (go deeper into concepts, explore demos)

## 3. How Tepa Works

> File: `docs/03-how-tepa-works.md`

- The Plan-Execute-Evaluate cycle (visual diagram)
- Planner: breaks goals into dependency-ordered steps
- Executor: carries out steps using LLM + tools
- Evaluator: judges results, provides feedback for self-correction
- Self-correction: how failed cycles feed back into re-planning
- Scratchpad: how state flows across steps and cycles
- Event system at a glance: lifecycle hooks for observing, transforming, or pausing the pipeline
- Package architecture overview (`@tepa/core`, `@tepa/types`, `@tepa/tools`, `@tepa/provider-*`)

## 4. The Pipeline in Detail

> File: `docs/04-pipeline-in-detail.md`

### 4.1 Prompt Structure

- `TepaPrompt` — goal, context, expectedOutput
- YAML/JSON file loading with `parsePromptFile`

### 4.2 Planner

- How plans are generated (LLM-driven)
- `Plan` and `PlanStep` structure (id, description, tools, expectedOutcome, dependencies, model)
- Dependency rules (direct-only, unique IDs, reasoning steps vs. tool steps)
- Re-planning on failure (minimal revised plan from evaluator feedback + scratchpad)
- Parse failure retry (retry-once with simplified prompt)

### 4.3 Executor

- Topological sorting (Kahn's algorithm, circular dependency detection)
- Step execution flow (scoped inputs from dependencies, skip on upstream failure)
- Native tool calling (schema → LLM → `tool_use` block → invoke → capture result)
- Reasoning steps (empty tools array — pure LLM text response)
- `ExecutionResult` structure (stepId, status, output, error, tokens, duration)
- Automatic scratchpad write (`_execution_summary` after each cycle)

### 4.4 Evaluator

- Structural checks (artifacts exist, correct format) and qualitative checks (content addresses goal)
- `EvaluationResult` structure (verdict, confidence, feedback/summary, tokens)
- Parse failure handling (retry-once, synthetic fail with confidence 0)

### 4.5 Pipeline Lifecycle Events

- The 8 event points (pre/post for Planner, Executor, Evaluator, Step)
- Event flow diagram (prePlanner → ... → postEvaluator)
- What each event receives and can modify (reference table)
- Brief mention of async/Promise support for pausing (detailed in Section 7)

### 4.6 Cycles and Termination

- Cycle flow step-by-step (validate → init → loop: plan → execute → evaluate)
- Termination conditions (pass, max cycles, token budget, unrecoverable error)
- `TepaResult` structure (status, cycles, tokensUsed, outputs, logs, feedback)

### 4.7 Tools in the Pipeline Context

- How the Executor resolves tools from the registry
- How tool schemas are passed to the LLM (native tool use)
- Brief pointer to Section 6 for full tool system details

## 5. Configuration

> File: `docs/05-configuration.md`

- `TepaConfig` full structure (`ModelConfig`, `LimitsConfig`, `LoggingConfig`)
- Default values table
- Partial configuration with `defineConfig()` (deep merge + Zod validation)
- Model configuration (assigning different models to planner, executor, evaluator; per-step model overrides)
- Limits configuration (maxCycles, maxTokens, toolTimeout, retryAttempts — what each controls)
- Logging configuration (levels: minimal, standard, verbose — what each outputs)
- Invalid configuration errors (`TepaConfigError`)

## 6. Tool System

> File: `docs/06-tool-system.md`

### 6.1 Tool Definition

- `ToolDefinition` interface
- `ParameterDef` — type, description, required, default

### 6.2 Creating Tools

- `defineTool` utility (Zod validation at creation time)

### 6.3 Registering Tools

- Passing tools to the `Tepa` constructor
- `ToolRegistryImpl` for programmatic use

### 6.4 Built-in Tools Reference

- File system: `file_read`, `file_write`, `directory_list`, `file_search`
- Execution: `shell_execute`
- Network: `http_request`, `web_search`
- Data: `data_parse`
- Pipeline internal: `scratchpad`, `log_observe`

### 6.5 Creating Third-Party Tools

- npm package contract — export a `ToolDefinition`, import and pass to `Tepa`

## 7. Event System Patterns

> File: `docs/07-event-system-patterns.md`

- Recap: event registration at initialization (`events` option in `Tepa` constructor)
- Callback contract (signature, return semantics, Promise support)
- Execution order (middleware-style chaining)
- Error handling in callbacks (`continueOnError`)
- Pattern: Human-in-the-loop approval (postPlanner — pause with Promise, present plan, await approval)
- Pattern: Human override on failure (postEvaluator — let user accept or retry)
- Pattern: Plan safety filter (postPlanner — inspect/remove restricted tool steps)
- Pattern: Input enrichment (prePlanner — fetch external context, append to prompt)
- Pattern: Step-level progress tracking (preStep/postStep — emit real-time updates)
- Pattern: Custom termination logic (postEvaluator — abort based on business rules)
- Pattern: External logging and monitoring (postEvaluator — send verdicts to monitoring)
- Pattern: Data cleanup (postExecutor — sanitize results before evaluation)

## 8. LLM Providers

> File: `docs/08-llm-providers.md`

### 8.1 Provider Interface

- `LLMProvider`, `LLMMessage`, `LLMRequestOptions`, `LLMResponse`, `LLMToolUseBlock`

### 8.2 Built-in Providers

- Anthropic (`@tepa/provider-anthropic` — setup, env var, options, default model)
- OpenAI (`@tepa/provider-openai` — setup, env var, options, Responses API)
- Gemini (`@tepa/provider-gemini` — setup, env var, options, system instructions)

### 8.3 Native Tool Use

- How providers forward tool schemas
- Why structured `tool_use` blocks eliminate parsing errors

### 8.4 Provider Logging System

- Default file logging (JSONL to `.tepa/logs/`)
- `LLMLogEntry` structure
- Custom log listeners (`onLog()`)
- Sending logs to external services (Prometheus, NewRelic, Datadog examples)
- Built-in log callbacks (`consoleLogCallback`, `createFileLogWriter`)
- Accessing log history (`getLogEntries()`, `getLogFilePath()`)
- Privacy controls (`includeContent`)

### 8.5 Base Provider

- `BaseLLMProvider` — retry logic, exponential backoff, rate limit handling

### 8.6 Creating a Custom Provider

- Extending `BaseLLMProvider`
- Implementing `doComplete`, `isRetryable`, `isRateLimitError`, `getRetryAfterMs`

## 9. Examples and Demos

> File: `docs/09-examples-and-demos.md`

### 9.1 API Client Generation

- Fully autonomous, multi-cycle self-correction, code generation + test execution

### 9.2 Student Progress Analysis

- Data pipeline, CSV parsing, report generation, single-cycle completion

### 9.3 Study Plan Generator

- Human-in-the-loop, interactive approval gates, verdict override

## 10. Contributing

> File: `docs/10-contributing.md`

- Development setup (monorepo structure, install, build, test)
- Code conventions and style
- How to add a new built-in tool
- How to add a new LLM provider
- Pull request guidelines
- Issue reporting

## 11. API Reference

> File: `docs/11-api-reference.md`

- `Tepa` class (`constructor`, `run`)
- `TepaPrompt`, `ExpectedOutput`
- `TepaResult`, `OutputArtifact`, `LogEntry`
- `TepaConfig`, `ModelConfig`, `LimitsConfig`, `LoggingConfig`
- `Plan`, `PlanStep`
- `ExecutionResult`, `EvaluationResult`
- `ToolDefinition`, `ParameterDef`, `ToolRegistry`, `ToolSchema`
- `LLMProvider`, `LLMMessage`, `LLMResponse`, `LLMRequestOptions`, `LLMToolUseBlock`
- `EventName`, `EventMap`, `EventCallback`, `EventRegistration`, `CycleMetadata`
- Error classes (`TepaError`, `TepaConfigError`, `TepaPromptError`, `TepaToolError`, `TepaCycleError`, `TepaTokenBudgetExceeded`)
- Utility functions (`defineConfig`, `defineTool`, `parsePromptFile`)
- `BaseLLMProvider`, `BaseLLMProviderOptions`
- `LLMLogEntry`, `consoleLogCallback`, `createFileLogWriter`
