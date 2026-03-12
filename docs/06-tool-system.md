# Tool System

Tools are how the pipeline interacts with the outside world — reading files, running commands, making HTTP requests, or anything else your task requires. Tepa treats tools as first-class objects: each tool declares its name, parameters, and an async execute function. The Planner sees what tools are available and builds plans around them. The Executor invokes them through native LLM tool calling, so the model returns structured parameters instead of free-form text that needs parsing.

## Tool Definition

Every tool in Tepa implements the `ToolDefinition` interface:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}
```

| Field | Purpose |
|---|---|
| `name` | Unique identifier used in plans and tool calls (e.g., `"file_read"`) |
| `description` | Tells the LLM what the tool does — this directly affects how well the model uses it |
| `parameters` | Schema of accepted inputs, keyed by parameter name |
| `execute` | The async function that runs when the tool is invoked |

### `ParameterDef`

Each parameter is described with a `ParameterDef`:

```typescript
interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}
```

| Field | Purpose |
|---|---|
| `type` | One of five JSON-compatible types |
| `description` | Tells the LLM what value to provide — be specific |
| `required` | Whether the parameter must be supplied. Defaults to `true` if omitted |
| `default` | Default value applied when the parameter is not provided |

The parameter schema serves double duty: it's validated with Zod at tool creation time, and it's converted to the LLM provider's native tool format at execution time (JSON Schema for Anthropic/OpenAI, function declarations for Gemini).

## Creating Tools

Use `defineTool` to create a validated tool definition. It runs Zod validation at creation time — if the schema is malformed, you'll get an error immediately rather than at runtime.

```typescript
import { defineTool } from "@tepa/tools";

const myTool = defineTool({
  name: "my_custom_tool",
  description: "Does something useful",
  parameters: {
    input: { type: "string", description: "Input value", required: true },
    verbose: { type: "boolean", description: "Verbose output", default: false },
  },
  execute: async (params) => {
    const input = params.input as string;
    const verbose = params.verbose as boolean;
    return { result: `processed: ${input}` };
  },
});
```

`defineTool` validates that:

- `name` is a non-empty string
- `description` is a non-empty string
- Every entry in `parameters` has a valid `type` and non-empty `description`
- `execute` is a function

If any check fails, it throws with a message listing every failing field:

```
Invalid tool definition: name: Tool name must be non-empty;
  parameters.input.description: Parameter description must be non-empty
```

You can also create a `ToolDefinition` object directly without `defineTool` — the interface is the same. `defineTool` just adds the validation layer.

## Registering Tools

### Passing Tools to the `Tepa` Constructor

The simplest way to register tools is to pass them as an array when creating a `Tepa` instance:

```typescript
import { Tepa } from "@tepa/core";
import {
  fileReadTool,
  fileWriteTool,
  shellExecuteTool,
} from "@tepa/tools";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, shellExecuteTool],
});
```

Internally, `Tepa` creates a tool registry during `run()` and registers each tool. The registry is then passed to the Planner (for building tool-aware plans) and the Executor (for resolving and invoking tools).

Only tools you explicitly pass are available. If a plan references a tool that wasn't registered, the Planner validation catches it and raises a `TepaCycleError`:

```
Plan references unknown tool "database_query" in step "step_2".
Available tools: file_read, file_write, shell_execute
```

### `ToolRegistryImpl` for Programmatic Use

If you need to manage tools outside of a pipeline run — for inspection, dynamic registration, or building custom tooling — use `ToolRegistryImpl` directly:

```typescript
import { ToolRegistryImpl, fileReadTool, fileWriteTool } from "@tepa/tools";

const registry = new ToolRegistryImpl();
registry.register(fileReadTool);
registry.register(fileWriteTool);

// Look up a tool by name
const tool = registry.get("file_read");

// List all registered tools
const allTools = registry.list();

// Get schemas without execute functions (safe to serialize or send to an LLM)
const schemas = registry.toSchema();
```

Key behaviors:

- **Duplicate prevention** — Registering a tool with a name that already exists throws an error: `Tool "file_read" is already registered`.
- **`toSchema()`** — Returns an array of `ToolSchema` objects (name, description, parameters) without the `execute` function. This is what gets sent to LLM providers.

## Built-in Tools Reference

The `@tepa/tools` package includes ten tools organized into four categories.

```bash
npm install @tepa/tools
```

### File System

#### `file_read`

Read the contents of a file at the given path.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute or relative file path |
| `encoding` | string | no | `"utf-8"` | File encoding |

**Returns:** File contents as a string.

```typescript
import { fileReadTool } from "@tepa/tools";
```

#### `file_write`

Write content to a file, creating parent directories if needed.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute or relative file path |
| `content` | string | yes | — | Content to write |

**Returns:** `{ path: string, bytesWritten: number }`

```typescript
import { fileWriteTool } from "@tepa/tools";
```

#### `directory_list`

List directory contents with optional recursive depth.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Directory path to list |
| `maxDepth` | number | no | `1` | Maximum recursion depth |

**Returns:** Array of `{ name: string, type: "file" | "directory", children?: [...] }` entries, nested according to depth.

```typescript
import { directoryListTool } from "@tepa/tools";
```

#### `file_search`

Search for files matching a glob pattern.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `pattern` | string | yes | — | Glob pattern (e.g., `**/*.ts`) |
| `cwd` | string | no | `"."` | Working directory for the search |

**Returns:** Array of matching file paths.

```typescript
import { fileSearchTool } from "@tepa/tools";
```

### Execution

#### `shell_execute`

Execute a shell command and capture stdout, stderr, and exit code.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `command` | string | yes | — | Shell command to execute |
| `cwd` | string | no | — | Working directory for the command |
| `timeout` | number | no | `30000` | Timeout in milliseconds |

**Returns:** `{ stdout: string, stderr: string, exitCode: number }`

Output is truncated to 1 MB to prevent memory issues with large command outputs.

```typescript
import { shellExecuteTool } from "@tepa/tools";
```

#### `http_request`

Make an HTTP request using fetch.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | URL to request |
| `method` | string | no | `"GET"` | HTTP method |
| `headers` | object | no | — | Request headers |
| `queryParams` | object | no | — | Query parameters to append to the URL |
| `body` | string | no | — | Request body |
| `timeout` | number | no | `30000` | Timeout in milliseconds |

**Returns:** `{ status: number, statusText: string, headers: object, body: string }`

Automatically retries on network errors (up to 3 retries with exponential backoff). Does not retry on HTTP 4xx/5xx responses.

```typescript
import { httpRequestTool } from "@tepa/tools";
```

### Network

#### `web_search`

Search the web using a configurable search API endpoint.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | yes | — | Search query |
| `endpoint` | string | yes | — | Search API endpoint URL |
| `count` | number | no | `5` | Number of results |

**Returns:** JSON response from the search API.

This tool is endpoint-agnostic — point it at any search API that accepts `q` and `count` query parameters.

```typescript
import { webSearchTool } from "@tepa/tools";
```

### Data

#### `data_parse`

Parse JSON, CSV, or YAML data from a string or file.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `input` | string | yes | — | Data string or file path to parse |
| `format` | string | yes | — | Data format: `"json"`, `"csv"`, or `"yaml"` |
| `fromFile` | boolean | no | `false` | If true, treat input as a file path |
| `preview` | number | no | — | Limit output to first N rows/entries |

**Returns:** Parsed data — the shape depends on the format:
- **CSV**: `Array<Record<string, string>>` (each row as an object keyed by header)
- **JSON**: Parsed JSON value
- **YAML**: Parsed YAML value

```typescript
import { dataParseTool } from "@tepa/tools";
```

### Pipeline Internal

#### `scratchpad`

In-memory key-value store for intermediate data. Data persists for the duration of a single pipeline run.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `action` | string | yes | — | `"read"` or `"write"` |
| `key` | string | yes | — | Storage key |
| `value` | string | no | — | Value to store (required for `"write"`) |

**Returns:**
- Write: `{ success: true, key: string }`
- Read (found): `{ found: true, key: string, value: unknown }`
- Read (not found): `{ found: false, key: string }`

The scratchpad lets steps share data without depending on each other's outputs directly. The pipeline also writes an `_execution_summary` key automatically after each cycle, which the Planner reads during re-planning.

```typescript
import { scratchpadTool } from "@tepa/tools";
```

#### `log_observe`

Record an observation for logging purposes.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `message` | string | yes | — | Observation message to record |
| `level` | string | no | `"info"` | Log level: `"info"`, `"warn"`, or `"error"` |

**Returns:** `{ observation: string, level: string, timestamp: string }`

Use this when a step needs to surface a note, warning, or error to the pipeline logs without producing a primary output.

```typescript
import { logObserveTool } from "@tepa/tools";
```

## Creating Third-Party Tools

Any npm package can be a Tepa tool. The contract is simple — export a `ToolDefinition` object:

```typescript
// tepa-tool-postgres/index.ts
import type { ToolDefinition } from "@tepa/types";

export const postgresQuery: ToolDefinition = {
  name: "postgres_query",
  description: "Execute a read-only SQL query against PostgreSQL",
  parameters: {
    query: { type: "string", description: "SQL query to execute", required: true },
    database: { type: "string", description: "Database name", required: true },
  },
  execute: async (params) => {
    const query = params.query as string;
    const database = params.database as string;
    // Implementation using pg driver...
    return { rows: [], rowCount: 0 };
  },
};
```

Consumers install the package and pass it to `Tepa` alongside built-in tools:

```typescript
import { Tepa } from "@tepa/core";
import { fileReadTool, shellExecuteTool } from "@tepa/tools";
import { postgresQuery } from "tepa-tool-postgres";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, shellExecuteTool, postgresQuery],
});
```

No plugin API, no registration hooks — just import and pass. Use `defineTool` from `@tepa/tools` if you want Zod validation at creation time, or construct the `ToolDefinition` object directly against the `@tepa/types` interface.

## What's Next

- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and more.
- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, and custom provider implementation.
