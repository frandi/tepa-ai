# LLM Providers

Tepa is LLM-agnostic. The `LLMProvider` interface is a single method — `complete()` — that abstracts away every provider-specific SDK, API shape, and authentication flow. Tepa ships with three built-in providers (Anthropic, OpenAI, Gemini), and you can create your own by extending `BaseLLMProvider`. This section covers the interface contract, built-in providers, native tool use, the provider logging system, and how to build a custom provider.

## Provider Interface

All provider types live in `@tepa/types`. The core interface is intentionally minimal:

### `LLMProvider`

```typescript
interface LLMProvider {
  complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>;
}
```

A single method. Pass messages and options, get a response. The pipeline never touches provider SDKs directly — it only talks through this interface.

### `LLMMessage`

```typescript
interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}
```

A simple role/content pair. System prompts are passed separately through `LLMRequestOptions`, not as messages.

### `LLMRequestOptions`

```typescript
interface LLMRequestOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolSchema[];
}
```

The `tools` field is how the pipeline passes tool schemas for native tool use. When present, the provider converts these schemas into its SDK's native format and includes them in the API call.

### `LLMResponse`

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

Every provider maps its SDK-specific finish reasons to this standard enum. When `finishReason` is `"tool_use"`, the `toolUse` array contains the parsed tool calls.

### `LLMToolUseBlock`

```typescript
interface LLMToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
```

| Field   | Description                                                    |
| ------- | -------------------------------------------------------------- |
| `id`    | Provider-assigned ID for correlating tool calls with results   |
| `name`  | Name of the tool the LLM wants to call                         |
| `input` | Parsed input parameters — already an object, not a JSON string |

The `input` field is pre-parsed by the provider. The Executor passes it directly to `tool.execute()` without any JSON parsing step.

## Built-in Providers

### Anthropic

**Package:** `@tepa/provider-anthropic`
**SDK:** `@anthropic-ai/sdk`
**Default model:** `claude-haiku-4-5`

```bash
npm install @tepa/provider-anthropic
```

```typescript
import { AnthropicProvider } from "@tepa/provider-anthropic";

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY, // or omit to read from env automatically
});
```

**Options:**

| Option             | Type      | Default                     | Description                                |
| ------------------ | --------- | --------------------------- | ------------------------------------------ |
| `apiKey`           | `string`  | `ANTHROPIC_API_KEY` env var | API key for authentication                 |
| `maxRetries`       | `number`  | `3`                         | Max retries on transient/rate-limit errors |
| `retryBaseDelayMs` | `number`  | `1000`                      | Base delay for exponential backoff         |
| `defaultLog`       | `boolean` | `true`                      | Enable automatic JSONL file logging        |
| `logDir`           | `string`  | `".tepa/logs"`              | Directory for log files                    |
| `includeContent`   | `boolean` | `false`                     | Include full message content in logs       |

**Retryable errors:** Rate limit (429), internal server error (500), connection errors, overloaded (529).

**Finish reason mapping:**

| Anthropic            | Tepa              |
| -------------------- | ----------------- |
| `"max_tokens"`       | `"max_tokens"`    |
| `"stop_sequence"`    | `"stop_sequence"` |
| `"tool_use"`         | `"tool_use"`      |
| `"end_turn"` / other | `"end_turn"`      |

### OpenAI

**Package:** `@tepa/provider-openai`
**SDK:** `openai`
**API:** Responses API
**Default model:** `gpt-5-mini`

```bash
npm install @tepa/provider-openai
```

```typescript
import { OpenAIProvider } from "@tepa/provider-openai";

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});
```

**Options:**

| Option             | Type      | Default                  | Description                                |
| ------------------ | --------- | ------------------------ | ------------------------------------------ |
| `apiKey`           | `string`  | `OPENAI_API_KEY` env var | API key for authentication                 |
| `maxRetries`       | `number`  | `3`                      | Max retries on transient/rate-limit errors |
| `retryBaseDelayMs` | `number`  | `1000`                   | Base delay for exponential backoff         |
| `defaultLog`       | `boolean` | `true`                   | Enable automatic JSONL file logging        |
| `logDir`           | `string`  | `".tepa/logs"`           | Directory for log files                    |
| `includeContent`   | `boolean` | `false`                  | Include full message content in logs       |

The OpenAI provider uses the **Responses API** (`client.responses.create()`), not the legacy Chat Completions API. System prompts are passed as a system-role input item, and tool calls are extracted from `FunctionCallOutput` items in the response.

**Retryable errors:** Rate limit (429), internal server error (500), connection errors.

**Finish reason mapping:**

| OpenAI               | Tepa           |
| -------------------- | -------------- |
| `"incomplete"`       | `"max_tokens"` |
| Tool calls in output | `"tool_use"`   |
| Other / null         | `"end_turn"`   |

### Gemini

**Package:** `@tepa/provider-gemini`
**SDK:** `@google/genai`
**Default model:** `gemini-3-flash-preview`

```bash
npm install @tepa/provider-gemini
```

```typescript
import { GeminiProvider } from "@tepa/provider-gemini";

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY, // also reads GOOGLE_API_KEY
});
```

**Options:**

| Option             | Type      | Default                                      | Description                                |
| ------------------ | --------- | -------------------------------------------- | ------------------------------------------ |
| `apiKey`           | `string`  | `GEMINI_API_KEY` or `GOOGLE_API_KEY` env var | API key for authentication                 |
| `maxRetries`       | `number`  | `3`                                          | Max retries on transient/rate-limit errors |
| `retryBaseDelayMs` | `number`  | `1000`                                       | Base delay for exponential backoff         |
| `defaultLog`       | `boolean` | `true`                                       | Enable automatic JSONL file logging        |
| `logDir`           | `string`  | `".tepa/logs"`                               | Directory for log files                    |
| `includeContent`   | `boolean` | `false`                                      | Include full message content in logs       |

Gemini maps `"assistant"` roles to `"model"` and passes system prompts via the SDK's `systemInstruction` config field. Tool calls are extracted from `functionCall` parts in the response, with synthetic IDs (`gemini-call-0`, `gemini-call-1`, ...) since the Gemini API doesn't assign call IDs.

**Retryable errors:** Rate limit (429), server errors (5xx), connection errors. Non-retryable: 400, 401, 403, 404.

**Finish reason mapping:**

| Gemini                     | Tepa           |
| -------------------------- | -------------- |
| `"MAX_TOKENS"`             | `"max_tokens"` |
| Function calls in response | `"tool_use"`   |
| `"STOP"` / other           | `"end_turn"`   |

## Native Tool Use

All three providers use **native tool use** — the LLM's built-in function calling capability — rather than embedding tool descriptions in the prompt text and parsing JSON from the response.

### How It Works

When a plan step declares tools, the Executor:

1. **Builds tool schemas** from the tool registry and passes them in `LLMRequestOptions.tools`
2. **The provider converts** `ToolSchema[]` to its SDK's native format (each provider has a `formatting.ts` module for this)
3. **The LLM responds** with structured tool call blocks instead of free-form text
4. **The provider extracts** tool calls into `LLMToolUseBlock[]` with pre-parsed parameters
5. **The Executor invokes** the tool directly with the parsed `input` object

```typescript
// Inside the Executor (simplified)
const response = await provider.complete(messages, {
  model: step.model,
  systemPrompt: buildToolUseSystemPrompt(),
  tools: [toolSchema],
});

// Parameters are already parsed — no JSON.parse needed
const toolCall = response.toolUse?.find((t) => t.name === toolName);
const result = await tool.execute(toolCall.input);
```

### Why This Matters

Text-based tool calling requires the LLM to produce valid JSON inside its response, which is fragile:

- **Escaping errors:** Large file contents with quotes, newlines, or special characters break JSON parsing
- **Format drift:** The LLM might wrap the JSON in markdown code fences or add commentary
- **Partial output:** Token limits can truncate the JSON mid-object

Native tool use eliminates all of these. The provider SDK handles serialization and the parameters arrive as a ready-to-use object. Every built-in provider uses this approach — there is no fallback to text parsing.

### Schema Conversion by Provider

Each provider converts `ToolSchema` to its SDK's expected format:

**Anthropic** — `input_schema` with JSON Schema object:

```json
{ "name": "file_read", "description": "...", "input_schema": { "type": "object", "properties": { ... }, "required": [...] } }
```

**OpenAI** — `function` type with `parameters` object:

```json
{ "type": "function", "name": "file_read", "description": "...", "parameters": { "type": "object", "properties": { ... }, "required": [...] } }
```

**Gemini** — `functionDeclarations` array with uppercase types:

```json
{ "functionDeclarations": [{ "name": "file_read", "description": "...", "parameters": { "type": "OBJECT", "properties": { ... }, "required": [...] } }] }
```

The conversion is handled internally by each provider. You pass a single `ToolSchema[]` and the provider does the rest.

## Provider Logging System

Every provider built on `BaseLLMProvider` includes a structured logging system that records every LLM call — successes, retries, and errors — to JSONL files and optional custom listeners.

### Default File Logging

By default, each provider instance creates a JSONL log file at `.tepa/logs/llm-{timestamp}.jsonl`. Each line is one `LLMLogEntry`. This is enabled by default and can be turned off with `defaultLog: false`.

```typescript
// Logging enabled by default
const provider = new AnthropicProvider({ apiKey: "..." });

// Disable file logging
const provider = new AnthropicProvider({ apiKey: "...", defaultLog: false });

// Custom log directory
const provider = new AnthropicProvider({ apiKey: "...", logDir: "./my-logs" });
```

### `LLMLogEntry`

Every log entry captures the full context of an LLM call:

```typescript
interface LLMLogEntry {
  timestamp: string;
  provider: string; // "anthropic", "openai", "gemini"
  status: "success" | "error" | "retry";
  durationMs: number;
  attempt: number; // 0-based attempt number
  request: {
    model: string;
    messageCount: number;
    totalCharLength: number;
    promptPreview: string; // First 120 chars of the last message
    maxTokens?: number;
    temperature?: number;
    hasSystemPrompt: boolean;
    hasTools?: boolean;
    messages?: LLMMessage[]; // Only if includeContent: true
    systemPrompt?: string; // Only if includeContent: true
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

A `"success"` entry includes `response`. An `"error"` entry includes `error`. A `"retry"` entry includes `error` and indicates the call will be retried.

### Custom Log Listeners

Register custom callbacks with `onLog()` to process log entries in real time:

```typescript
const provider = new AnthropicProvider({ apiKey: "..." });

provider.onLog((entry) => {
  if (entry.status === "error") {
    alertOncall(`LLM error: ${entry.error?.message}`);
  }
});
```

Multiple listeners can be registered. Each receives every log entry.

### Sending Logs to External Services

Use `onLog()` to forward metrics to monitoring platforms:

```typescript
// Prometheus-style metrics
provider.onLog((entry) => {
  llmCallsTotal.inc({ provider: entry.provider, status: entry.status });
  llmDurationMs.observe({ provider: entry.provider }, entry.durationMs);

  if (entry.response) {
    llmTokensTotal.inc(
      { provider: entry.provider, direction: "input" },
      entry.response.tokensUsed.input,
    );
    llmTokensTotal.inc(
      { provider: entry.provider, direction: "output" },
      entry.response.tokensUsed.output,
    );
  }
});
```

```typescript
// Datadog / NewRelic style
provider.onLog((entry) => {
  datadogClient.gauge("llm.duration", entry.durationMs, {
    provider: entry.provider,
    model: entry.request.model,
    status: entry.status,
  });
});
```

### Built-in Log Callbacks

`@tepa/provider-core` exports two ready-made log handlers:

**`consoleLogCallback`** — Formats log entries for console output with timing and preview:

```typescript
import { consoleLogCallback } from "@tepa/provider-core";

const provider = new AnthropicProvider({ apiKey: "..." });
provider.onLog(consoleLogCallback);

// Output:
// [2026-03-12T10:30:00.000Z] anthropic success (1234ms) model=claude-haiku-4-5 tokens=150+200
```

**`createFileLogWriter`** — Creates a JSONL file writer for a custom path:

```typescript
import { createFileLogWriter } from "@tepa/provider-core";

const writer = createFileLogWriter("./custom-logs/anthropic.jsonl");
provider.onLog(writer.callback);

// Don't forget to close when done
writer.close();
```

### Accessing Log History

Providers accumulate log entries in memory. You can access them after a pipeline run:

```typescript
const result = await tepa.run(prompt);

// Get all log entries from this provider instance
const entries = provider.getLogEntries();
console.log(`Total LLM calls: ${entries.length}`);
console.log(`Retries: ${entries.filter((e) => e.status === "retry").length}`);

// Get the JSONL log file path
const logPath = provider.getLogFilePath();
console.log(`Full logs at: ${logPath}`);
```

### Privacy Controls

By default, log entries do **not** include the full message content or system prompt — only metadata like message count, character length, and a 120-character preview. Set `includeContent: true` to include full content:

```typescript
// Full content in logs (for debugging — not recommended in production)
const provider = new AnthropicProvider({
  apiKey: "...",
  includeContent: true,
});
```

When `includeContent` is `true`, the `request` object in each log entry includes `messages` (the full `LLMMessage[]` array) and `systemPrompt` (the full system prompt string). When `false` (the default), these fields are omitted.

## Base Provider

All built-in providers extend `BaseLLMProvider`, which handles retry logic, exponential backoff, rate limit detection, and logging. You don't use `BaseLLMProvider` directly — it's the foundation for built-in and custom providers.

### `BaseLLMProviderOptions`

```typescript
interface BaseLLMProviderOptions {
  maxRetries?: number; // Default: 3
  retryBaseDelayMs?: number; // Default: 1000
  defaultLog?: boolean; // Default: true
  logDir?: string; // Default: ".tepa/logs"
  includeContent?: boolean; // Default: false
}
```

### Retry Logic

When `complete()` is called, `BaseLLMProvider` wraps the actual API call in a retry loop:

1. Call `doComplete()` (the provider's actual implementation)
2. On success → log the entry, return the response
3. On error → check if retryable via `isRetryable(error)`
4. If not retryable → log and throw immediately
5. If retryable → calculate backoff delay and wait, then retry

The loop runs from attempt 0 through `maxRetries` (inclusive), so `maxRetries: 3` means up to 4 total attempts.

### Exponential Backoff

The backoff delay depends on whether the error is a rate limit:

| Error type       | Delay formula                       |
| ---------------- | ----------------------------------- |
| Transient error  | `retryBaseDelayMs * 2^attempt`      |
| Rate limit error | `retryBaseDelayMs * 30 * 2^attempt` |

If the API returns a `Retry-After` header (detected via `getRetryAfterMs()`), that value takes precedence over the calculated delay.

**Example with defaults** (`retryBaseDelayMs: 1000`):

| Attempt | Transient delay | Rate limit delay |
| ------- | --------------- | ---------------- |
| 0       | 1s              | 30s              |
| 1       | 2s              | 60s              |
| 2       | 4s              | 120s             |

## Creating a Custom Provider

To add a new LLM provider, extend `BaseLLMProvider` and implement four abstract methods:

```typescript
import { BaseLLMProvider } from "@tepa/provider-core";
import type { LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

class MyProvider extends BaseLLMProvider {
  protected providerName = "my-provider";

  constructor(options: { apiKey: string } & BaseLLMProviderOptions) {
    super(options);
    // Initialize your SDK client
  }

  protected async doComplete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    // Convert messages and options to your SDK's format
    // Make the API call
    // Convert the response to LLMResponse
    // Map finish reasons to the standard enum
    // Extract tool use blocks if present
  }

  protected isRetryable(error: unknown): boolean {
    // Return true for transient errors that should be retried
    // (network errors, 500s, etc.)
  }

  protected isRateLimitError(error: unknown): boolean {
    // Return true specifically for rate limit errors (429s)
    // Rate limits use a longer backoff multiplier
  }

  protected getRetryAfterMs(error: unknown): number | null {
    // Extract Retry-After header value from the error, if available
    // Return null if not present
  }
}
```

### What You Get for Free

By extending `BaseLLMProvider`, your custom provider automatically gets:

- **Retry loop** with exponential backoff and rate limit awareness
- **JSONL file logging** to `.tepa/logs/`
- **`onLog()` callback registration** for custom listeners
- **`getLogEntries()` and `getLogFilePath()`** for accessing log history
- **Privacy controls** via `includeContent`
- **Request metadata extraction** (message count, char length, preview)

### Implementation Tips

- **Tool schemas:** If your LLM supports native function calling, convert `ToolSchema[]` to the SDK's format in `doComplete()`. This keeps tool use working out of the box.
- **Finish reasons:** Map your SDK's finish reasons to the four standard values: `"end_turn"`, `"max_tokens"`, `"stop_sequence"`, `"tool_use"`.
- **Tool use detection:** Some SDKs (like Gemini and OpenAI) don't set a dedicated "tool_use" finish reason. Check the response for tool call structures and override the finish reason accordingly.
- **Synthetic IDs:** If the API doesn't assign IDs to tool calls (like Gemini), generate synthetic ones (`my-provider-call-0`, `my-provider-call-1`, ...).

### Minimal vs. Direct Implementation

If you don't need retry logic or logging, you can implement `LLMProvider` directly:

```typescript
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

const myProvider: LLMProvider = {
  async complete(messages, options) {
    // Make the API call and return an LLMResponse
  },
};
```

This skips all `BaseLLMProvider` features but satisfies the interface. Useful for testing, mocking, or wrapping a provider you've already built.

## What's Next

- [**Examples and Demos**](./09-examples-and-demos.md) — See providers in action across different use cases: autonomous code generation, data pipelines, and human-in-the-loop interaction.
