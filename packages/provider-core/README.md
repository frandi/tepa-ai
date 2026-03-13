# @tepa/provider-core

Base LLM provider with centralized retry logic and structured per-call logging. All built-in providers (`@tepa/provider-anthropic`, `@tepa/provider-openai`, `@tepa/provider-gemini`) extend `BaseLLMProvider` from this package.

## Install

```bash
npm install @tepa/provider-core
```

## Base Provider Options

All providers that extend `BaseLLMProvider` accept these options:

```typescript
const provider = new AnthropicProvider({
  maxRetries: 3, // retry attempts on transient failures (default: 3)
  retryBaseDelayMs: 1000, // base delay for exponential backoff (default: 1000)
  defaultLog: true, // enable file logging (default: true)
  logDir: ".tepa/logs", // directory for log files (default: ".tepa/logs")
  includeContent: false, // include full message content in logs (default: false)
});
```

## Logging

Every LLM call is automatically logged as a structured `LLMLogEntry` containing provider name, status, duration, token usage, model, and a prompt preview.

### Default File Logging

By default, logs are written as JSONL to `.tepa/logs/llm-<timestamp>.jsonl`. Each line is a JSON object:

```jsonl
{
  "timestamp": "2026-03-09T10:00:00.000Z",
  "provider": "anthropic",
  "status": "success",
  "durationMs": 1200,
  "attempt": 0,
  "request": {
    "model": "claude-sonnet-4-20250514",
    "messageCount": 3,
    "totalCharLength": 850,
    "promptPreview": "Generate a project plan...",
    "hasSystemPrompt": true
  },
  "response": {
    "text": "Here is the plan...",
    "tokensUsed": {
      "input": 200,
      "output": 150
    },
    "finishReason": "end_turn"
  }
}
```

You can customize the log directory or disable file logging entirely:

```typescript
// Custom log directory
const provider = new AnthropicProvider({ logDir: "./my-logs" });

// Disable file logging
const provider = new AnthropicProvider({ defaultLog: false });
```

### Custom Log Listeners

Use `onLog()` to add custom log listeners. This works alongside or instead of the default file logger:

```typescript
// Add a listener alongside the default file logger
const provider = new AnthropicProvider();
provider.onLog((entry) => {
  myMetricsService.recordLatency(entry.durationMs);
});
```

### Sending Logs to External Providers

To send logs to an external observability service (Prometheus, NewRelic, Datadog, etc.), disable the default file logger and register your own callback:

```typescript
import { AnthropicProvider } from "@tepa/provider-anthropic";

const provider = new AnthropicProvider({ defaultLog: false });

provider.onLog((entry) => {
  newrelicClient.recordCustomEvent("LLMCall", {
    provider: entry.provider,
    model: entry.request.model,
    status: entry.status,
    durationMs: entry.durationMs,
    inputTokens: entry.response?.tokensUsed.input,
    outputTokens: entry.response?.tokensUsed.output,
    error: entry.error?.message,
  });
});
```

You can also register multiple listeners:

```typescript
const provider = new AnthropicProvider({ defaultLog: false });

// Send metrics to Prometheus
provider.onLog((entry) => {
  llmDurationHistogram.observe({ provider: entry.provider }, entry.durationMs);
  if (entry.status === "error") llmErrorCounter.inc({ provider: entry.provider });
});

// Also log to console for local debugging
import { consoleLogCallback } from "@tepa/provider-core";
provider.onLog(consoleLogCallback);
```

### Built-in Log Callbacks

| Export                  | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `consoleLogCallback`    | Prints a human-readable summary to `console.log`              |
| `createFileLogWriter()` | Creates a JSONL file writer (used internally by `defaultLog`) |

### Accessing Log History

All log entries are kept in memory and can be retrieved:

```typescript
const entries = provider.getLogEntries(); // all entries as an array
const logFile = provider.getLogFilePath(); // path to JSONL file (if file logging enabled)
```

### LLMLogEntry Shape

```typescript
interface LLMLogEntry {
  timestamp: string;
  provider: string;
  status: "success" | "retry" | "error";
  durationMs: number;
  attempt: number;
  request: {
    model: string;
    messageCount: number;
    totalCharLength: number;
    promptPreview: string;
    hasSystemPrompt: boolean;
    hasTools?: boolean; // true when tool schemas were passed
    maxTokens?: number;
    temperature?: number;
    messages?: LLMMessage[]; // only when includeContent: true
    systemPrompt?: string; // only when includeContent: true
  };
  response?: {
    text: string;
    tokensUsed: { input: number; output: number };
    finishReason: string;
    toolUseCount?: number; // number of tool calls in the response
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}
```

## Extending BaseLLMProvider

To create a custom provider with built-in retry and logging support:

```typescript
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import type { LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

export class MyProvider extends BaseLLMProvider {
  protected readonly providerName = "my-provider";

  constructor(options?: BaseLLMProviderOptions) {
    super(options);
  }

  protected async doComplete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    // Call your LLM API here
    return { text: "...", tokensUsed: { input: 0, output: 0 }, finishReason: "end_turn" };
  }

  protected isRetryable(error: unknown): boolean {
    return false;
  }

  protected getRetryAfterMs(error: unknown): number | null {
    return null;
  }

  protected isRateLimitError(error: unknown): boolean {
    return false;
  }
}
```

Custom providers automatically get file logging, retry logic, and `onLog()` support.
