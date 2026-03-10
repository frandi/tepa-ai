# @tepa/tools

Built-in tool collection for the Tepa agent pipeline. Includes file system, network, data processing, and pipeline-internal tools.

## Install

```bash
npm install @tepa/tools
```

## Usage

```typescript
import { Tepa } from "@tepa/core";
import {
  fileReadTool,
  fileWriteTool,
  directoryListTool,
  shellExecuteTool,
} from "@tepa/tools";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  tools: [fileReadTool, fileWriteTool, directoryListTool, shellExecuteTool],
  provider: new AnthropicProvider(),
});
```

## Built-in Tools

### File System

| Tool | Description |
|------|-------------|
| `fileReadTool` | Read file contents. Supports optional encoding parameter |
| `fileWriteTool` | Write content to a file. Creates parent directories if needed |
| `directoryListTool` | List files and directories. Supports recursive traversal and max depth |
| `fileSearchTool` | Find files matching a glob pattern within a directory |

### Execution

| Tool | Description |
|------|-------------|
| `shellExecuteTool` | Run a shell command. Captures stdout, stderr, and exit code |
| `httpRequestTool` | Make HTTP requests (GET, POST, PUT, DELETE) |
| `webSearchTool` | Perform a web search via configurable API endpoint |

### Data Processing

| Tool | Description |
|------|-------------|
| `dataParseTool` | Parse structured data (JSON, CSV, YAML) from string or file |

### Pipeline Internal

| Tool | Description |
|------|-------------|
| `scratchpadTool` | Read/write to an in-memory key-value store |
| `logObserveTool` | Record observations to the execution log |

## Custom Tools

Use `defineTool` for validated tool creation:

```typescript
import { defineTool } from "@tepa/tools";

const myTool = defineTool({
  name: "my_custom_tool",
  description: "Does something useful",
  parameters: {
    input: { type: "string", description: "Input value", required: true },
    verbose: { type: "boolean", description: "Verbose output", default: false },
  },
  execute: async ({ input, verbose }) => {
    return { result: `processed: ${input}` };
  },
});
```

`defineTool` validates the tool schema at creation time and throws if the definition is malformed.

## Tool Registry

Use `ToolRegistryImpl` to manage tools programmatically:

```typescript
import { ToolRegistryImpl, fileReadTool, fileWriteTool } from "@tepa/tools";

const registry = new ToolRegistryImpl();
registry.register(fileReadTool);
registry.register(fileWriteTool);

const tool = registry.get("file_read");
const schemas = registry.toSchema(); // Serializable schemas for LLM context
```

## Third-Party Tools

Any npm package can be a Tepa tool. The contract is simple — export a `ToolDefinition` object:

```typescript
// tepa-tool-postgres/index.ts
import type { ToolDefinition } from "@tepa/types";

export const postgresQuery: ToolDefinition = {
  name: "postgres_query",
  description: "Execute a SQL query against PostgreSQL",
  parameters: {
    query: { type: "string", description: "SQL query", required: true },
  },
  execute: async ({ query }) => {
    // implementation using pg driver
  },
};
```

No plugin API needed — just import and pass to `Tepa`.
