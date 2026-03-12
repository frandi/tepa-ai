# Tepa — Requirements Document v2

> *Tepa* — from Javanese *tepa slira*: the practice of self-reflection, measuring oneself against a standard before acting. An agent that doesn't just execute, but reflects, evaluates, and refines.

## 1. Overview

**Tepa** is a reusable library/framework that enables task execution through a cyclic loop of three core components: **Planner**, **Executor**, and **Evaluator**. By default, the pipeline operates as a fully autonomous system — once an initial prompt is submitted, it plans how to approach the task, executes the plan using available tools, evaluates the results, and self-corrects until the desired output is achieved or operational limits are reached.

Through its **Event System**, callers can hook into the pipeline at each stage — observing, transforming, or pausing the flow as needed. This enables a wide range of operational modes, from fully autonomous execution to human-in-the-loop workflows where approval or input is required between stages.

The framework is **LLM-provider-agnostic**, extensible, and configurable. Developers integrate it by providing a prompt, registering tools, selecting an LLM provider, configuring events, and setting configuration parameters. Tepa handles the rest.

### 1.1 Package Architecture

Tepa is organized as a monorepo with the following packages:

| Package | Purpose |
|---------|---------|
| `@tepa/core` | Pipeline orchestrator (Planner, Executor, Evaluator, Event Bus, Scratchpad) |
| `@tepa/types` | Shared TypeScript type definitions used across all packages |
| `@tepa/tools` | Built-in tool implementations, tool registry, and `defineTool` utility |
| `@tepa/provider-core` | Base class for LLM providers with retry logic and file logging |
| `@tepa/provider-anthropic` | Anthropic Claude provider |
| `@tepa/provider-openai` | OpenAI provider |
| `@tepa/provider-gemini` | Google Gemini provider |

---

## 2. Core Components

### 2.1 Planner

The Planner is the strategic brain of the pipeline. It receives the initial prompt (or feedback from a previous evaluation cycle) and produces a structured, step-by-step plan with a dependency graph.

**Responsibilities:**

- Parse the initial prompt to understand the goal, context, and expected output.
- Break the goal down into discrete steps, each with an explicit list of dependencies on prior steps.
- Assign appropriate tools to each step based on the available tool registry.
- Assign an LLM model tier to each step (executor model for simple tool-parameter construction, planner model for complex reasoning).
- Estimate token usage for the plan.
- On subsequent cycles, receive evaluator feedback and the current scratchpad state, and produce a *minimal revised plan* — fixing only what failed rather than regenerating the entire plan from scratch.
- If the LLM produces unparseable output, retry once with a simplified prompt before raising an error.

**Inputs:**

- Initial prompt (first cycle) or evaluator feedback + scratchpad state (subsequent cycles).
- Tool registry (list of available tools with their schemas and parameter definitions).
- Model configuration (available model tiers).

**Outputs:**

- A `Plan` object containing:
  - `steps`: An ordered list of `PlanStep` objects (see Section 2.1.1).
  - `estimatedTokens`: Token estimate for executing the plan.
  - `reasoning`: Explanation of why this plan structure was chosen.

#### 2.1.1 PlanStep Structure

Each step in a plan has the following structure:

```typescript
interface PlanStep {
  id: string;              // Unique identifier (e.g., "step_1")
  description: string;     // What this step does
  tools: string[];         // Tool names to use (empty array = LLM reasoning step)
  expectedOutcome: string; // What this step should produce
  dependencies: string[];  // Step IDs that must complete first (direct only)
  model?: string;          // Optional model override for this step
}
```

**Rules:**

- Step IDs must be unique.
- Dependencies must reference step IDs that exist within the same plan.
- Dependencies must be **direct only** — if step_3 depends on step_2 which depends on step_1, step_3 should list only `["step_2"]` unless it directly needs step_1's output.
- An empty `tools` array indicates a pure LLM reasoning step (no tool invocation).
- The `model` field is optional. If omitted, the step uses the default executor model. Steps requiring complex analysis or synthesis should use the planner model.

### 2.2 Executor

The Executor is the operational engine. It takes the plan and carries out each step using **native LLM tool calling** — the LLM receives tool schemas and returns structured `tool_use` blocks with parameters, which the Executor then invokes.

**Responsibilities:**

- **Topologically sort** plan steps based on their dependency graph (using Kahn's algorithm). Detect and reject circular dependencies.
- Execute steps in dependency-safe order.
- For each step, **scope inputs**: only provide outputs from steps listed in that step's `dependencies` array.
- Skip steps whose dependencies have failed.
- For **tool steps** (non-empty `tools` array): send the step description and context to the LLM along with tool schemas, receive a `tool_use` block, and invoke the tool with the LLM-provided parameters.
- For **reasoning steps** (empty `tools` array): send the step description and context to the LLM, capture the text response as the step output.
- Capture and store results from each step.
- Handle tool failures gracefully — capture errors and surface them for evaluation.
- Fire `preStep` and `postStep` events around each individual step execution.

**Inputs:**

- The `Plan` (list of steps with dependencies from the Planner).
- Execution context: original prompt, cycle number, scratchpad, previous cycle results (if any).
- Tool registry (to resolve tool definitions and schemas).
- Event bus (for preStep/postStep events).

**Outputs:**

- `ExecutorOutput` containing:
  - `results`: Array of `ExecutionResult` objects (one per step).
  - `logs`: Array of `LogEntry` objects.
  - `tokensUsed`: Total tokens consumed across all steps.

#### 2.2.1 ExecutionResult Structure

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

#### 2.2.2 Native Tool Calling

The Executor uses the LLM provider's native tool-use capability rather than parsing tool parameters from free-form text. The flow for a tool step is:

1. Build a user message containing: step description, expected outcome, tool name, original goal, context, scratchpad state, and outputs from dependency steps.
2. Call `provider.complete()` with the tool's schema in the `tools` option.
3. The LLM returns a response with a `toolUse` block containing the tool name and structured input parameters.
4. Invoke `tool.execute(toolCall.input)` with the LLM-provided parameters.
5. Capture the tool output as the step result.

If the LLM does not return a `tool_use` block for the expected tool, the step is marked as failed.

### 2.3 Evaluator

The Evaluator is the quality gate. It inspects the Executor's results against the original goal and expected output criteria, then decides whether the pipeline should terminate or loop back.

**Responsibilities:**

- Compare the Executor's output against the expected output defined in the initial prompt.
- Perform both **structural checks** (do the expected files/artifacts exist? are the right fields present?) and **qualitative checks** (is the content meaningful? does the output address the goal?).
- Produce a verdict: **pass** or **fail**.
- Produce a **confidence score** (0.0 to 1.0) reflecting certainty in the verdict.
- On failure, generate specific, actionable feedback describing what went wrong and what needs to change — this feedback is sent to the Planner for the next cycle.
- On pass, generate a summary of what was achieved.
- If the LLM produces unparseable output, retry once with a simplified prompt. If both attempts fail, return a synthetic fail result with confidence 0.

**Inputs:**

- Original prompt (goal + expected output).
- Executor results (outputs from all steps).
- Scratchpad contents.

**Outputs:**

- `EvaluationResult` containing:
  - `verdict`: `"pass"` or `"fail"`.
  - `confidence`: Number between 0 and 1.
  - `feedback`: (on fail) Specific description of what went wrong.
  - `summary`: (on pass) Description of what was achieved.
  - `tokensUsed`: Tokens consumed by the evaluation.

---

## 3. Pipeline Flow

The pipeline follows a cyclic flow that repeats until the Evaluator issues a **pass** verdict or a termination condition is reached.

```
                    ┌──────────────────────────────────────────┐
                    │            Initial Prompt                │
                    │  (goal + context + expected output)       │
                    └──────────────────┬───────────────────────┘
                                       │
                                       ▼
                              ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                                 prePlanner
                              └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                                       │
                                       ▼
                              ┌─────────────────┐
                 ┌───────────►│    PLANNER       │
                 │            │                  │
                 │            │  Produces a      │
                 │            │  step-by-step    │
                 │            │  plan with deps  │
                 │            └────────┬─────────┘
                 │                     │
                 │                     ▼
                 │            ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                 │               postPlanner
                 │            └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                 │                     │
                 │                     ▼
                 │            ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                 │               preExecutor
                 │            └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                 │                     │
                 │                     ▼
                 │            ┌─────────────────┐
                 │            │    EXECUTOR      │
                 │            │                  │
                 │            │  For each step:  │
                 │            │   preStep        │
                 │            │   [execute]      │
                 │            │   postStep       │
                 │            └────────┬─────────┘
                 │                     │
                 │                     ▼
                 │           [write _execution_summary
                 │            to scratchpad]
                 │                     │
                 │                     ▼
                 │            ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                 │               postExecutor
                 │            └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                 │                     │
                 │                     ▼
                 │            ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                 │               preEvaluator
                 │            └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                 │                     │
                 │                     ▼
                 │            ┌─────────────────┐
                 │            │   EVALUATOR      │
                 │            │                  │
                 │            │  Checks results  │
                 │            │  against goal    │
                 │            └────────┬─────────┘
                 │                     │
                 │                     ▼
                 │            ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                 │               postEvaluator
                 │            └ ─ ─ ─ ─ ─ ─ ─ ─ ┘
                 │                     │
                 │              ┌──────┴──────┐
                 │              │             │
                 │            fail          pass
                 │              │             │
                 │              ▼             ▼
                 │        ┌──────────┐  ┌──────────────┐
                 └────────┤ Feedback │  │ Final Output │
                          └──────────┘  └──────────────┘
```

**Step-by-step flow:**

1. The caller submits a **`TepaPrompt`** containing the goal, context, and expected output.
2. Prompt is validated against the schema.
3. Tools are registered into an inline tool registry.
4. Scratchpad, token tracker, logger, and event bus are initialized.
5. **For each cycle** (1 to `maxCycles`):
   1. Build cycle metadata (cycle number, total cycles used, tokens used so far).
   2. **prePlanner** events fire, receiving `{ prompt, feedback }`.
   3. The **Planner** produces a plan (initial or revised based on feedback + scratchpad).
   4. Token tracker records planner token usage.
   5. **postPlanner** events fire, receiving the `Plan`.
   6. **preExecutor** events fire, receiving `{ plan, prompt, cycle, scratchpad, previousResults }`.
   7. The **Executor** topologically sorts steps, then executes each in order with preStep/postStep events.
   8. Token tracker records executor token usage.
   9. Execution summary is written to scratchpad under key `_execution_summary`.
   10. **postExecutor** events fire, receiving the `ExecutorOutput`.
   11. **preEvaluator** events fire, receiving `{ prompt, results, scratchpad }`.
   12. The **Evaluator** inspects results against expected output.
   13. Token tracker records evaluator token usage.
   14. **postEvaluator** events fire, receiving the `EvaluationResult`.
   15. If verdict is **pass**: return `TepaResult` with `status: "pass"`.
   16. If verdict is **fail**: store feedback for next cycle's planner.
6. If max cycles exhausted: return `TepaResult` with `status: "fail"`.
7. If token budget exceeded at any point: return `TepaResult` with `status: "terminated"`.
8. If an unrecoverable `TepaError` occurs: return `TepaResult` with `status: "fail"`.
9. Any other error is re-thrown as a `TepaError`.

---

## 4. Event System

The Event System provides lifecycle hooks around each core component and individual execution steps, giving callers the ability to inject custom behavior without modifying the core framework.

### 4.1 Event Points

There are eight event points — a **pre** and **post** event for each core component, plus step-level events within the Executor:

| Event | Fires | Receives | Can Modify |
|---|---|---|---|
| `prePlanner` | Before the Planner runs | `{ prompt: TepaPrompt, feedback?: string }` | Planner input |
| `postPlanner` | After the Planner completes | `Plan` | Plan |
| `preExecutor` | Before the Executor runs | `{ plan, prompt, cycle, scratchpad, previousResults? }` | Executor input |
| `postExecutor` | After the Executor completes | `ExecutorOutput` | Executor output |
| `preEvaluator` | Before the Evaluator runs | `{ prompt, results, scratchpad }` | Evaluator input |
| `postEvaluator` | After the Evaluator completes | `EvaluationResult` | Evaluation result |
| `preStep` | Before each step executes | `{ step: PlanStep, cycle: number }` | Step input |
| `postStep` | After each step completes | `{ step: PlanStep, result: ExecutionResult, cycle: number }` | Step result |

The pipeline flow with events:

```
prePlanner → [PLANNER] → postPlanner → preExecutor →
  [EXECUTOR: preStep → [step] → postStep (per step)] →
postExecutor → preEvaluator → [EVALUATOR] → postEvaluator
```

All component-level events fire on every cycle. Step-level events fire for every step within each cycle.

### 4.2 Event Registration

Event callbacks are registered at `Tepa` initialization time as part of the options. Callers provide a mapping of event names to one or more callback functions or registration objects.

```typescript
const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [...],
  events: {
    prePlanner: [callbackA, callbackB],
    postExecutor: [callbackC],
    preEvaluator: [{ handler: callbackD, continueOnError: true }],
    preStep: [stepLogger],
    postStep: [stepResultHandler],
  },
});
```

### 4.3 Event Contract

Each callback receives two arguments: the event data and cycle metadata.

```typescript
type EventCallback<T> = (data: T, cycle: CycleMetadata) => T | void | Promise<T | void>;

interface CycleMetadata {
  cycleNumber: number;
  totalCyclesUsed: number;
  tokensUsed: number;
}
```

**Rules:**

- If the callback returns a modified value, that value replaces the original and is passed to the next callback or to the core component.
- If the callback returns `undefined` or `null`, the original data passes through unchanged.
- If the callback returns a `Promise`, the pipeline awaits its resolution before proceeding. This enables pausing — for example, a callback that waits for human input returns a Promise that resolves when the input is provided.
- If the Promise rejects (or the callback throws synchronously), the pipeline aborts — see Error Handling below.

### 4.4 Execution Order

When multiple callbacks are registered for the same event, they execute in **registration order** (top to bottom), similar to middleware:

1. Callback A runs, optionally transforms the data.
2. Callback B receives the (potentially transformed) data from A, optionally transforms it further.
3. The final output is passed to the core component (for pre-events) or to the next stage (for post-events).

### 4.5 Error Handling

Callbacks can be registered as either bare functions or `EventRegistration` objects:

```typescript
interface EventRegistration<T = unknown> {
  handler: EventCallback<T>;
  continueOnError?: boolean;  // Default: false
}
```

- **`continueOnError: false`** (default): If the callback throws, the pipeline aborts.
- **`continueOnError: true`**: If the callback throws, the pipeline restores the data to its state before that callback ran and continues with the next callback.

### 4.6 Usage Scenarios

| Scenario | Event(s) | Approach |
|---|---|---|
| **Human-in-the-loop approval** | `postPlanner` | Callback presents the plan to a human, returns a Promise that resolves on approval. |
| **Plan safety filter** | `postPlanner` | Callback inspects and removes/modifies steps with restricted tools. |
| **Input enrichment** | `prePlanner` | Callback fetches additional context and appends it to the prompt. |
| **Data cleanup** | `postExecutor` | Callback sanitizes or normalizes executor results before evaluation. |
| **External logging** | `postEvaluator` | Callback sends the verdict to a monitoring system. |
| **Custom termination** | `postEvaluator` | Callback forces abort based on custom business rules. |
| **Step-level progress** | `preStep`, `postStep` | Callbacks emit real-time progress updates as each step starts and finishes. |
| **Step-level filtering** | `preStep` | Callback can inspect or modify individual steps before execution. |

---

## 5. Tool System

Tools are the mechanism by which the Executor interacts with the outside world. The pipeline is tool-agnostic — it relies on a **tool registry** where developers register the tools available for a given task.

### 5.1 Tool Definition

Every tool conforms to the `ToolDefinition` interface:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}
```

Tools are passed directly to the `Tepa` constructor as an array. The core package builds an internal registry from them. The `@tepa/tools` package also exports a standalone `ToolRegistryImpl` for programmatic use.

### 5.2 Tool Creation

The `defineTool` utility (from `@tepa/tools`) validates tool definitions at creation time using Zod schemas:

```typescript
import { defineTool } from "@tepa/tools";

const myTool = defineTool({
  name: "my_tool",
  description: "Does something useful",
  parameters: {
    input: { type: "string", description: "Input value", required: true },
  },
  execute: async ({ input }) => {
    return { result: `processed: ${input}` };
  },
});
```

### 5.3 Built-in Tools

The following tools are included in `@tepa/tools`:

**File System**

| Tool | Description |
|------|-------------|
| `file_read` | Read the contents of a file at a given path. Supports optional encoding parameter. |
| `file_write` | Write content to a file at a given path. Creates parent directories if needed. |
| `directory_list` | List files and subdirectories. Supports recursive traversal and configurable max depth. |
| `file_search` | Find files matching a glob pattern within a directory tree. |

**Process Execution**

| Tool | Description |
|------|-------------|
| `shell_execute` | Run a shell command, capturing stdout, stderr, and exit code. Supports configurable timeout and working directory. |

**Network**

| Tool | Description |
|------|-------------|
| `http_request` | Make an HTTP request (GET, POST, PUT, DELETE) with configurable URL, headers, query parameters, body, and timeout. |
| `web_search` | Perform a web search query via a configurable API endpoint. Returns results with titles, URLs, and snippets. |

**Data Processing**

| Tool | Description |
|------|-------------|
| `data_parse` | Parse structured data (JSON, CSV, YAML) from a string or file. Returns typed data structures. |

**Pipeline Internal**

| Tool | Description |
|------|-------------|
| `scratchpad` | Read or write to the pipeline's in-memory key-value scratchpad. Uses an `action` parameter (`"read"` or `"write"`) with `key` and optional `value`. |
| `log_observe` | Record an observation or reasoning note to the pipeline's execution log. Supports log levels. |

### 5.4 Third-Party Tools

Any npm package can be a Tepa tool. The contract is simple — export a `ToolDefinition` object:

```typescript
import type { ToolDefinition } from "@tepa/types";

export const postgresQuery: ToolDefinition = {
  name: "postgres_query",
  description: "Execute a SQL query against PostgreSQL",
  parameters: {
    query: { type: "string", description: "SQL query", required: true },
  },
  execute: async ({ query }) => {
    // implementation
  },
};
```

No plugin API needed — just import and pass to `Tepa`.

---

## 6. LLM Provider System

Tepa abstracts LLM communication through a provider interface, allowing the same pipeline to run against different LLM backends.

### 6.1 Provider Interface

All providers implement the `LLMProvider` interface:

```typescript
interface LLMProvider {
  complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>;
}

interface LLMRequestOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolSchema[];     // For native tool use
}

interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

interface LLMResponse {
  text: string;
  tokensUsed: { input: number; output: number };
  finishReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  toolUse?: LLMToolUseBlock[];   // Present when finishReason is "tool_use"
}

interface LLMToolUseBlock {
  id: string;                    // Provider-assigned tool call ID
  name: string;                  // Tool name
  input: Record<string, unknown>; // Parsed parameters
}
```

### 6.2 Base Provider (`@tepa/provider-core`)

All built-in providers extend `BaseLLMProvider`, which provides:

- **Retry logic**: Configurable max retries (default: 3) with exponential backoff (default base: 1000ms).
- **Rate limit handling**: Rate limit errors receive 30x longer backoff. Respects `retry-after` headers when available.
- **Error classification**: Providers implement `isRetryable()`, `isRateLimitError()`, and `getRetryAfterMs()` to classify errors.
- **File logging**: By default, all LLM requests/responses are logged to `.tepa/logs/llm-<timestamp>.jsonl` in JSONL format. Can be disabled via `defaultLog: false`.
- **Log callbacks**: Additional log listeners can be registered via `onLog()`.
- **Content inclusion**: Optionally include full message content in logs (disabled by default for privacy).

### 6.3 Built-in Providers

| Provider | Package | Default Model | Notes |
|----------|---------|---------------|-------|
| **Anthropic** | `@tepa/provider-anthropic` | `claude-haiku-4-5` | Uses `@anthropic-ai/sdk`. 15-minute timeout. |
| **OpenAI** | `@tepa/provider-openai` | `gpt-5-mini` | Uses OpenAI SDK Responses API. 15-minute timeout. |
| **Gemini** | `@tepa/provider-gemini` | `gemini-3-flash-preview` | Uses `@google/genai` SDK. Supports system instructions. |

---

## 7. Configuration

Configuration governs operational boundaries and behavioral parameters for the pipeline. It is provided at initialization time and remains constant for the duration of a pipeline run.

### 7.1 Configuration Structure

```typescript
interface TepaConfig {
  model: ModelConfig;
  limits: LimitsConfig;
  tools: string[];          // Reserved for future use
  logging: LoggingConfig;
}

interface ModelConfig {
  planner: string;          // Model for planning phase
  executor: string;         // Default model for step execution
  evaluator: string;        // Model for evaluation phase
}

interface LimitsConfig {
  maxCycles: number;        // Max pipeline cycles
  maxTokens: number;        // Total token budget across all cycles
  toolTimeout: number;      // Default timeout for tool executions (ms)
  retryAttempts: number;    // Retry count for transient errors
}

interface LoggingConfig {
  level: "minimal" | "standard" | "verbose";
  output?: string;          // Optional log file path
}
```

### 7.2 Default Values

```typescript
{
  model: {
    planner: "claude-sonnet-4-6",
    executor: "claude-haiku-4-5",
    evaluator: "claude-sonnet-4-6",
  },
  limits: {
    maxCycles: 5,
    maxTokens: 64_000,
    toolTimeout: 30_000,
    retryAttempts: 1,
  },
  tools: [],
  logging: { level: "standard" },
}
```

### 7.3 Partial Configuration

Callers provide a `DeepPartial<TepaConfig>` — only overriding fields they want to change. The `defineConfig()` function deep-merges the partial config with defaults and validates the result using a Zod schema. Invalid configuration throws `TepaConfigError`.

### 7.4 Logging Levels

| Level | Behavior |
|-------|----------|
| `minimal` | No console output |
| `standard` | Cycle/step/tool info (plan size, success rates, verdict) |
| `verbose` | Standard + durations and token counts |

### 7.5 Termination Conditions

The pipeline terminates when any of the following conditions are met:

1. The Evaluator issues a **pass** verdict → `status: "pass"`.
2. The **max cycle count** is reached → `status: "fail"`.
3. The **token budget** is exhausted (`TepaTokenBudgetExceeded`) → `status: "terminated"`.
4. An **unrecoverable `TepaError`** occurs → `status: "fail"`.

---

## 8. Prompt Structure

The prompt is the sole input from the caller. It is a structured `TepaPrompt` object validated at the start of every pipeline run.

### 8.1 TepaPrompt Interface

```typescript
interface TepaPrompt {
  goal: string;                              // What should be accomplished
  context: Record<string, unknown>;          // Supporting information (free-form)
  expectedOutput: string | ExpectedOutput[]; // Desired outputs
}

interface ExpectedOutput {
  path?: string;           // File path (for file outputs)
  description: string;     // What should be produced
  criteria?: string[];     // Acceptance criteria
}
```

### 8.2 Validation

- `goal` must be a non-empty string.
- `context` is a free-form object (any shape).
- `expectedOutput` can be either:
  - A single non-empty string describing the desired output.
  - An array of `ExpectedOutput` objects (at least one) for structured output specifications.
- Invalid prompts throw `TepaPromptError`.

### 8.3 Prompt File Loading

Prompts can be loaded from YAML or JSON files using `parsePromptFile()`. The format is auto-detected from the file extension (`.yaml`, `.yml`, `.json`).

---

## 9. Scratchpad

The scratchpad is an in-memory key-value store that persists across execution steps and cycles within a single pipeline run.

### 9.1 API

```typescript
class Scratchpad {
  read(key: string): unknown;
  has(key: string): boolean;
  write(key: string, value: unknown): void;
  entries(): Record<string, unknown>;
  clear(): void;
}
```

### 9.2 Behavior

- Persists across all steps and cycles within a single `run()` call.
- Reset between separate pipeline runs (each `run()` creates a fresh scratchpad).
- After each Executor cycle, an `_execution_summary` is automatically written to the scratchpad, providing the Planner with context for re-planning.
- Available to all components: Planner reads it for re-planning context, Executor passes it to step prompts, Evaluator receives it for assessment.
- Also accessible via the `scratchpad` tool, allowing steps to programmatically read/write values during execution.

---

## 10. Error Handling

Tepa defines a custom error hierarchy for structured error handling:

| Error Class | Purpose |
|-------------|---------|
| `TepaError` | Base class for all pipeline errors |
| `TepaConfigError` | Configuration validation failures |
| `TepaPromptError` | Prompt validation failures |
| `TepaToolError` | Tool-related errors |
| `TepaCycleError` | Pipeline execution errors (plan parsing, tool references, circular dependencies) |
| `TepaTokenBudgetExceeded` | Token limit exceeded (carries `tokensUsed` and `tokenBudget`) |

### 10.1 Token Tracking

The `TokenTracker` monitors cumulative token usage across all LLM calls (planning, execution, evaluation). When a token addition would exceed the budget, it throws `TepaTokenBudgetExceeded`. The pipeline catches this and returns a `TepaResult` with `status: "terminated"`.

### 10.2 LLM Parse Failures

Both the Planner and Evaluator implement a retry-once strategy for unparseable LLM responses:

1. First attempt: send the prompt, try to parse the response.
2. If parsing fails: send a follow-up message with the original response and a simplified prompt requesting valid JSON.
3. If the retry also fails: Planner throws `TepaCycleError`; Evaluator returns a synthetic fail result with `confidence: 0`.

---

## 11. Pipeline Result

Every pipeline run returns a `TepaResult`:

```typescript
interface TepaResult {
  status: "pass" | "fail" | "terminated";
  cycles: number;
  tokensUsed: number;
  outputs: OutputArtifact[];
  logs: LogEntry[];
  feedback: string;
}

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

## 12. Notes from v1 Worth Considering

The following items from the v1 requirements are not currently implemented but may be worth revisiting:

1. **Per-tool timeout overrides**: v1 specified that `toolTimeout` can be overridden per tool. The config has `toolTimeout` as a global default, but individual `ToolDefinition` objects don't have a timeout field. Adding an optional `timeout` to `ParameterDef` or `ToolDefinition` would allow tools like `shell_execute` to have longer timeouts than `file_read`.

2. **Tool-level retry policy**: v1 specified retrying failed tool invocations. The current `retryAttempts` config exists but retry logic only operates at the LLM provider level (retrying API calls), not at the tool execution level. A tool invocation that fails is immediately recorded as a step failure.

3. **Detailed termination reports**: v1 specified that on non-success termination, the pipeline should return "whatever partial results have been produced along with a report explaining why it stopped and what remained incomplete." The current implementation returns `status`, `feedback`, and `logs`, but doesn't explicitly enumerate what remained incomplete (e.g., which plan steps were never attempted).

4. **Planner cycle estimation**: v1 specified the Planner should "estimate resource usage (token budget, expected cycles)". The current Planner estimates tokens (`estimatedTokens`) but not expected cycles.

5. **OutputArtifact population**: The `TepaResult.outputs` array is typed as `OutputArtifact[]` but is currently always returned as an empty array `[]`. The pipeline doesn't extract structured output artifacts from execution results. This could be populated by inspecting step results that produce files or by having the Evaluator identify artifacts on pass.

6. **Separate `scratchpad_read` and `scratchpad_write` tools**: v1 specified these as two distinct tools. The current implementation uses a single `scratchpad` tool with an `action` parameter. The two-tool approach has clearer semantics and makes it easier for the Planner to reason about read vs. write operations.
