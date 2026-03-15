# LLM Providers

Tepa is LLM-agnostic. The `LLMProvider` interface is a single method — `complete()` — that abstracts away every provider-specific SDK, API shape, and authentication flow. Tepa ships with three built-in providers (Anthropic, OpenAI, Gemini), and you can add any other by extending `BaseLLMProvider`.

This section covers the provider interface, the three built-in providers and their options, native tool use, the provider logging system, and how to build a custom provider. For how providers fit into the broader package architecture, see [How Tepa Works — Package Architecture](./03-how-tepa-works.md#package-architecture).

---

## Provider Interface

All provider types live in `@tepa/types`. The core interface is intentionally minimal:

### `LLMProvider`

```typescript
interface LLMProvider {
  complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>;
}
```

A single method. The pipeline never touches provider SDKs directly — it only talks through this interface. This is why swapping providers is a one-line change and why a custom provider integrates without touching the core.

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

| Field   | Description                                                     |
| ------- | --------------------------------------------------------------- |
| `id`    | Provider-assigned ID for correlating tool calls with results.   |
| `name`  | Name of the tool the LLM wants to call.                         |
| `input` | Parsed input parameters — already an object, not a JSON string. |

The `input` field is pre-parsed by the provider. The Executor passes it directly to `tool.execute()` without any JSON parsing step.

---

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
  apiKey: process.env.ANTHROPIC_API_KEY, // omit to read from env automatically
});
```

**Options:**

| Option             | Type      | Default                     | Description                                    |
| ------------------ | --------- | --------------------------- | ---------------------------------------------- |
| `apiKey`           | `string`  | `ANTHROPIC_API_KEY` env var | API key for authentication.                    |
| `maxRetries`       | `number`  | `3`                         | Max retries on transient or rate-limit errors. |
| `retryBaseDelayMs` | `number`  | `1000`                      | Base delay in ms for exponential backoff.      |
| `defaultLog`       | `boolean` | `true`                      | Enable automatic JSONL file logging.           |
| `logDir`           | `string`  | `".tepa/logs"`              | Directory for log files.                       |
| `includeContent`   | `boolean` | `false`                     | Include full message content in logs.          |

**Retryable errors:** Rate limit (429), internal server error (500), connection errors, overloaded (529).

**Finish reason mapping:**

| Anthropic            | Tepa              |
| -------------------- | ----------------- |
| `"max_tokens"`       | `"max_tokens"`    |
| `"stop_sequence"`    | `"stop_sequence"` |
| `"tool_use"`         | `"tool_use"`      |
| `"end_turn"` / other | `"end_turn"`      |

---

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

| Option             | Type      | Default                  | Description                                    |
| ------------------ | --------- | ------------------------ | ---------------------------------------------- |
| `apiKey`           | `string`  | `OPENAI_API_KEY` env var | API key for authentication.                    |
| `maxRetries`       | `number`  | `3`                      | Max retries on transient or rate-limit errors. |
| `retryBaseDelayMs` | `number`  | `1000`                   | Base delay in ms for exponential backoff.      |
| `defaultLog`       | `boolean` | `true`                   | Enable automatic JSONL file logging.           |
| `logDir`           | `string`  | `".tepa/logs"`           | Directory for log files.                       |
| `includeContent`   | `boolean` | `false`                  | Include full message content in logs.          |

The OpenAI provider uses the **Responses API** (`client.responses.create()`), not the legacy Chat Completions API. System prompts are passed as a system-role input item, and tool calls are extracted from `FunctionCallOutput` items in the response.

**Retryable errors:** Rate limit (429), internal server error (500), connection errors.

**Finish reason mapping:**

| OpenAI               | Tepa           |
| -------------------- | -------------- |
| `"incomplete"`       | `"max_tokens"` |
| Tool calls in output | `"tool_use"`   |
| Other / null         | `"end_turn"`   |

---

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

| Option             | Type      | Default                                      | Description                                    |
| ------------------ | --------- | -------------------------------------------- | ---------------------------------------------- |
| `apiKey`           | `string`  | `GEMINI_API_KEY` or `GOOGLE_API_KEY` env var | API key for authentication.                    |
| `maxRetries`       | `number`  | `3`                                          | Max retries on transient or rate-limit errors. |
| `retryBaseDelayMs` | `number`  | `1000`                                       | Base delay in ms for exponential backoff.      |
| `defaultLog`       | `boolean` | `true`                                       | Enable automatic JSONL file logging.           |
| `logDir`           | `string`  | `".tepa/logs"`                               | Directory for log files.                       |
| `includeContent`   | `boolean` | `false`                                      | Include full message content in logs.          |

Gemini maps `"assistant"` roles to `"model"` and passes system prompts via the SDK's `systemInstruction` config field. Tool calls are extracted from `functionCall` parts in the response, with synthetic IDs (`gemini-call-0`, `gemini-call-1`, ...) since the Gemini API doesn't assign call IDs.

**Retryable errors:** Rate limit (429), server errors (5xx), connection errors. Non-retryable: 400, 401, 403, 404.

**Finish reason mapping:**

| Gemini                     | Tepa           |
| -------------------------- | -------------- |
| `"MAX_TOKENS"`             | `"max_tokens"` |
| Function calls in response | `"tool_use"`   |
| `"STOP"` / other           | `"end_turn"`   |

---

## Native Tool Use

All three providers use **native tool use** — the LLM's built-in function calling capability — rather than embedding tool descriptions in the prompt and parsing JSON from the response.

### How It Works

When a plan step declares tools, the Executor:

1. Builds tool schemas from the tool registry and passes them in `LLMRequestOptions.tools`
2. The provider converts `ToolSchema[]` to its SDK's native format
3. The LLM responds with structured tool call blocks instead of free-form text
4. The provider extracts tool calls into `LLMToolUseBlock[]` with pre-parsed parameters
5. The Executor invokes the tool directly with the parsed `input` object — no `JSON.parse` needed

### Why It Matters

Text-based tool calling requires the LLM to produce valid JSON inside its response, which is fragile:

- **Escaping errors** — large file contents with quotes, newlines, or special characters break JSON parsing
- **Format drift** — the LLM might wrap the JSON in markdown code fences or add commentary
- **Partial output** — token limits can truncate the JSON mid-object

Native tool use eliminates all of these. The provider SDK handles serialisation and the parameters arrive as a ready-to-use object. Every built-in provider uses this approach — there is no fallback to text parsing.

### Schema Conversion by Provider

Each provider converts `ToolSchema` to its SDK's expected format internally. You pass a single `ToolSchema[]` and the provider does the rest:

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

---

## Provider Logging System

Every provider built on `BaseLLMProvider` — including all three built-ins — automatically logs every LLM call to a JSONL file and optionally to custom listeners. This is one of Tepa's most useful operational features: a complete, structured audit trail of every request and response, available out of the box with zero configuration.

### Default File Logging

By default, each provider instance creates a JSONL log file at `.tepa/logs/llm-{timestamp}.jsonl`. Each line is one `LLMLogEntry`. This is enabled by default — disable it with `defaultLog: false` or move it with `logDir`:

```typescript
// Default: logs to .tepa/logs/llm-{timestamp}.jsonl
const provider = new AnthropicProvider({ apiKey: "..." });

// Disable file logging entirely
const provider = new AnthropicProvider({ apiKey: "...", defaultLog: false });

// Custom log directory
const provider = new AnthropicProvider({ apiKey: "...", logDir: "./my-logs" });
```

### `LLMLogEntry`

Every entry captures the full context of an LLM call:

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
    // Present on "success"
    text: string;
    tokensUsed: { input: number; output: number };
    finishReason: string;
    toolUseCount?: number;
  };
  error?: {
    // Present on "error" and "retry"
    message: string;
    retryable: boolean;
  };
}
```

A `"retry"` entry indicates the call failed but will be retried. A `"success"` entry includes the full response. An `"error"` entry indicates the final failure after all retries are exhausted.

### Accessing Logs After a Run

Providers accumulate entries in memory throughout a run. Access them via the provider instance after `tepa.run()` completes:

```typescript
const result = await tepa.run(prompt);

const entries = provider.getLogEntries();
console.log(`Total LLM calls: ${entries.length}`);
console.log(`Retries: ${entries.filter((e) => e.status === "retry").length}`);
console.log(`Failed: ${entries.filter((e) => e.status === "error").length}`);

// Path to the JSONL file on disk
const logPath = provider.getLogFilePath();
console.log(`Full logs at: ${logPath}`);
```

### Custom Log Listeners

Register custom callbacks with `onLog()` to process entries in real time — useful for streaming metrics to monitoring platforms or triggering alerts on errors:

```typescript
const provider = new AnthropicProvider({ apiKey: "..." });

// Alert on errors
provider.onLog((entry) => {
  if (entry.status === "error") {
    alertOncall(`LLM error: ${entry.error?.message}`);
  }
});

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

Multiple listeners can be registered. Each receives every log entry.

### Built-in Log Callbacks

`@tepa/provider-core` exports two ready-made handlers:

**`consoleLogCallback`** — Formats entries for console output with timing and preview:

```typescript
import { consoleLogCallback } from "@tepa/provider-core";

provider.onLog(consoleLogCallback);
// [2026-03-15T10:30:00.000Z] anthropic success (1234ms) model=claude-haiku-4-5 tokens=150+200
```

**`createFileLogWriter`** — Creates a JSONL writer for a custom path:

```typescript
import { createFileLogWriter } from "@tepa/provider-core";

const writer = createFileLogWriter("./custom-logs/anthropic.jsonl");
provider.onLog(writer.callback);
writer.close(); // Close when done
```

### Privacy Controls

By default, log entries do **not** include full message content or system prompts — only metadata: message count, character length, and a 120-character preview. Set `includeContent: true` to include full content for debugging:

```typescript
const provider = new AnthropicProvider({
  apiKey: "...",
  includeContent: true, // Not recommended in production
});
```

When `includeContent` is `true`, the `request` object includes the full `messages` array and `systemPrompt` string. When `false` (the default), these fields are omitted.

---

## Creating a Custom Provider

Adding a new LLM provider means extending `BaseLLMProvider` from `@tepa/provider-core` and implementing four methods. By extending rather than implementing `LLMProvider` directly, your provider gets retry logic, exponential backoff, rate limit handling, and the full logging system for free.

### The Four Methods

```typescript
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import type { LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

class MyProvider extends BaseLLMProvider {
  protected readonly providerName = "my-provider";

  constructor(options: { apiKey: string } & BaseLLMProviderOptions) {
    super(options);
    // Initialize your SDK client
  }

  // Required: make the API call, return a normalised LLMResponse
  protected async doComplete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    // Convert messages and options to your SDK's format
    // Make the API call
    // Map finish reasons to the standard enum
    // Extract tool use blocks if present
    // Return LLMResponse
  }

  // Required: true for transient errors that should be retried (500s, network errors)
  protected isRetryable(error: unknown): boolean { ... }

  // Required: true specifically for rate limit errors (gets 30x longer backoff)
  protected isRateLimitError(error: unknown): boolean { ... }

  // Required: extract Retry-After header value in ms, or return null
  protected getRetryAfterMs(error: unknown): number | null { ... }
}
```

`BaseLLMProvider` wraps `doComplete()` in the retry loop automatically — you implement the API call, the framework handles retrying it.

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

### Retry and Backoff Behaviour

The retry loop runs from attempt 0 through `maxRetries` inclusive — so `maxRetries: 3` means up to 4 total attempts. Backoff delay depends on error type:

| Error type       | Delay formula                       |
| ---------------- | ----------------------------------- |
| Transient error  | `retryBaseDelayMs × 2^attempt`      |
| Rate limit error | `retryBaseDelayMs × 30 × 2^attempt` |

If the API returns a `Retry-After` header (via `getRetryAfterMs()`), that value takes precedence over the calculated delay.

**Example with defaults** (`retryBaseDelayMs: 1000`):

| Attempt | Transient delay | Rate limit delay |
| ------- | --------------- | ---------------- |
| 0       | 1s              | 30s              |
| 1       | 2s              | 60s              |
| 2       | 4s              | 120s             |

### Key Implementation Notes

- **Tool schemas** — if your LLM supports native function calling, convert `ToolSchema[]` to the SDK's format in `doComplete()`. See [Native Tool Use](#native-tool-use) above for the conversion patterns used by the built-in providers.
- **Finish reasons** — map your SDK's stop reasons to the four standard values: `"end_turn"`, `"max_tokens"`, `"stop_sequence"`, `"tool_use"`. Some SDKs don't set a dedicated tool-use finish reason — detect tool calls in the response and override the reason accordingly.
- **Synthetic IDs** — if the API doesn't assign IDs to tool calls (like Gemini), generate them: `my-provider-call-0`, `my-provider-call-1`, etc.

### Minimal Provider (Without BaseLLMProvider)

If you don't need retry logic or logging, implement `LLMProvider` directly:

```typescript
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

const myProvider: LLMProvider = {
  async complete(messages, options): Promise<LLMResponse> {
    // Make the API call and return an LLMResponse
  },
};
```

Useful for testing, mocking, or wrapping a provider you've already built with its own retry logic.

### Publishing as an npm Package

To share a provider with the community, publish it as a standalone package. Only `@tepa/types` and `@tepa/provider-core` are needed as dependencies — no dependency on `@tepa/core` or `@tepa/tools`:

```bash
mkdir tepa-provider-myllm
cd tepa-provider-myllm
npm init -y
npm install @tepa/types @tepa/provider-core
npm install -D typescript tsup
```

For the complete scaffolding walkthrough — recommended project structure, `formatting.ts` conversion helpers, factory function pattern, test setup, and publish steps — see the [Contributing Guide](./10-contributing.md#how-to-create-a-custom-llm-provider).

---

## What's Next

- [**Examples and Demos**](./09-examples-and-demos.md) — See providers in action across different use cases: autonomous code generation, data pipelines, and human-in-the-loop interaction.
- [**Contributing**](./10-contributing.md) — Full scaffolding guide for publishing providers and tools as community packages.
- [**API Reference**](./11-api-reference.md) — Complete interface definitions for `LLMProvider`, `BaseLLMProvider`, and all related types.
