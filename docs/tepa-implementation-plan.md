# Tepa — Implementation Plan

> TypeScript implementation of the Tepa autonomous agent pipeline.

---

## 1. Project Setup

### Architecture Decision: Monorepo with Package Separation

The project uses an **npm workspaces monorepo** to separate the core pipeline engine from the tool implementations. This decision is driven by three concerns:

**Package size.** The core engine (`tepa`) should be lean — it contains the pipeline orchestrator, type system, config, LLM provider layer, and the tool registry interface. It does not ship any built-in tools. Developers install only the tool packages they need. This prevents bloat as the tool ecosystem grows (imagine a database tool pulling in `pg`, or an AWS tool pulling in `@aws-sdk/*` — none of that should be forced on users who only need file operations).

**External tool ecosystem.** Third-party developers can publish custom tools as standalone npm packages. A tool package simply exports one or more `ToolDefinition` objects conforming to the `@tepa/types` interface. No special wrapper, no plugin API, no runtime registration hooks — just import the tool and pass it to Tepa. The monorepo structure demonstrates this pattern clearly: `@tepa/tools` is itself just a consumer of the core types, exactly like any third-party tool package would be.

**Demo and validation.** The `demos/` workspace depends on the other packages as a real consumer would, serving as both living documentation and integration validation. It simulates the two scenarios from the requirements document.

### Repository Structure

```
tepa/
├── packages/
│   ├── tepa/                         # Core pipeline engine
│   │   ├── src/
│   │   │   ├── index.ts              # Public API exports
│   │   │   ├── tepa.ts               # Main Tepa class (orchestrator)
│   │   │   ├── core/
│   │   │   │   ├── planner.ts
│   │   │   │   ├── executor.ts
│   │   │   │   └── evaluator.ts
│   │   │   ├── config/
│   │   │   │   ├── define-config.ts
│   │   │   │   ├── defaults.ts
│   │   │   │   └── loader.ts
│   │   │   ├── events/
│   │   │   │   └── event-bus.ts       # Event runner: registration, ordering, execution
│   │   │   ├── prompt/
│   │   │   │   ├── parser.ts
│   │   │   │   └── validator.ts
│   │   │   ├── llm/
│   │   │   │   ├── provider.ts       # Abstract LLM provider interface
│   │   │   │   └── anthropic.ts      # Anthropic Claude provider
│   │   │   └── utils/
│   │   │       ├── logger.ts
│   │   │       ├── token-tracker.ts
│   │   │       └── errors.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   ├── package.json              # "tepa"
│   │   └── tsconfig.json
│   │
│   ├── types/                        # Shared type definitions
│   │   ├── src/
│   │   │   ├── index.ts              # All public types
│   │   │   ├── config.ts
│   │   │   ├── prompt.ts
│   │   │   ├── plan.ts
│   │   │   ├── execution.ts
│   │   │   ├── evaluation.ts
│   │   │   ├── tool.ts
│   │   │   ├── llm.ts
│   │   │   ├── event.ts
│   │   │   └── result.ts
│   │   ├── package.json              # "@tepa/types"
│   │   └── tsconfig.json
│   │
│   ├── tools/                        # Built-in tool collection
│   │   ├── src/
│   │   │   ├── index.ts              # Re-exports all built-in tools
│   │   │   ├── define-tool.ts        # defineTool helper
│   │   │   ├── registry.ts           # ToolRegistry class
│   │   │   ├── file-read.ts
│   │   │   ├── file-write.ts
│   │   │   ├── directory-list.ts
│   │   │   ├── file-search.ts
│   │   │   ├── shell-execute.ts
│   │   │   ├── http-request.ts
│   │   │   ├── web-search.ts
│   │   │   ├── data-parse.ts
│   │   │   ├── scratchpad.ts
│   │   │   └── log-observe.ts
│   │   ├── tests/
│   │   ├── package.json              # "@tepa/tools"
│   │   └── tsconfig.json
│   │
│   └── provider-anthropic/           # Anthropic LLM provider (optional)
│       ├── src/
│       │   ├── index.ts
│       │   └── anthropic.ts
│       ├── package.json              # "@tepa/provider-anthropic"
│       └── tsconfig.json
│
├── demos/
│   ├── api-client-gen/               # Scenario A: API client generation
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── prompts/
│   │   │   └── task.yaml
│   │   ├── my-project/               # Mock project directory
│   │   │   ├── src/
│   │   │   │   └── utils/
│   │   │   │       └── http.ts
│   │   │   ├── package.json
│   │   │   ├── tsconfig.json
│   │   │   └── vitest.config.ts
│   │   └── package.json
│   │
│   └── student-progress/             # Scenario B: Student learning insights
│       ├── src/
│       │   └── index.ts
│       ├── prompts/
│       │   └── task.yaml
│       ├── class-5b/                 # Mock data directory
│       │   ├── grades.csv
│       │   └── attendance.csv
│       └── package.json
│
├── package.json                      # Root workspace config
├── tsconfig.base.json                # Shared TypeScript config
├── vitest.workspace.ts               # Vitest workspace config
├── README.md
└── LICENSE
```

### Package Dependency Graph

```
@tepa/types              ← shared types, zero dependencies
    ↑
    ├── tepa              ← core engine, depends on @tepa/types
    ├── @tepa/tools       ← built-in tools, depends on @tepa/types
    └── @tepa/provider-anthropic  ← Anthropic provider, depends on @tepa/types
         ↑
         └── demos/*      ← depend on tepa + @tepa/tools + @tepa/provider-anthropic
```

The key insight: `@tepa/core` and `@tepa/tools` are **siblings**, not parent-child. They both depend on `@tepa/types` but not on each other. The core engine knows how to work with tools through the `ToolDefinition` interface, but it doesn't import any specific tool implementation. This means:

- A developer can use `@tepa/core` with only custom tools and never install `@tepa/tools`.
- A third-party tool package depends only on `@tepa/types` for the interface, not on the entire core engine.
- The `@tepa/provider-anthropic` package is also separate, so future providers (OpenAI, Gemini, Ollama) follow the same pattern without touching core.

### npm Packages

| Package | npm Name | Description |
|---------|----------|-------------|
| `packages/types` | `@tepa/types` | Shared TypeScript interfaces and type definitions. Zero runtime dependencies. |
| `packages/tepa` | `@tepa/core` | Core pipeline engine: Planner, Executor, Evaluator, orchestrator, config, prompt parsing. |
| `packages/tools` | `@tepa/tools` | Built-in tool collection + `defineTool` helper + `ToolRegistry` class. |
| `packages/provider-anthropic` | `@tepa/provider-anthropic` | Anthropic Claude LLM provider implementation. |
| `demos/api-client-gen` | *(not published)* | Demo: API client generation scenario. |
| `demos/student-progress` | *(not published)* | Demo: Student learning progress analysis scenario. |

### Developer Install Patterns

```bash
# Typical install — core + built-in tools + Anthropic
npm install @tepa/core @tepa/tools @tepa/provider-anthropic

# Minimal — core only, custom tools, custom provider
npm install @tepa/core

# Custom tool developer — only needs the types
npm install @tepa/types
```

### Toolchain

- **Runtime**: Node.js (>=18)
- **Language**: TypeScript 5.x with strict mode
- **Monorepo**: npm workspaces (native, no Lerna/Turborepo needed for MVP)
- **Build**: tsup per package (fast, zero-config bundler for TypeScript libraries)
- **Test**: Vitest with workspace support (`vitest.workspace.ts`)
- **Lint**: ESLint + Prettier (shared config at root)
- **Package**: Dual ESM/CJS output via tsup per package

### External Custom Tool Contract

Any npm package can be a Tepa tool. The contract is simple — export a `ToolDefinition` object:

```typescript
// Example: tepa-tool-postgres (third-party package)
import type { ToolDefinition } from "@tepa/types";

export const postgresQuery: ToolDefinition = {
  name: "postgres_query",
  description: "Execute a SQL query against a PostgreSQL database",
  parameters: {
    query: { type: "string", description: "SQL query", required: true },
    database: { type: "string", description: "Connection string", required: true },
  },
  execute: async ({ query, database }) => {
    // implementation using pg driver
  },
};
```

The consumer then registers it like any other tool:

```typescript
import { Tepa } from "tepa";
import { fileRead, shellExecute } from "@tepa/tools";
import { postgresQuery } from "tepa-tool-postgres";

const agent = new Tepa({
  tools: [fileRead, shellExecute, postgresQuery],
  events: {
    postPlanner: [
      async (plan, cycle) => {
        console.log(`Cycle ${cycle.cycleNumber}: plan ready with ${plan.steps.length} steps`);
        // return nothing — plan passes through unchanged
      },
    ],
  },
});
```

No special APIs, no plugin system. A tool is just an object that conforms to `ToolDefinition`. Events are just callbacks registered at initialization. This makes the ecosystem open by default.

---

## 2. Implementation Phases

### Phase 1 — Foundation (Shared Types & Core Config) `DONE`

> **Status:** Complete. All deliverables implemented, 44 tests passing. Both `@tepa/types` and `tepa` core packages build successfully (dual ESM/CJS).

Establish the shared type system (`@tepa/types`) and the core configuration layer (`tepa`) that everything else builds on.

**Deliverables:**

- `@tepa/types` package containing all shared TypeScript interfaces: `TepaConfig`, `TepaPrompt`, `PlanStep`, `ExecutionResult`, `EvaluationResult`, `ToolDefinition`, `ToolRegistry`, `LLMProvider`, `LLMResponse`, `TepaResult`, `EventName`, `EventCallback`, `EventRegistration`, `EventMap`, `CycleMetadata`. This package has zero runtime dependencies — it's types only.
- `tepa` core package scaffolding with `defineConfig` helper that accepts a partial config and merges with sensible defaults.
- Config defaults: max 5 cycles, 10,000 token budget, 30s tool timeout, standard logging.
- Config file loader supporting both YAML and JSON formats.
- Prompt type definitions and validation (goal, context, expectedOutput are required fields).
- Prompt file parser for YAML/JSON prompt files.
- Custom error types: `TepaConfigError`, `TepaPromptError`, `TepaToolError`, `TepaCycleError`, `TepaTokenBudgetExceeded`.
- Token tracking utility that accumulates usage across cycles and enforces the budget.
- Logger utility with configurable verbosity levels (minimal, standard, verbose).
- Root monorepo setup: `package.json` with workspaces, `tsconfig.base.json`, `vitest.workspace.ts`, shared lint config.

**Tests:**

- Config merging and validation.
- Prompt parsing and validation (valid prompts pass, malformed prompts throw).
- Token tracker accumulation and budget enforcement.

### Phase 2 — Tool System (`@tepa/tools`) `DONE`

Build the tool package as a separate workspace. This is implemented before the core components because the Planner and Executor depend on knowing what tools are available. Importantly, `@tepa/tools` depends only on `@tepa/types` — not on `tepa` core. This proves the separation works and validates that third-party tool packages can follow the exact same pattern.

**Deliverables:**

- `defineTool` function that accepts a tool schema (name, description, parameters, execute function) and returns a validated `ToolDefinition`.
- `ToolRegistry` class that stores registered tools and exposes them as a serializable schema list (for the Planner's LLM context).
- Input parameter validation before tool execution (type checking against the schema).
- Built-in tools, each implemented as a standalone module:

  **File System:**
  - `file_read` — Read file contents at a given path. Returns string content. Supports optional encoding parameter.
  - `file_write` — Write content to a file. Creates parent directories if they don't exist. Returns confirmation with bytes written.
  - `directory_list` — List files and directories at a path. Supports recursive flag and max depth. Returns structured tree.
  - `file_search` — Find files matching a glob pattern within a directory. Returns list of matching paths.

  **Process Execution:**
  - `shell_execute` — Run a shell command. Captures stdout, stderr, and exit code. Configurable timeout (defaults to config's tool_timeout) and working directory. Enforces output size limits to prevent memory issues.

  **Network:**
  - `http_request` — Make HTTP requests (GET, POST, PUT, DELETE). Configurable URL, headers, query params, and body. Returns status code, headers, and response body. Respects timeout.
  - `web_search` — Perform a web search query. Returns list of results with title, URL, and snippet. Implementation will wrap a configurable search API endpoint.

  **Data Processing:**
  - `data_parse` — Parse structured data from string or file. Supports JSON, CSV, and YAML. Returns parsed data structure. Supports preview mode (first N rows for large datasets).

  **Pipeline Internal:**
  - `scratchpad` — A single tool with `read` and `write` actions on an in-memory key-value store. The store persists across steps within a pipeline run but resets between runs.
  - `log_observe` — Record an observation string to the execution log. Used by the Executor to capture reasoning that doesn't produce a tool output.

**Tests:**

- `defineTool` validates schema correctly and rejects malformed definitions.
- `ToolRegistry` registers, retrieves, and lists tools. Produces correct serializable schema.
- Each built-in tool has unit tests with mocked I/O (file system, network, process).
- Parameter validation catches type mismatches and missing required fields.

### Phase 3 — LLM Provider Layer (`@tepa/provider-anthropic`) `DONE`

Abstract the LLM interaction into a separate provider package. The `tepa` core defines the `LLMProvider` interface (from `@tepa/types`), and `@tepa/provider-anthropic` implements it. This separation means future providers (OpenAI, Gemini, Ollama) are just new packages — no changes to core.

**Deliverables:**

- `LLMProvider` interface defining the contract: `complete(messages, options) → LLMResponse`. Options include model name, max tokens, temperature, and system prompt.
- `LLMResponse` type containing: generated text, token usage (input + output), and finish reason.
- `AnthropicProvider` implementation using the Anthropic SDK (`@anthropic-ai/sdk`). Handles message formatting, API calls, error handling, and rate limit retries.
- Provider factory function that creates the right provider from a config string (e.g., `"anthropic"` → `AnthropicProvider`).
- Message formatting utilities that convert internal representations to provider-specific formats.

**Tests:**

- Provider interface contract tests (can be run against any provider implementation).
- Anthropic provider tests with mocked API responses.
- Token usage correctly extracted and returned.
- Error handling for API failures, timeouts, and rate limits.

### Phase 4 — Core Components `DONE`

Implement the three pipeline components. This is the heart of Tepa.

**4a. Planner**

The Planner takes a prompt (or evaluator feedback) and produces a structured plan.

**Deliverables:**

- `Planner` class that accepts an LLM provider and tool registry.
- `plan(prompt, feedback?) → Plan` method. On first call, receives the full prompt. On subsequent calls, receives evaluator feedback along with the original prompt.
- System prompt engineering that instructs the LLM to: analyze the goal, break it into steps, assign tools to each step, estimate token usage, and output a structured plan.
- Plan output parsing: the LLM's response is parsed into a typed `Plan` object containing an ordered list of `PlanStep` items. Each step has: description, tool name(s), expected outcome, and dependencies.
- Revised plan mode: when feedback is provided, the system prompt instructs the LLM to produce a minimal fix rather than regenerating the full plan.
- Fallback handling: if the LLM produces an unparseable plan, retry once with a simplified prompt. If still unparseable, throw `TepaCycleError`.

**Tests:**

- Planner produces valid plan structure from a well-formed prompt (mocked LLM).
- Planner produces a minimal revised plan when given feedback.
- Planner handles malformed LLM output gracefully.
- Tool references in the plan are validated against the registry.

**4b. Executor**

The Executor takes a plan and executes each step.

**Deliverables:**

- `Executor` class that accepts a tool registry and LLM provider.
- `execute(plan) → ExecutionResult[]` method. Iterates through plan steps sequentially.
- For each step: resolves the tool from the registry, constructs parameters (using LLM if parameters need to be derived from context), invokes the tool, and captures the result.
- LLM reasoning steps: some plan steps may not require a tool (e.g., "generate recommendations based on accumulated data"). The Executor detects these and delegates to the LLM directly.
- Error handling per step: if a tool invocation fails, the error is captured as the step result (not thrown). The Evaluator decides what to do with failures.
- Scratchpad integration: the Executor maintains a scratchpad instance that persists across steps. Tools can read from and write to it.
- Execution log: every step records a log entry with timestamp, tool used, input summary, output summary, duration, and token usage.

**Tests:**

- Executor runs a multi-step plan with mocked tools and produces correct results.
- Failed tool invocations are captured gracefully, not thrown.
- LLM reasoning steps (no tool) are handled correctly.
- Scratchpad state persists across steps.
- Execution log is complete and accurate.

**4c. Evaluator**

The Evaluator inspects results and decides whether the pipeline should terminate or loop.

**Deliverables:**

- `Evaluator` class that accepts an LLM provider.
- `evaluate(prompt, executionResults, scratchpad) → EvaluationResult` method.
- System prompt engineering that instructs the LLM to: compare execution results against the expected output, check both structural criteria (files exist, correct format) and qualitative criteria (content is meaningful, recommendations are specific), and produce a verdict.
- `EvaluationResult` contains: verdict (`pass` | `fail`), confidence score (0-1), feedback string (on failure — specific, actionable description of what went wrong), and a summary (on pass — concise description of what was achieved).
- The Evaluator does not re-execute anything. It only inspects and judges.

**Tests:**

- Evaluator returns `pass` for complete, correct execution results.
- Evaluator returns `fail` with specific feedback for incomplete results.
- Evaluator returns `fail` when expected outputs are missing.
- Feedback is actionable and references specific steps.

### Phase 5 — Event System & Pipeline Orchestrator `DONE`

> **Status:** Complete. EventBus and Tepa orchestrator implemented, 30 new tests (14 EventBus + 16 Tepa). Total 220 tests passing across 27 test files. All packages build successfully (dual ESM/CJS).

Implement the event bus and wire everything together into the main `Tepa` class that runs the pipeline loop with event hooks at each stage.

**5a. Event Bus**

The event bus is the internal engine that manages event registration and execution. It lives in `packages/tepa/src/events/event-bus.ts`.

**Deliverables:**

- `EventBus` class that accepts an `EventMap` at construction time.
- `run(eventName, data, cycleMetadata) → data` method that executes all callbacks registered for a given event name, in registration order:
  1. For each callback, invoke it with the current data and cycle metadata.
  2. If the callback returns a value, that value replaces the current data for the next callback.
  3. If the callback returns `undefined`/`null`/`void`, the data passes through unchanged.
  4. If the callback returns a `Promise`, `await` it before proceeding.
  5. If the callback throws (or the Promise rejects):
     - If `continueOnError` is set on the registration, log the error and skip to the next callback, using the data as it was before this callback ran.
     - Otherwise, re-throw the error to abort the pipeline.
  6. Return the final (potentially transformed) data after all callbacks have run.
- Support both shorthand registration (bare function) and full registration (`{ handler, continueOnError }`). When a bare function is provided, treat it as `{ handler: fn, continueOnError: false }`.
- If no callbacks are registered for an event, `run()` returns the data unchanged (no-op passthrough).

**Tests:**

- Single callback transforms data and the transformed data is returned.
- Multiple callbacks execute in registration order, each receiving the output of the previous.
- Callback returning `undefined` passes data through unchanged.
- Async callbacks (returning Promises) are awaited correctly.
- Throwing callback aborts by default (error propagates).
- Throwing callback with `continueOnError: true` is skipped, data rolls back to pre-callback state.
- No registered callbacks returns data unchanged.
- Bare function and `{ handler, continueOnError }` forms both work.

**5b. Pipeline Orchestrator**

**Deliverables:**

- `Tepa` class constructor accepts: config (or uses defaults), tools (array of tool definitions or built-in names), events (optional `EventMap`), and optional LLM provider override.
- `run(prompt) → TepaResult` method that orchestrates the full cycle with event hooks:
  1. Validate prompt and config.
  2. Initialize the tool registry, scratchpad, token tracker, logger, and event bus.
  3. Enter the loop:
     - Fire `prePlanner` events with Planner input → receive (potentially transformed) input.
     - Call `Planner.plan()` with the input (with feedback on cycles > 1).
     - Fire `postPlanner` events with the generated plan → receive (potentially transformed) plan.
     - Fire `preExecutor` events with Executor input → receive (potentially transformed) input.
     - Call `Executor.execute()` with the plan.
     - Fire `postExecutor` events with Executor output → receive (potentially transformed) output.
     - Fire `preEvaluator` events with Evaluator input → receive (potentially transformed) input.
     - Call `Evaluator.evaluate()` with the results.
     - Fire `postEvaluator` events with Evaluator output → receive (potentially transformed) output.
     - If verdict is `pass`, break and return success.
     - If verdict is `fail`, check termination conditions (max cycles, token budget).
     - If within limits, feed evaluator feedback back to the Planner and continue.
     - If limits exceeded, break and return failure with partial results.
     - If any event callback throws (without `continueOnError`), the pipeline aborts with an error report.
  4. Assemble and return `TepaResult`.
- `TepaResult` contains: status (`pass` | `fail` | `terminated`), cycles used, tokens consumed, outputs (list of files or artifacts produced), execution logs, and evaluator's final feedback/summary.
- `CycleMetadata` is constructed at the start of each cycle and passed to every event callback within that cycle, containing the current cycle number, total cycles used so far, and tokens consumed so far.

**Tests:**

- Full pipeline runs to completion with mocked LLM and tools (happy path, no events).
- Pipeline self-corrects: cycle 1 fails, cycle 2 succeeds.
- Pipeline terminates on max cycles with partial results.
- Pipeline terminates on token budget exhaustion.
- Pre-events can transform component inputs (e.g., `prePlanner` modifies the prompt, and the Planner receives the modified version).
- Post-events can transform component outputs (e.g., `postPlanner` modifies the plan, and the Executor receives the modified version).
- Async event callbacks pause the pipeline until resolved.
- Event callback rejection aborts the pipeline with an error report.
- Event callbacks with `continueOnError: true` are skipped on failure without aborting.
- All events receive correct `CycleMetadata` on each cycle.
- Token usage is accurately accumulated across all components and cycles.

### Phase 6 — Demos, Integration Testing & Documentation `DONE`

> **Status:** Complete. Both demos implemented with mock data and YAML prompts. 10 integration tests added. READMEs for root and all 4 packages. JSDoc on all public APIs. Total 230 tests passing across 28 test files.

**Deliverables:**

- **Demo A: API Client Generation** (`demos/api-client-gen/`). A fully working demo that simulates the Scenario A from the requirements document. It includes a mock project directory with existing code, a YAML prompt file, and an entry script that runs Tepa end-to-end. The demo generates a typed API client, runs tests, and self-corrects if tests fail. This workspace depends on `tepa`, `@tepa/tools`, and `@tepa/provider-anthropic` as a real consumer would.

- **Demo B: Student Progress Insights** (`demos/student-progress/`). A fully working demo that simulates Scenario B. It includes mock CSV data files (grades and attendance), a YAML prompt file, and an entry script that runs Tepa to produce an analysis report and flagged students CSV.

- Both demos serve as living documentation — developers can clone the repo, run the demos, and see exactly how Tepa works in practice.

- End-to-end integration tests using real (or realistically mocked) LLM calls, leveraging the demo setups.

- Comprehensive README.md at the root with: project overview, monorepo structure, quick start, installation patterns (full vs minimal vs custom-tool-only).

- Per-package README.md files with: API reference, usage examples, and configuration guide.

- JSDoc comments on all public APIs across all packages.

- Published npm packages with proper types, ESM/CJS dual output, and clean exports.

---

## 3. Type System Overview (`@tepa/types`)

The following are the key types that form the public contract of Tepa. They live in the `@tepa/types` package and are consumed by all other packages. These will be refined during implementation but represent the intended shape.

```typescript
// --- Prompt ---
interface TepaPrompt {
  goal: string;
  context: Record<string, unknown>;
  expectedOutput: string | ExpectedOutput[];
}

interface ExpectedOutput {
  path?: string;
  description: string;
  criteria?: string[];
}

// --- Config ---
interface TepaConfig {
  model: ModelConfig;
  limits: LimitsConfig;
  tools: string[] | ToolDefinition[];
  logging: LoggingConfig;
}

interface ModelConfig {
  planner: string;
  executor: string;
  evaluator: string;
}

interface LimitsConfig {
  maxCycles: number;
  maxTokens: number;
  toolTimeout: number;     // milliseconds
  retryAttempts: number;
}

interface LoggingConfig {
  level: "minimal" | "standard" | "verbose";
  output?: string;         // directory path for log files
}

// --- Plan ---
interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}

interface PlanStep {
  id: string;
  description: string;
  tools: string[];
  expectedOutcome: string;
  dependencies: string[];  // IDs of steps this depends on
}

// --- Execution ---
interface ExecutionResult {
  stepId: string;
  status: "success" | "failure";
  output: unknown;
  error?: string;
  tokensUsed: number;
  durationMs: number;
}

// --- Evaluation ---
interface EvaluationResult {
  verdict: "pass" | "fail";
  confidence: number;
  feedback?: string;       // on failure
  summary?: string;        // on pass
  tokensUsed: number;
}

// --- Final Result ---
interface TepaResult {
  status: "pass" | "fail" | "terminated";
  cycles: number;
  tokensUsed: number;
  outputs: OutputArtifact[];
  logs: LogEntry[];
  feedback: string;
}

// --- Tools ---
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

// --- Events ---
type EventName =
  | "prePlanner"
  | "postPlanner"
  | "preExecutor"
  | "postExecutor"
  | "preEvaluator"
  | "postEvaluator";

interface CycleMetadata {
  cycleNumber: number;         // current cycle (1-based)
  totalCyclesUsed: number;     // total cycles completed so far
  tokensUsed: number;          // tokens consumed so far
}

type EventCallback<TData = unknown> = (
  data: TData,
  cycle: CycleMetadata
) => TData | void | Promise<TData | void>;

interface EventRegistration<TData = unknown> {
  handler: EventCallback<TData>;
  continueOnError?: boolean;   // default: false (abort on throw)
}

type EventMap = {
  [K in EventName]?: Array<EventCallback | EventRegistration>;
};
```

---

## 4. MVP Acceptance Criteria

The MVP is considered complete when all of the following are satisfied:

### Functional Requirements

1. **Pipeline completes autonomously by default.** Given a well-formed prompt with a goal, context, and expected output, Tepa runs the full Planner → Executor → Evaluator cycle and returns a `TepaResult`. With no events registered, the pipeline operates without human intervention.

2. **Self-correction works.** When the Evaluator issues a `fail` verdict, the pipeline feeds the feedback back to the Planner, which produces a revised plan. The Executor re-executes and the Evaluator re-evaluates. This loop continues until `pass` or termination.

3. **Termination conditions are enforced.** The pipeline stops when: (a) the Evaluator passes, (b) the max cycle count is reached, (c) the token budget is exhausted, or (d) an event callback aborts the pipeline. In cases (b), (c), and (d), partial results and a failure report are returned.

4. **All 10 built-in tools function correctly.** Each tool (file_read, file_write, directory_list, file_search, shell_execute, http_request, web_search, data_parse, scratchpad, log_observe) executes successfully with valid inputs and returns structured output.

5. **Custom tools can be registered.** A developer can define a custom tool using `defineTool` with a name, description, typed parameters, and an execute function. The custom tool is available to the Planner and Executor alongside built-in tools.

6. **Configuration is flexible.** Different LLM models can be assigned to each component (Planner, Executor, Evaluator). Token budget, max cycles, tool timeout, and logging level are all configurable. Defaults work out of the box with zero configuration.

7. **The LLM provider layer supports Anthropic Claude.** The Anthropic provider handles message formatting, API calls, token tracking, and error handling. The provider interface is abstract enough to support future providers.

8. **Prompt files are supported.** Prompts can be passed programmatically as objects or loaded from YAML/JSON files.

9. **Event system works.** Callers can register event callbacks (`prePlanner`, `postPlanner`, `preExecutor`, `postExecutor`, `preEvaluator`, `postEvaluator`) at initialization time. Pre-event callbacks can transform component inputs, post-event callbacks can transform component outputs. Async callbacks pause the pipeline until resolved. Throwing callbacks abort the pipeline unless `continueOnError` is set. Multiple callbacks on the same event execute in registration order, each receiving the output of the previous.

### Non-Functional Requirements

10. **Type safety.** All public APIs are fully typed. No `any` types in the public surface. Internal types may use `unknown` where appropriate. The `@tepa/types` package is the single source of truth for all shared interfaces.

11. **Test coverage.** Unit tests cover all core components (Planner, Executor, Evaluator, EventBus, ToolRegistry, TokenTracker). Integration tests verify the full pipeline cycle. Minimum 80% code coverage across all packages.

12. **Error handling.** All failure modes produce meaningful error messages. Tool failures don't crash the pipeline. LLM parsing failures are retried once before failing. Budget exhaustion is reported with partial results. Event callback errors abort by default or are skipped with `continueOnError`.

13. **Package quality.** Each npm package ships with: TypeScript declarations, dual ESM/CJS output, clean export map, no unnecessary dependencies, and a per-package README. The core `tepa` package has no dependency on `@anthropic-ai/sdk` or any specific tool implementation.

14. **Execution logs are available.** Every pipeline run produces a structured log containing: each cycle's plan, step-by-step execution details (tool, input summary, output summary, duration), evaluator verdicts, event execution records, and cumulative token usage.

### Architectural Requirements

15. **Package separation is real.** `tepa` (core) and `@tepa/tools` do not depend on each other. Both depend only on `@tepa/types`. Removing `@tepa/tools` from node_modules does not break `tepa` core. This is verified by a build test.

16. **Third-party tool contract works.** A tool defined outside the monorepo (or in a standalone test file) using only `@tepa/types` can be registered with Tepa and executed by the pipeline without any changes to core.

17. **Monorepo is functional.** `npm install` at the root resolves all workspace dependencies. `npm run build` builds all packages in the correct order. `npm run test` runs tests across all workspaces. The demos run successfully as workspace consumers.

### Validation Scenarios

18. **Demo A passes.** The `demos/api-client-gen` workspace runs to completion — the agent explores a project, generates typed code, runs tests, self-corrects if tests fail, and finishes with all tests passing. The demo can be executed with a single command from the repo root.

19. **Demo B passes.** The `demos/student-progress` workspace runs to completion — the agent reads CSV data, computes metrics, generates a report, and produces flagged results. The demo can be executed with a single command from the repo root.

---

## 5. Dependencies

Dependencies are scoped per package to keep each one lean.

### `@tepa/types`
- *(zero runtime dependencies — types only)*

### `tepa` (core)
- `@tepa/types` — shared type definitions
- `yaml` — YAML parsing for config and prompt files
- `zod` — runtime schema validation for configs and prompts

### `@tepa/tools`
- `@tepa/types` — shared type definitions
- `zod` — runtime parameter validation for tool inputs
- `glob` — file pattern matching for the file_search tool

### `@tepa/provider-anthropic`
- `@tepa/types` — shared type definitions
- `@anthropic-ai/sdk` — Anthropic API client

### Root dev dependencies (shared)
- `typescript`, `tsup`, `vitest`, `eslint`, `prettier`

The dependency footprint is intentionally minimal per package. A developer who installs only `tepa` gets zero transitive dependencies beyond `yaml` and `zod`. Heavy dependencies like `@anthropic-ai/sdk` are isolated in their respective provider package.

---

## 6. Future Iterations

The following improvements are out of scope for the MVP but represent the planned evolution of Tepa.

### CLI Tool (`@tepa/cli`)

A standalone CLI package in the monorepo (`packages/cli/`) that allows developers to run Tepa from the terminal without writing code. Key commands: `tepa run`, `tepa init`, `tepa plan` (dry run), `tepa tools list`, `tepa logs`, and `tepa replay`. The CLI would parse YAML prompt files and config files, making Tepa accessible to non-TypeScript workflows. Built with a library like `citty` or `commander`. The monorepo structure already accommodates this as a new workspace.

### Additional LLM Providers

Support for OpenAI (`@tepa/provider-openai`), Google Gemini (`@tepa/provider-gemini`), Mistral (`@tepa/provider-mistral`), and local models (`@tepa/provider-ollama`). The `@tepa/provider-anthropic` package already demonstrates the pattern — each new provider is a new workspace implementing the `LLMProvider` interface from `@tepa/types`. A provider auto-detection feature could select the right provider based on the model string.

### Parallel Step Execution

The current MVP executes plan steps sequentially. Future versions could allow the Planner to mark steps as parallelizable (no dependencies between them), and the Executor would run them concurrently. This would significantly speed up plans with independent steps like "read file A" and "read file B."

### Streaming and Real-Time Output

Support streaming LLM responses and real-time progress reporting. The Event System in the MVP already enables callers to observe pipeline progress (e.g., registering `postPlanner` or `postExecutor` callbacks to emit updates), but a full streaming API would allow UIs to show the pipeline working in real time, step by step — including token-level LLM output streaming.

### Persistent Memory Across Runs

Allow Tepa to remember context from previous runs. For example, if a developer runs Tepa twice on the same project, the second run could benefit from knowing what the first run learned about the project's structure and code style. This would be implemented as a persistent scratchpad that survives across runs.

### Multi-Agent Coordination

Allow multiple Tepa instances to collaborate on different parts of a larger task. A coordinator agent would break a high-level goal into sub-goals, dispatch them to individual Tepa pipelines, and merge the results. This builds naturally on the single-agent architecture.

### Plan Visualization

A web-based or terminal UI that visualizes the pipeline's execution: the plan as a directed graph, step-by-step progress, evaluator feedback, and cycle history. Useful for debugging and understanding agent behavior.

### Plugin Ecosystem via npm

The monorepo architecture already establishes the pattern for external packages — any npm package exporting `ToolDefinition` objects is a valid tool plugin. Future work here is about ecosystem growth, not architecture changes: publishing tool pack templates, a `create-tepa-tool` scaffolder, a community tool registry, and conventions for tool naming (`tepa-tool-*`). Similarly, custom evaluators and planners could follow the same pattern: export an object conforming to the interface, register it with Tepa.

### Cost Estimation and Budgeting

Before running a pipeline, estimate the likely cost based on the model pricing, estimated token usage, and number of expected cycles. Allow setting a dollar-amount budget instead of (or in addition to) a token budget.

### Conversation Mode

An interactive mode where Tepa pauses after each cycle and asks the developer for feedback before continuing. Useful for sensitive tasks where full autonomy isn't desired, or for teaching the pipeline about domain-specific constraints. The MVP's Event System already makes basic human-in-the-loop workflows possible (e.g., a `postPlanner` callback that awaits human approval before execution proceeds). A future Conversation Mode would build on this with a higher-level API: a pre-built set of event callbacks, a standardized prompt/response interface, and integration with CLI or web-based input channels — so developers get interactive mode out of the box without wiring up custom callbacks.

### Advanced Event Features

The MVP Event System is intentionally minimal. Future iterations could introduce: conditional event execution (fire only on certain cycles or verdicts without caller-side branching), event priority/weighting (beyond simple registration order), event timeouts (auto-abort if an async callback doesn't resolve within a limit), and an event replay/audit log (record all transformations applied by events for debugging and reproducibility).
