# @tepa/provider-anthropic

Anthropic Claude LLM provider for the Tepa agent pipeline.

## Install

```bash
npm install @tepa/provider-anthropic
```

## Setup

Set the `ANTHROPIC_API_KEY` environment variable. You can either export it directly:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or use a `.env` file with [dotenv](https://www.npmjs.com/package/dotenv):

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

```typescript
import "dotenv/config";
```

## Usage

```typescript
import { Tepa } from "tepa";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  tools: [/* ... */],
  provider: new AnthropicProvider(),
});
```

### Provider Options

```typescript
const provider = new AnthropicProvider({
  apiKey: "sk-ant-...",        // defaults to ANTHROPIC_API_KEY env var
  maxRetries: 3,               // retry attempts on transient failures (default: 3)
  retryBaseDelayMs: 1000,      // base delay for exponential backoff (default: 1000)
});
```

### Factory Function

Use `createProvider` to create providers from a string identifier:

```typescript
import { createProvider } from "@tepa/provider-anthropic";

const provider = createProvider("anthropic");
```

## Logging

Every LLM call is automatically logged to a JSONL file in `.tepa/logs/`. You can disable the default file logger, add custom log listeners, or send logs to external services like Prometheus, NewRelic, or Datadog using the `onLog()` method:

```typescript
const provider = new AnthropicProvider({ defaultLog: false });

provider.onLog((entry) => {
  externalLogger.send(entry);
});
```

See [`@tepa/provider-core`](../provider-core) for full logging documentation.

## Other Providers

Tepa ships with multiple LLM providers — all following the same `LLMProvider` interface:

- [`@tepa/provider-gemini`](../provider-gemini) — Google Gemini
- [`@tepa/provider-openai`](../provider-openai) — OpenAI

## Implementing Custom Providers

To support a different LLM, implement the `LLMProvider` interface from `@tepa/types`:

```typescript
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

export class MyProvider implements LLMProvider {
  async complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse> {
    // Call your LLM API, passing options.tools if provided
    return {
      text: "response text",
      tokensUsed: { input: 100, output: 50 },
      finishReason: "end_turn",
    };
  }
}
```

The provider interface is intentionally minimal — one method, clear input/output types.

## Native Tool Use

All built-in providers support **native tool use**. When the executor passes tool schemas via `options.tools`, the provider forwards them to the LLM's native function-calling API. The LLM returns structured `toolUse` blocks with pre-parsed parameters — no manual JSON parsing needed. This eliminates escaping errors that occur when LLMs produce tool parameters as free-form text, especially with large content like file writes.
