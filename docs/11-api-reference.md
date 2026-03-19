# API Reference

Complete reference for every public type, class, function, and constant exported by the Tepa framework. Organized by package, then alphabetically within each section.

**Packages covered:**
[`@tepa/core`](#tepacore) | [`@tepa/types`](#tepatypes) | [`@tepa/tools`](#tepatools) | [`@tepa/provider-core`](#tepaprovider-core) | [`@tepa/provider-anthropic`](#tepaprovider-anthropic) | [`@tepa/provider-openai`](#tepaprovider-openai) | [`@tepa/provider-gemini`](#tepaprovider-gemini)

---

## `@tepa/core`

The main orchestration package. Provides the `Tepa` class, configuration utilities, prompt parsing, the event bus, and all error classes.

### `Tepa`

The top-level pipeline orchestrator. Runs the Plan-Execute-Evaluate loop until the evaluator passes, limits are reached, or an error occurs.

```typescript
import { Tepa } from "@tepa/core";
```

#### Constructor

```typescript
new Tepa(options: TepaOptions)
```

| Parameter          | Type                                  | Description                                   |
| ------------------ | ------------------------------------- | --------------------------------------------- |
| `options.provider` | [`LLMProvider`](#llmprovider)         | LLM provider used by all pipeline components  |
| `options.tools`    | [`ToolDefinition[]`](#tooldefinition) | Tools available to the Planner and Executor   |
| `options.config`   | `DeepPartial<TepaConfig>`             | Optional partial config, merged with defaults |
| `options.events`   | [`EventMap`](#eventmap)               | Optional event hook callbacks                 |

#### `run()`

```typescript
async run(promptInput: TepaPrompt): Promise<TepaResult>
```

Executes the full pipeline loop. Returns a structured result — never throws `TepaError` subclasses (they are caught and returned as `{ status: "fail" }`). Other errors propagate.

| Return status  | Condition                                         |
| -------------- | ------------------------------------------------- |
| `"pass"`       | Evaluator returned `verdict: "pass"`              |
| `"fail"`       | Max cycles exhausted or unrecoverable `TepaError` |
| `"terminated"` | Token budget exceeded (`TepaTokenBudgetExceeded`) |

---

### `TepaOptions`

```typescript
interface TepaOptions {
  config?: DeepPartial<TepaConfig>;
  tools: ToolDefinition[];
  provider: LLMProvider;
  events?: EventMap;
}
```

---

### `defineConfig()`

```typescript
import { defineConfig } from "@tepa/core";

function defineConfig(partial?: DeepPartial<TepaConfig>): TepaConfig;
```

Deep-merges a partial configuration object with [`DEFAULT_CONFIG`](#default_config) and validates the result with Zod. Throws [`TepaConfigError`](#tepaconfigerror) if the merged config is invalid.

---

### `DEFAULT_CONFIG`

```typescript
import { DEFAULT_CONFIG } from "@tepa/core";
```

```typescript
const DEFAULT_CONFIG: TepaConfig = {
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
  logging: {
    level: "standard",
  },
};
```

---

### `loadConfig()`

```typescript
import { loadConfig } from "@tepa/core";

async function loadConfig(filePath: string): Promise<TepaConfig>;
```

Reads a `.yaml`, `.yml`, or `.json` file, parses it, and passes it through `defineConfig()`. Throws [`TepaConfigError`](#tepaconfigerror) on read/parse failure or unsupported format.

---

### `resolveModelCatalog()`

```typescript
import { resolveModelCatalog } from "@tepa/core";

function resolveModelCatalog(providerModels: ModelInfo[], modelConfig: ModelConfig): ModelInfo[];
```

Filters the provider's model catalog based on `modelConfig.allowedModels`. Validates that `planner`, `executor`, and `evaluator` model IDs exist in the catalog. Auto-includes the `executor` model. Throws [`TepaConfigError`](#tepaconfigerror) on invalid model references. Called internally by `Tepa.run()` but exported for programmatic use.

---

### `parsePromptFile()`

```typescript
import { parsePromptFile } from "@tepa/core";

async function parsePromptFile(filePath: string): Promise<TepaPrompt>;
```

Loads and validates a prompt from a YAML or JSON file. Throws [`TepaPromptError`](#tepaprompterror) on failure.

---

### `validatePrompt()`

```typescript
import { validatePrompt } from "@tepa/core";

function validatePrompt(data: unknown): TepaPrompt;
```

Validates that `data` conforms to the [`TepaPrompt`](#tepaprompt) structure. Returns the validated prompt or throws [`TepaPromptError`](#tepaprompterror).

---

### `EventBus`

```typescript
import { EventBus } from "@tepa/core";
```

Manages event callback registration and execution. Callbacks run in registration order; each can transform the data passed to the next.

#### Constructor

```typescript
new EventBus(events?: EventMap)
```

#### `run()`

```typescript
async run<T>(eventName: EventName, data: T, cycle: CycleMetadata): Promise<T>
```

Executes all callbacks registered for `eventName`, passing `data` through each handler in sequence. If a handler returns a non-null/non-undefined value, it replaces `data` for subsequent handlers. Returns the final (potentially transformed) data.

Error behavior depends on the registration:

- `EventCallback` (bare function): errors propagate immediately
- `EventRegistration` with `continueOnError: true`: errors are swallowed, pre-error data is preserved

---

### `Scratchpad`

```typescript
import { Scratchpad } from "@tepa/core";
```

In-memory key-value store that persists across execution steps within a pipeline run.

| Method    | Signature                                  | Description            |
| --------- | ------------------------------------------ | ---------------------- |
| `read`    | `read(key: string): unknown`               | Get a value by key     |
| `has`     | `has(key: string): boolean`                | Check if a key exists  |
| `write`   | `write(key: string, value: unknown): void` | Set a key-value pair   |
| `entries` | `entries(): Record<string, unknown>`       | Get all stored entries |
| `clear`   | `clear(): void`                            | Remove all entries     |

---

### `TokenTracker`

```typescript
import { TokenTracker } from "@tepa/core";
```

Tracks token usage against a budget.

| Method         | Signature                          | Description                                                                                 |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `constructor`  | `new TokenTracker(budget: number)` | Create tracker with a token budget                                                          |
| `add`          | `add(tokens: number): void`        | Add tokens. Throws [`TepaTokenBudgetExceeded`](#tepatokenbudgetexceeded) if budget exceeded |
| `getUsed`      | `getUsed(): number`                | Total tokens consumed so far                                                                |
| `getBudget`    | `getBudget(): number`              | The configured budget                                                                       |
| `getRemaining` | `getRemaining(): number`           | `Math.max(0, budget - used)`                                                                |
| `isExhausted`  | `isExhausted(): boolean`           | `true` if `used >= budget`                                                                  |

---

### `Logger`

```typescript
import { Logger } from "@tepa/core";
```

#### Constructor

```typescript
new Logger(config: LoggingConfig)
```

#### `log()`

```typescript
log(entry: Omit<LogEntry, "timestamp">): void
```

Records an entry and optionally prints to console based on the configured level:

| Level        | Console output                                |
| ------------ | --------------------------------------------- |
| `"minimal"`  | None — entries are stored only                |
| `"standard"` | `[cycle N][step X](tool) message`             |
| `"verbose"`  | Standard format plus duration and token count |

#### `getEntries()`

```typescript
getEntries(): LogEntry[]
```

Returns all recorded log entries.

---

### `Planner`

```typescript
import { Planner } from "@tepa/core";
```

#### Constructor

```typescript
new Planner(
  provider: LLMProvider,
  registry: ToolRegistry,
  model: string,
  modelCatalog: ModelInfo[],
  defaultModelId: string
)
```

#### `plan()`

```typescript
async plan(
  prompt: TepaPrompt,
  feedback?: string,
  scratchpad?: Scratchpad
): Promise<{ plan: Plan; tokensUsed: number }>
```

Generates a plan from a prompt, optionally incorporating evaluator feedback and scratchpad state. Retries once with a simplified prompt on parse failure. Throws [`TepaCycleError`](#tepacycleerror) if both attempts fail.

---

### `Executor`

```typescript
import { Executor } from "@tepa/core";
```

#### Constructor

```typescript
new Executor(
  registry: ToolRegistry,
  provider: LLMProvider,
  model: string
)
```

#### `execute()`

```typescript
async execute(
  plan: Plan,
  context: ExecutionContext,
  eventBus?: EventBus,
  cycleMeta?: CycleMetadata
): Promise<ExecutorOutput>
```

Executes a plan step-by-step. Steps are topologically sorted by dependencies using Kahn's algorithm. Throws [`TepaCycleError`](#tepacycleerror) on circular dependencies.

---

### `ExecutionContext`

```typescript
interface ExecutionContext {
  prompt: TepaPrompt;
  cycle: number;
  scratchpad: Scratchpad;
  previousResults?: ExecutionResult[];
}
```

| Field             | Description                                   |
| ----------------- | --------------------------------------------- |
| `prompt`          | The original prompt driving this pipeline run |
| `cycle`           | Current cycle number (1-based)                |
| `scratchpad`      | Shared scratchpad persisting across steps     |
| `previousResults` | Results from previous cycles, if any          |

---

### `ExecutorOutput`

```typescript
interface ExecutorOutput {
  results: ExecutionResult[];
  logs: LogEntry[];
  tokensUsed: number;
}
```

---

### `Evaluator`

```typescript
import { Evaluator } from "@tepa/core";
```

#### Constructor

```typescript
new Evaluator(provider: LLMProvider, model: string)
```

#### `evaluate()`

```typescript
async evaluate(
  prompt: TepaPrompt,
  executionResults: ExecutionResult[],
  scratchpad: Scratchpad
): Promise<EvaluationResult>
```

Evaluates execution results against the prompt's expected output. Retries once on parse failure. Returns a synthetic fail (`confidence: 0`) if both attempts fail.

---

### Event Input Types

These types describe the data passed to event callbacks at each lifecycle point.

#### `PlannerInput`

```typescript
interface PlannerInput {
  prompt: TepaPrompt;
  feedback?: string;
}
```

Passed to `prePlanner` / `postPlanner` callbacks.

#### `ExecutorInput`

```typescript
interface ExecutorInput {
  plan: Plan;
  prompt: TepaPrompt;
  cycle: number;
  scratchpad: Scratchpad;
  previousResults?: ExecutionResult[];
}
```

Passed to `preExecutor` / `postExecutor` callbacks.

#### `EvaluatorInput`

```typescript
interface EvaluatorInput {
  prompt: TepaPrompt;
  results: ExecutionResult[];
  scratchpad: Scratchpad;
}
```

Passed to `preEvaluator` / `postEvaluator` callbacks.

---

### Error Classes

All errors extend `Error` and set their `name` property for easy identification in `catch` blocks.

#### `TepaError`

```typescript
class TepaError extends Error {
  constructor(message: string);
}
```

Base error for all Tepa-specific errors.

#### `TepaConfigError`

```typescript
class TepaConfigError extends TepaError {
  constructor(message: string);
}
```

Thrown by `defineConfig()` and `loadConfig()` when configuration is invalid.

#### `TepaPromptError`

```typescript
class TepaPromptError extends TepaError {
  constructor(message: string);
}
```

Thrown by `validatePrompt()` and `parsePromptFile()` when prompt data is malformed.

#### `TepaToolError`

```typescript
class TepaToolError extends TepaError {
  constructor(message: string);
}
```

Thrown when tool registration or execution fails.

#### `TepaCycleError`

```typescript
class TepaCycleError extends TepaError {
  constructor(message: string);
}
```

Thrown on pipeline cycle failures such as plan parse errors or circular dependencies.

#### `TepaTokenBudgetExceeded`

```typescript
class TepaTokenBudgetExceeded extends TepaError {
  public readonly tokensUsed: number;
  public readonly tokenBudget: number;

  constructor(tokensUsed: number, tokenBudget: number);
  // message: "Token budget exceeded: used {tokensUsed} of {tokenBudget} tokens"
}
```

Thrown by `TokenTracker.add()` when accumulated usage exceeds the budget. Caught by `Tepa.run()` and returned as `{ status: "terminated" }`.

---

## `@tepa/types`

Pure type definitions shared across all Tepa packages. No runtime code — import freely without adding bundle weight.

```typescript
import type { TepaConfig, TepaPrompt, Plan, ... } from "@tepa/types";
```

### Config Types

#### `TepaConfig`

```typescript
interface TepaConfig {
  model: ModelConfig;
  limits: LimitsConfig;
  tools: string[];
  logging: LoggingConfig;
}
```

#### `ModelConfig`

```typescript
interface ModelConfig {
  planner: string;
  executor: string;
  evaluator: string;
  allowedModels?: string[];
}
```

Assigns a model identifier to each pipeline component. Values are provider-specific model strings (e.g., `"claude-sonnet-4-6"`, `"gpt-5-mini"`). The optional `allowedModels` whitelist constrains which models the Planner can assign to individual steps — see [Configuration — Model Catalog and Allowed Models](./05-configuration.md#model-catalog-and-allowed-models).

#### `ModelInfo`

```typescript
interface ModelInfo {
  id: string;
  description: string;
  tier: "fast" | "balanced" | "advanced";
  capabilities?: string[];
}
```

Metadata describing a model available from a provider. Returned by `LLMProvider.getModels()` and rendered in the Planner's system prompt to guide per-step model selection.

#### `LimitsConfig`

```typescript
interface LimitsConfig {
  maxCycles: number;
  maxTokens: number;
  toolTimeout: number;
  retryAttempts: number;
}
```

| Field           | Default | Description                                                    |
| --------------- | ------- | -------------------------------------------------------------- |
| `maxCycles`     | `5`     | Maximum Plan-Execute-Evaluate cycles before returning `"fail"` |
| `maxTokens`     | `64000` | Total token budget across all LLM calls                        |
| `toolTimeout`   | `30000` | Timeout per tool execution in milliseconds                     |
| `retryAttempts` | `1`     | Number of retries on parse failures (planner/evaluator)        |

#### `LoggingConfig`

```typescript
interface LoggingConfig {
  level: "minimal" | "standard" | "verbose";
  output?: string;
}
```

#### `DeepPartial<T>`

```typescript
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
```

Recursively makes all properties optional. Used by `defineConfig()` so you only need to specify overrides.

---

### Prompt Types

#### `TepaPrompt`

```typescript
interface TepaPrompt {
  goal: string;
  context: Record<string, unknown>;
  expectedOutput: string | ExpectedOutput[];
}
```

| Field            | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `goal`           | What the pipeline should accomplish                                   |
| `context`        | Arbitrary key-value data available to all pipeline components         |
| `expectedOutput` | Criteria for the evaluator — a string description or structured array |

#### `ExpectedOutput`

```typescript
interface ExpectedOutput {
  path?: string;
  description: string;
  criteria?: string[];
}
```

| Field         | Description                                         |
| ------------- | --------------------------------------------------- |
| `path`        | Optional file path or artifact location             |
| `description` | What this output should contain                     |
| `criteria`    | Specific quality checks the evaluator should verify |

---

### Plan Types

#### `Plan`

```typescript
interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}
```

#### `PlanStep`

```typescript
interface PlanStep {
  id: string;
  description: string;
  tools: string[];
  expectedOutcome: string;
  dependencies: string[];
  model?: string;
}
```

| Field             | Description                                                                  |
| ----------------- | ---------------------------------------------------------------------------- |
| `id`              | Unique step identifier                                                       |
| `description`     | What this step does                                                          |
| `tools`           | Tool names to invoke. Empty array = reasoning step (pure LLM text)           |
| `expectedOutcome` | What success looks like for this step                                        |
| `dependencies`    | IDs of steps that must complete first                                        |
| `model`           | Optional model override for this step. Falls back to `config.model.executor` |

---

### Execution Types

#### `ExecutionResult`

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

---

### Evaluation Types

#### `EvaluationResult`

```typescript
interface EvaluationResult {
  verdict: "pass" | "fail";
  confidence: number;
  feedback?: string;
  summary?: string;
  tokensUsed: number;
}
```

| Field        | Description                                                   |
| ------------ | ------------------------------------------------------------- |
| `verdict`    | `"pass"` ends the pipeline; `"fail"` triggers re-planning     |
| `confidence` | `0`–`1` score indicating evaluator certainty                  |
| `feedback`   | On `"fail"`, guidance fed back to the Planner for re-planning |
| `summary`    | On `"pass"`, human-readable summary of what was accomplished  |

---

### Tool Types

#### `ToolDefinition`

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}
```

#### `ParameterDef`

```typescript
interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}
```

#### `ToolRegistry`

```typescript
interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  toSchema(): ToolSchema[];
}
```

#### `ToolSchema`

```typescript
interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
}
```

The read-only subset of `ToolDefinition` (without `execute`) sent to LLM providers for native tool calling.

---

### LLM Types

#### `LLMProvider`

```typescript
interface LLMProvider {
  complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>;
  getModels(): ModelInfo[];
}
```

The core interface that all provider implementations must satisfy. `getModels()` returns the provider's model catalog — used by the pipeline to populate the Planner's system prompt and validate per-step model assignments.

#### `LLMMessage`

```typescript
interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}
```

#### `LLMRequestOptions`

```typescript
interface LLMRequestOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolSchema[];
}
```

#### `LLMResponse`

```typescript
interface LLMResponse {
  text: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  finishReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  toolUse?: LLMToolUseBlock[];
}
```

| Field          | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `text`         | The text content of the model's response                         |
| `tokensUsed`   | Input and output token counts                                    |
| `finishReason` | Why the model stopped generating                                 |
| `toolUse`      | Tool call requests (present when `finishReason` is `"tool_use"`) |

#### `LLMToolUseBlock`

```typescript
interface LLMToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```

| Field   | Description                                       |
| ------- | ------------------------------------------------- |
| `id`    | Provider-assigned ID for correlating tool results |
| `name`  | Name of the tool the LLM wants to call            |
| `input` | Parsed input parameters for the tool              |

#### `LLMLogEntry`

```typescript
interface LLMLogEntry {
  timestamp: string;
  provider: string;
  status: LLMLogStatus;
  durationMs: number;
  attempt: number;
  request: {
    model: string;
    messageCount: number;
    totalCharLength: number;
    promptPreview: string;
    maxTokens?: number;
    temperature?: number;
    hasSystemPrompt: boolean;
    hasTools?: boolean;
    messages?: LLMMessage[];
    systemPrompt?: string;
  };
  response?: {
    text: string;
    tokensUsed: { input: number; output: number };
    finishReason: string;
    toolUseCount?: number;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}
```

The `messages` and `systemPrompt` fields in `request` are only populated when `includeContent: true` is set in provider options.

#### `LLMLogStatus`

```typescript
type LLMLogStatus = "success" | "error" | "retry";
```

#### `LLMLogCallback`

```typescript
type LLMLogCallback = (entry: LLMLogEntry) => void;
```

---

### Event Types

#### `EventName`

```typescript
type EventName =
  | "prePlanner"
  | "postPlanner"
  | "preExecutor"
  | "postExecutor"
  | "preEvaluator"
  | "postEvaluator"
  | "preStep"
  | "postStep";
```

#### `EventCallback`

```typescript
type EventCallback<TData = unknown> = (
  data: TData,
  cycle: CycleMetadata,
) => TData | void | Promise<TData | void>;
```

A handler function that receives event data and cycle metadata. Return a value to transform the data for subsequent handlers; return `void` to pass through unchanged. Supports async/Promise for operations like human-in-the-loop pausing.

#### `EventRegistration`

```typescript
interface EventRegistration<TData = unknown> {
  handler: EventCallback<TData>;
  continueOnError?: boolean;
}
```

Wraps an `EventCallback` with error handling options. When `continueOnError` is `true`, errors in this handler are swallowed and the pre-error data snapshot is preserved.

#### `EventMap`

```typescript
type EventMap = {
  [K in EventName]?: Array<EventCallback | EventRegistration>;
};
```

The event configuration object passed to the `Tepa` constructor. Each event point accepts an array of callbacks or registrations.

#### `CycleMetadata`

```typescript
interface CycleMetadata {
  cycleNumber: number;
  totalCyclesUsed: number;
  tokensUsed: number;
}
```

#### `PreStepPayload`

```typescript
interface PreStepPayload {
  step: PlanStep;
  cycle: number;
}
```

Data passed to `preStep` event callbacks.

#### `PostStepPayload`

```typescript
interface PostStepPayload {
  step: PlanStep;
  result: ExecutionResult;
  cycle: number;
}
```

Data passed to `postStep` event callbacks.

---

### Result Types

#### `TepaResult`

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

| Field        | Description                                       |
| ------------ | ------------------------------------------------- |
| `status`     | Final pipeline outcome                            |
| `cycles`     | Number of Plan-Execute-Evaluate cycles completed  |
| `tokensUsed` | Total tokens consumed across all LLM calls        |
| `outputs`    | Artifacts produced by the pipeline                |
| `logs`       | Detailed execution log entries                    |
| `feedback`   | Evaluator feedback (on fail) or summary (on pass) |

#### `OutputArtifact`

```typescript
interface OutputArtifact {
  path: string;
  description: string;
  type: "file" | "data" | "report";
}
```

#### `LogEntry`

```typescript
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

## `@tepa/tools`

Tool definitions, the registry implementation, and validation utilities. Ships all built-in tools ready to use.

### `defineTool()`

```typescript
import { defineTool } from "@tepa/tools";

function defineTool(definition: {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}): ToolDefinition;
```

Creates a validated `ToolDefinition`. Validates the schema with Zod at creation time. Throws `Error` with message `"Invalid tool definition: ..."` if the schema is malformed.

---

### `ToolRegistryImpl`

```typescript
import { ToolRegistryImpl } from "@tepa/tools";
```

Concrete implementation of the [`ToolRegistry`](#toolregistry) interface.

| Method           | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `register(tool)` | Register a tool. Throws if `tool.name` is already registered |
| `get(name)`      | Retrieve a tool by name, or `undefined`                      |
| `list()`         | Return all registered tools                                  |
| `toSchema()`     | Return all tools as `ToolSchema[]` (without `execute`)       |

---

### `validateParams()`

```typescript
import { validateParams } from "@tepa/tools";

function validateParams(
  params: Record<string, unknown>,
  parameters: Record<string, ParameterDef>,
): Record<string, unknown>;
```

Validates `params` against a parameter schema. Returns the validated (and potentially defaulted) params. Throws `Error` with message `"Parameter validation failed: ..."` on failure.

---

### `buildZodSchema()`

```typescript
import { buildZodSchema } from "@tepa/tools";

function buildZodSchema(
  parameters: Record<string, ParameterDef>,
): z.ZodObject<Record<string, z.ZodTypeAny>>;
```

Converts a `Record<string, ParameterDef>` into a Zod schema. Type mapping:

| `ParameterDef.type` | Zod type                |
| ------------------- | ----------------------- |
| `"string"`          | `z.string()`            |
| `"number"`          | `z.number()`            |
| `"boolean"`         | `z.boolean()`           |
| `"object"`          | `z.record(z.unknown())` |
| `"array"`           | `z.array(z.unknown())`  |

If `required` is falsy and no `default` is set, the field becomes `.optional()`. If `default` is defined, `.default(value)` is applied.

---

### Built-in Tools

All built-in tools are exported as named constants and created via `defineTool()`.

```typescript
import {
  fileReadTool,
  fileWriteTool,
  directoryListTool,
  fileSearchTool,
  shellExecuteTool,
  httpRequestTool,
  webSearchTool,
  dataParseTool,
  scratchpadTool,
  logObserveTool,
} from "@tepa/tools";
```

#### `file_read`

Reads a file and returns its contents.

| Parameter  | Type     | Required | Default   | Description       |
| ---------- | -------- | -------- | --------- | ----------------- |
| `path`     | `string` | Yes      | —         | File path to read |
| `encoding` | `string` | No       | `"utf-8"` | File encoding     |

#### `file_write`

Writes content to a file, creating directories as needed.

| Parameter | Type     | Required | Default | Description        |
| --------- | -------- | -------- | ------- | ------------------ |
| `path`    | `string` | Yes      | —       | File path to write |
| `content` | `string` | Yes      | —       | Content to write   |

#### `directory_list`

Lists files and directories at a path.

| Parameter  | Type     | Required | Default | Description             |
| ---------- | -------- | -------- | ------- | ----------------------- |
| `path`     | `string` | Yes      | —       | Directory path          |
| `maxDepth` | `number` | No       | `1`     | Maximum recursion depth |

#### `file_search`

Searches for files matching a glob pattern.

| Parameter | Type     | Required | Default | Description                      |
| --------- | -------- | -------- | ------- | -------------------------------- |
| `pattern` | `string` | Yes      | —       | Glob pattern to match            |
| `cwd`     | `string` | No       | `"."`   | Working directory for the search |

#### `shell_execute`

Runs a shell command and returns its output.

| Parameter | Type     | Required | Default | Description             |
| --------- | -------- | -------- | ------- | ----------------------- |
| `command` | `string` | Yes      | —       | Command to execute      |
| `cwd`     | `string` | No       | —       | Working directory       |
| `timeout` | `number` | No       | `30000` | Timeout in milliseconds |

#### `http_request`

Makes an HTTP request and returns the response.

| Parameter     | Type     | Required | Default | Description             |
| ------------- | -------- | -------- | ------- | ----------------------- |
| `url`         | `string` | Yes      | —       | Request URL             |
| `method`      | `string` | No       | `"GET"` | HTTP method             |
| `headers`     | `object` | No       | —       | Request headers         |
| `queryParams` | `object` | No       | —       | URL query parameters    |
| `body`        | `string` | No       | —       | Request body            |
| `timeout`     | `number` | No       | `30000` | Timeout in milliseconds |

#### `web_search`

Performs a web search via an external search API.

| Parameter  | Type     | Required | Default | Description                 |
| ---------- | -------- | -------- | ------- | --------------------------- |
| `query`    | `string` | Yes      | —       | Search query                |
| `endpoint` | `string` | Yes      | —       | Search API endpoint URL     |
| `count`    | `number` | No       | `5`     | Number of results to return |

#### `data_parse`

Parses structured data (CSV, JSON, YAML, etc.).

| Parameter  | Type      | Required | Default | Description                                      |
| ---------- | --------- | -------- | ------- | ------------------------------------------------ |
| `input`    | `string`  | Yes      | —       | Data string or file path (if `fromFile` is true) |
| `format`   | `string`  | Yes      | —       | Data format (e.g., `"csv"`, `"json"`, `"yaml"`)  |
| `fromFile` | `boolean` | No       | `false` | Whether `input` is a file path                   |
| `preview`  | `number`  | No       | —       | Limit output to first N records                  |

#### `scratchpad`

Reads from or writes to the pipeline's shared scratchpad.

| Parameter | Type     | Required | Default | Description                                    |
| --------- | -------- | -------- | ------- | ---------------------------------------------- |
| `action`  | `string` | Yes      | —       | `"read"` or `"write"`                          |
| `key`     | `string` | Yes      | —       | Scratchpad key                                 |
| `value`   | `string` | No       | —       | Value to write (required for `"write"` action) |

#### `log_observe`

Writes an observation message to the pipeline log.

| Parameter | Type     | Required | Default  | Description    |
| --------- | -------- | -------- | -------- | -------------- |
| `message` | `string` | Yes      | —        | Message to log |
| `level`   | `string` | No       | `"info"` | Log level      |

---

### `clearScratchpad()`

```typescript
import { clearScratchpad } from "@tepa/tools";

function clearScratchpad(): void;
```

Clears all scratchpad data. Primarily useful in testing.

---

## `@tepa/provider-core`

Base class and logging utilities shared by all LLM provider implementations. Use this package when building a custom provider.

### `BaseLLMProvider`

```typescript
import { BaseLLMProvider } from "@tepa/provider-core";
```

Abstract base class implementing retry logic, exponential backoff, rate limit handling, and logging for LLM providers.

#### Constructor

```typescript
new BaseLLMProvider(options?: BaseLLMProviderOptions)
```

#### Abstract Members (must be implemented by subclasses)

| Member             | Signature                                                                                                 | Description                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `providerName`     | `protected abstract readonly providerName: string`                                                        | Identifier used in log entries                         |
| `models`           | `protected abstract readonly models: ModelInfo[]`                                                         | Model catalog this provider supports                   |
| `doComplete`       | `protected abstract doComplete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>` | The actual API call                                    |
| `isRetryable`      | `protected abstract isRetryable(error: unknown): boolean`                                                 | Whether an error should trigger a retry                |
| `isRateLimitError` | `protected abstract isRateLimitError(error: unknown): boolean`                                            | Whether an error is a rate limit (uses longer backoff) |
| `getRetryAfterMs`  | `protected abstract getRetryAfterMs(error: unknown): number \| null`                                      | Extract retry-after from error, or `null`              |

#### Public Methods

| Method           | Signature                                                                                  | Description                                            |
| ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `complete`       | `async complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>` | Call with retry logic. Delegates to `doComplete`       |
| `getModels`      | `getModels(): ModelInfo[]`                                                                 | Return the model catalog (defensive copy)              |
| `onLog`          | `onLog(callback: LLMLogCallback): void`                                                    | Register an additional log listener                    |
| `getLogEntries`  | `getLogEntries(): LLMLogEntry[]`                                                           | Get a copy of accumulated log history                  |
| `getLogFilePath` | `getLogFilePath(): string \| undefined`                                                    | Path to the JSONL log file, if file logging is enabled |

#### Retry Behavior

- Up to `maxRetries` attempts (default: `3`)
- Standard backoff: `retryBaseDelayMs * 2^attempt` (default base: `1000`ms)
- Rate limit backoff: `retryBaseDelayMs * 30 * 2^attempt`
- Explicit `retry-after` headers from the provider take precedence

---

### `BaseLLMProviderOptions`

```typescript
interface BaseLLMProviderOptions {
  maxRetries?: number;
  retryBaseDelayMs?: number;
  defaultLog?: boolean;
  logDir?: string;
  includeContent?: boolean;
}
```

| Field              | Default        | Description                                                   |
| ------------------ | -------------- | ------------------------------------------------------------- |
| `maxRetries`       | `3`            | Maximum retries on transient/rate-limit errors                |
| `retryBaseDelayMs` | `1000`         | Base delay for exponential backoff (ms)                       |
| `defaultLog`       | `true`         | Enable automatic JSONL file logging                           |
| `logDir`           | `".tepa/logs"` | Directory for log files                                       |
| `includeContent`   | `false`        | Include full message content in log entries (privacy control) |

---

### `consoleLogCallback()`

```typescript
import { consoleLogCallback } from "@tepa/provider-core";

function consoleLogCallback(entry: LLMLogEntry): void;
```

Prints log entries to the console in the format: `[HH:MM:SS.mmm][status][provider] durationMs | detail`

Use with `provider.onLog(consoleLogCallback)` to add console output alongside file logging.

---

### `createFileLogWriter()`

```typescript
import { createFileLogWriter } from "@tepa/provider-core";

function createFileLogWriter(dir?: string): FileLogWriter;
```

Creates a JSONL file logger. Files are named `llm-{ISO-timestamp}.jsonl` in the specified directory (default: `".tepa/logs"`).

#### `FileLogWriter`

```typescript
interface FileLogWriter {
  callback: LLMLogCallback;
  filePath: string;
}
```

| Field      | Description                                    |
| ---------- | ---------------------------------------------- |
| `callback` | The log callback to pass to `provider.onLog()` |
| `filePath` | Absolute path to the generated log file        |

---

## `@tepa/provider-anthropic`

Anthropic Claude provider implementation.

```typescript
import { AnthropicProvider } from "@tepa/provider-anthropic";
```

### `AnthropicProvider`

Extends [`BaseLLMProvider`](#basellmprovider). Uses the Anthropic Messages API.

#### Constructor

```typescript
new AnthropicProvider(options?: AnthropicProviderOptions)
```

#### `AnthropicProviderOptions`

```typescript
interface AnthropicProviderOptions extends BaseLLMProviderOptions {
  apiKey?: string;
}
```

| Field    | Default                         | Description       |
| -------- | ------------------------------- | ----------------- |
| `apiKey` | `process.env.ANTHROPIC_API_KEY` | Anthropic API key |

Default model: `"claude-haiku-4-5"` | Default max tokens: `64000`

---

### `AnthropicModels`

```typescript
import { AnthropicModels } from "@tepa/provider-anthropic";
```

Type-safe model ID constants:

| Constant            | Value                 |
| ------------------- | --------------------- |
| `Claude_Haiku_4_5`  | `"claude-haiku-4-5"`  |
| `Claude_Sonnet_4_6` | `"claude-sonnet-4-6"` |
| `Claude_Opus_4_6`   | `"claude-opus-4-6"`   |

---

### `ANTHROPIC_MODEL_CATALOG`

```typescript
import { ANTHROPIC_MODEL_CATALOG } from "@tepa/provider-anthropic";
```

The full `ModelInfo[]` catalog array used internally by `AnthropicProvider.getModels()`. Exported for inspection or testing.

---

### `createProvider()`

```typescript
import { createProvider } from "@tepa/provider-anthropic";

function createProvider(name: ProviderName, options?: AnthropicProviderOptions): LLMProvider;
```

Factory function. Currently only supports `name: "anthropic"`.

```typescript
type ProviderName = "anthropic";
```

---

## `@tepa/provider-openai`

OpenAI provider implementation using the Responses API.

```typescript
import { OpenAIProvider } from "@tepa/provider-openai";
```

### `OpenAIProvider`

Extends [`BaseLLMProvider`](#basellmprovider).

#### Constructor

```typescript
new OpenAIProvider(options?: OpenAIProviderOptions)
```

#### `OpenAIProviderOptions`

```typescript
interface OpenAIProviderOptions extends BaseLLMProviderOptions {
  apiKey?: string;
}
```

| Field    | Default                      | Description    |
| -------- | ---------------------------- | -------------- |
| `apiKey` | `process.env.OPENAI_API_KEY` | OpenAI API key |

Default model: `"gpt-5-mini"` | Default max tokens: `64000`

---

### `OpenAIModels`

```typescript
import { OpenAIModels } from "@tepa/provider-openai";
```

| Constant     | Value          |
| ------------ | -------------- |
| `GPT_5_Mini` | `"gpt-5-mini"` |
| `GPT_5`      | `"gpt-5"`      |

---

### `OPENAI_MODEL_CATALOG`

The full `ModelInfo[]` catalog array. Exported for inspection or testing.

---

## `@tepa/provider-gemini`

Google Gemini provider implementation.

```typescript
import { GeminiProvider } from "@tepa/provider-gemini";
```

### `GeminiProvider`

Extends [`BaseLLMProvider`](#basellmprovider).

#### Constructor

```typescript
new GeminiProvider(options?: GeminiProviderOptions)
```

#### `GeminiProviderOptions`

```typescript
interface GeminiProviderOptions extends BaseLLMProviderOptions {
  apiKey?: string;
}
```

| Field    | Default                                                      | Description    |
| -------- | ------------------------------------------------------------ | -------------- |
| `apiKey` | `process.env.GEMINI_API_KEY` or `process.env.GOOGLE_API_KEY` | Gemini API key |

Default model: `"gemini-3-flash-preview"` | Default max tokens: `64000`

---

### `GeminiModels`

```typescript
import { GeminiModels } from "@tepa/provider-gemini";
```

| Constant                 | Value                      |
| ------------------------ | -------------------------- |
| `Gemini_3_Flash_Preview` | `"gemini-3-flash-preview"` |
| `Gemini_3_Pro_Preview`   | `"gemini-3-pro-preview"`   |

---

### `GEMINI_MODEL_CATALOG`

The full `ModelInfo[]` catalog array. Exported for inspection or testing.
