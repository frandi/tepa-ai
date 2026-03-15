# Tool System

Tools are how the pipeline interacts with the outside world — reading files, running commands, making HTTP requests, or anything else your task requires. Tepa treats tools as first-class objects: each tool declares its name, description, parameters, and an async execute function. The Planner sees what tools are available and builds plans around them. The Executor invokes them through native LLM tool calling, so the model returns structured parameters instead of free-form text that needs parsing.

This section covers the tool interface, how to register tools, the full built-in tool reference, and how to create custom or third-party tools. For how tool schemas flow through the pipeline internally, see [Pipeline in Detail — Tool Schema Flow](./04-pipeline-in-detail.md#tool-schema-flow).

---

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

| Field         | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| `name`        | Unique identifier used in plans and tool calls. Use `snake_case` (e.g., `"file_read"`). |
| `description` | Tells the LLM what the tool does — directly affects planning and execution quality.     |
| `parameters`  | Schema of accepted inputs, keyed by parameter name.                                     |
| `execute`     | The async function invoked when the tool is called.                                     |

### `ParameterDef`

```typescript
interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}
```

| Field         | Purpose                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `type`        | One of five JSON-compatible types.                                      |
| `description` | Tells the LLM what value to provide — be specific (see guidance below). |
| `required`    | Whether the parameter must be supplied. Defaults to `true` if omitted.  |
| `default`     | Default value applied when the parameter is not provided.               |

The parameter schema serves double duty: validated with Zod at tool creation time, and converted to the LLM provider's native tool format at execution time.

---

## Writing Good Tool Descriptions

The `description` field on both the tool and its parameters is the primary signal the LLM uses when deciding which tool to assign to a step and what values to pass. A vague description produces worse plans and more failed steps. A precise description produces better plans on the first cycle, reducing the need for self-correction.

**Tool description:** Describe what the tool does, what it operates on, and what it returns. Avoid generic verbs like "processes" or "handles."

```typescript
// ❌ Too vague — the LLM doesn't know when or how to use this
description: "Processes files";

// ✅ Specific — the LLM knows exactly what this tool does and what to expect back
description: "Reads the full text contents of a file at the given path and returns them as a UTF-8 string. Use this to load source code, configuration files, data files, or any text-based content before analyzing or transforming it.";
```

**Parameter descriptions:** Describe what value the LLM should supply, including format, constraints, and examples where the input isn't obvious.

```typescript
// ❌ Unhelpful — the LLM already knows it's a path
path: { type: "string", description: "File path" }

// ✅ Specific — tells the LLM what kind of path, relative to what
path: {
  type: "string",
  description: "Absolute or relative file path to read. Relative paths are resolved from the current working directory. Example: './src/index.ts' or '/tmp/output.json'."
}
```

**The practical test:** Read your description without looking at the tool name. Could the LLM still understand exactly what to call and when? If not, add more specificity.

---

## Creating Tools

Use `defineTool` to create a validated tool definition. It runs Zod validation at creation time — if the schema is malformed, you'll get an error immediately rather than at runtime.

```typescript
import { defineTool } from "@tepa/tools";

const myTool = defineTool({
  name: "my_custom_tool",
  description:
    "Fetches the current status of a deployment by its ID and returns the status string and last updated timestamp.",
  parameters: {
    deploymentId: {
      type: "string",
      description: "The deployment ID to check. Format: 'deploy-{uuid}'.",
      required: true,
    },
    verbose: {
      type: "boolean",
      description: "If true, include full deployment logs in the response.",
      default: false,
    },
  },
  execute: async (params) => {
    const deploymentId = params.deploymentId as string;
    const verbose = params.verbose as boolean;
    // Implementation...
    return { status: "running", updatedAt: new Date().toISOString() };
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
  parameters.deploymentId.description: Parameter description must be non-empty
```

You can also construct a `ToolDefinition` object directly against the `@tepa/types` interface without using `defineTool` — the interface is identical. `defineTool` just adds the validation layer.

---

## Registering Tools

### Passing Tools to the Constructor

Pass tools as an array when creating a `Tepa` instance. This is the standard approach:

```typescript
import { Tepa } from "@tepa/core";
import { fileReadTool, fileWriteTool, shellExecuteTool } from "@tepa/tools";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, shellExecuteTool],
});
```

Internally, `Tepa` registers each tool in an inline `ToolRegistry` at the start of `run()`. The registry is passed to the Planner (for building tool-aware plans) and the Executor (for resolving and invoking tools at execution time).

Only tools you explicitly pass are available. If a plan references an unregistered tool, plan validation catches it before any step runs and throws a `TepaCycleError`:

```
Plan references unknown tool "database_query" in step "step_2".
Available tools: file_read, file_write, shell_execute
```

### `ToolRegistryImpl` for Programmatic Use

If you need to inspect or manage tools outside of a pipeline run, use `ToolRegistryImpl` directly:

```typescript
import { ToolRegistryImpl } from "@tepa/tools";

const registry = new ToolRegistryImpl();
registry.register(fileReadTool);

const tool = registry.get("file_read"); // Look up by name
const allTools = registry.list(); // List all registered tools
const schemas = registry.toSchema(); // Schemas without execute functions (safe to serialize)
```

Registering a tool name that already exists throws: `Tool "file_read" is already registered`. See the [API Reference](./11-api-reference.md) for the full `ToolRegistry` interface.

---

## Built-in Tools Reference

The `@tepa/tools` package includes ten tools organized into four categories.

```bash
npm install @tepa/tools
```

### File System

#### `file_read`

Read the contents of a file at the given path.

| Parameter  | Type   | Required | Default   | Description                             |
| ---------- | ------ | -------- | --------- | --------------------------------------- |
| `path`     | string | yes      | —         | Absolute or relative file path to read. |
| `encoding` | string | no       | `"utf-8"` | File encoding.                          |

**Returns:** File contents as a string.

```typescript
import { fileReadTool } from "@tepa/tools";
```

#### `file_write`

Write content to a file, creating parent directories if needed.

| Parameter | Type   | Required | Default | Description                              |
| --------- | ------ | -------- | ------- | ---------------------------------------- |
| `path`    | string | yes      | —       | Absolute or relative file path to write. |
| `content` | string | yes      | —       | Content to write.                        |

**Returns:** `{ path: string, bytesWritten: number }`

```typescript
import { fileWriteTool } from "@tepa/tools";
```

#### `directory_list`

List directory contents with optional recursive depth.

| Parameter  | Type   | Required | Default | Description              |
| ---------- | ------ | -------- | ------- | ------------------------ |
| `path`     | string | yes      | —       | Directory path to list.  |
| `maxDepth` | number | no       | `1`     | Maximum recursion depth. |

**Returns:** Array of `{ name, type: "file" | "directory", children? }` entries, nested by depth.

```typescript
import { directoryListTool } from "@tepa/tools";
```

#### `file_search`

Search for files matching a glob pattern.

| Parameter | Type   | Required | Default | Description                       |
| --------- | ------ | -------- | ------- | --------------------------------- |
| `pattern` | string | yes      | —       | Glob pattern (e.g., `**/*.ts`).   |
| `cwd`     | string | no       | `"."`   | Working directory for the search. |

**Returns:** Array of matching file paths.

```typescript
import { fileSearchTool } from "@tepa/tools";
```

### Execution

#### `shell_execute`

Execute a shell command and capture stdout, stderr, and exit code.

| Parameter | Type   | Required | Default | Description                        |
| --------- | ------ | -------- | ------- | ---------------------------------- |
| `command` | string | yes      | —       | Shell command to execute.          |
| `cwd`     | string | no       | —       | Working directory for the command. |
| `timeout` | number | no       | `30000` | Timeout in milliseconds.           |

**Returns:** `{ stdout: string, stderr: string, exitCode: number }`

Output is truncated to 1 MB to prevent memory issues with large command outputs.

```typescript
import { shellExecuteTool } from "@tepa/tools";
```

#### `http_request`

Make an HTTP request using fetch.

| Parameter     | Type   | Required | Default | Description                            |
| ------------- | ------ | -------- | ------- | -------------------------------------- |
| `url`         | string | yes      | —       | URL to request.                        |
| `method`      | string | no       | `"GET"` | HTTP method.                           |
| `headers`     | object | no       | —       | Request headers.                       |
| `queryParams` | object | no       | —       | Query parameters to append to the URL. |
| `body`        | string | no       | —       | Request body.                          |
| `timeout`     | number | no       | `30000` | Timeout in milliseconds.               |

**Returns:** `{ status: number, statusText: string, headers: object, body: string }`

Automatically retries on network errors (up to 3 retries with exponential backoff). Does not retry on HTTP 4xx/5xx responses.

```typescript
import { httpRequestTool } from "@tepa/tools";
```

### Network

#### `web_search`

Search the web using a configurable search API endpoint.

| Parameter  | Type   | Required | Default | Description                  |
| ---------- | ------ | -------- | ------- | ---------------------------- |
| `query`    | string | yes      | —       | Search query.                |
| `endpoint` | string | yes      | —       | Search API endpoint URL.     |
| `count`    | number | no       | `5`     | Number of results to return. |

**Returns:** JSON response from the search API.

This tool is endpoint-agnostic — point it at any search API that accepts `q` and `count` query parameters.

```typescript
import { webSearchTool } from "@tepa/tools";
```

### Data

#### `data_parse`

Parse JSON, CSV, or YAML data from a string or file.

| Parameter  | Type    | Required | Default | Description                            |
| ---------- | ------- | -------- | ------- | -------------------------------------- |
| `input`    | string  | yes      | —       | Data string or file path to parse.     |
| `format`   | string  | yes      | —       | `"json"`, `"csv"`, or `"yaml"`.        |
| `fromFile` | boolean | no       | `false` | If true, treat `input` as a file path. |
| `preview`  | number  | no       | —       | Limit output to first N rows/entries.  |

**Returns:** Parsed data — shape depends on format:

- **CSV:** `Array<Record<string, string>>` — each row as an object keyed by header
- **JSON:** Parsed JSON value
- **YAML:** Parsed YAML value

```typescript
import { dataParseTool } from "@tepa/tools";
```

### Pipeline Internal

#### `scratchpad`

In-memory key-value store for sharing intermediate data between steps. Data persists for the duration of a single `run()` call.

| Parameter | Type   | Required | Default | Description                              |
| --------- | ------ | -------- | ------- | ---------------------------------------- |
| `action`  | string | yes      | —       | `"read"` or `"write"`.                   |
| `key`     | string | yes      | —       | Storage key.                             |
| `value`   | string | no       | —       | Value to store (required for `"write"`). |

**Returns:**

- Write: `{ success: true, key: string }`
- Read (found): `{ found: true, key: string, value: unknown }`
- Read (not found): `{ found: false, key: string }`

The pipeline writes `_execution_summary` to the scratchpad automatically after each cycle. Avoid writing to this key directly — it's reserved for internal use.

```typescript
import { scratchpadTool } from "@tepa/tools";
```

#### `log_observe`

Record an observation to the pipeline logs without producing a primary output.

| Parameter | Type   | Required | Default  | Description                       |
| --------- | ------ | -------- | -------- | --------------------------------- |
| `message` | string | yes      | —        | Observation message to record.    |
| `level`   | string | no       | `"info"` | `"info"`, `"warn"`, or `"error"`. |

**Returns:** `{ observation: string, level: string, timestamp: string }`

Use this when a step needs to surface a note, warning, or error to the pipeline logs — for example, flagging a data quality issue discovered during analysis — without that observation becoming the step's primary output.

```typescript
import { logObserveTool } from "@tepa/tools";
```

---

## Creating Custom and Third-Party Tools

Any npm package can be a Tepa tool. The contract is simple: export a `ToolDefinition` object. No plugin API, no registration hooks — import and pass.

### Minimal Custom Tool

```typescript
import type { ToolDefinition } from "@tepa/types";

export const postgresQueryTool: ToolDefinition = {
  name: "postgres_query",
  description:
    "Execute a read-only SQL SELECT query against a PostgreSQL database and return the result rows. Use this to retrieve structured data for analysis or reporting. Does not support INSERT, UPDATE, DELETE, or DDL statements.",
  parameters: {
    query: {
      type: "string",
      description: "SQL SELECT query to execute. Must be a read-only query.",
      required: true,
    },
    database: {
      type: "string",
      description: "Name of the database to query.",
      required: true,
    },
  },
  execute: async (params) => {
    const query = params.query as string;
    const database = params.database as string;
    // Implementation using pg driver...
    return { rows: [], rowCount: 0 };
  },
};
```

Use `defineTool` from `@tepa/tools` if you want schema validation at creation time:

```typescript
import { defineTool } from "@tepa/tools";

export const postgresQueryTool = defineTool({
  name: "postgres_query",
  // ...same definition
});
```

### Using Custom Tools

Pass custom tools to `Tepa` alongside built-ins — they're treated identically:

```typescript
import { Tepa } from "@tepa/core";
import { fileReadTool, shellExecuteTool } from "@tepa/tools";
import { postgresQueryTool } from "./tools/postgres.js";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, shellExecuteTool, postgresQueryTool],
});
```

### Publishing as an npm Package

To share a tool with the community, publish it as a standalone npm package. Only `@tepa/types` is needed as a dependency — there's no requirement to depend on `@tepa/core` or `@tepa/tools`:

```bash
mkdir tepa-tool-postgres
cd tepa-tool-postgres
npm init -y
npm install @tepa/types
npm install -D typescript tsup
```

Consumers install your package and pass the tool to `Tepa` alongside any other tools. For a complete scaffolding walkthrough — including project structure, build config, test setup, and publish steps — see the [Contributing Guide](./10-contributing.md#how-to-create-a-custom-tool).

---

## What's Next

- [**Event System Patterns**](./07-event-system-patterns.md) — Human-in-the-loop approval, plan safety filters, progress tracking, and more.
- [**LLM Providers**](./08-llm-providers.md) — Built-in providers, native tool use, and custom provider implementation.
- [**Contributing**](./10-contributing.md) — Full scaffolding guide for publishing tools and providers as community packages.
