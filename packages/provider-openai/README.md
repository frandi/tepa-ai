# @tepa/provider-openai

OpenAI LLM provider for the Tepa agent pipeline. Uses the [Responses API](https://platform.openai.com/docs/api-reference/responses).

## Install

```bash
npm install @tepa/provider-openai
```

## Setup

Set your OpenAI API key as an environment variable:

```bash
export OPENAI_API_KEY=sk-...
```

Or use a `.env` file in your project root.

## Usage

```typescript
import { Tepa } from "tepa";
import { OpenAIProvider } from "@tepa/provider-openai";

const tepa = new Tepa({
  tools: [/* ... */],
  provider: new OpenAIProvider(),
});
```

### Provider Options

```typescript
const provider = new OpenAIProvider({
  apiKey: "sk-...",       // Defaults to OPENAI_API_KEY env var
  maxRetries: 3,          // Default: 3
  retryBaseDelayMs: 1000, // Base delay for exponential backoff
});
```

## Logging

Every LLM call is automatically logged to a JSONL file in `.tepa/logs/`. You can disable the default file logger, add custom log listeners, or send logs to external services like Prometheus, NewRelic, or Datadog using the `onLog()` method:

```typescript
const provider = new OpenAIProvider({ defaultLog: false });

provider.onLog((entry) => {
  externalLogger.send(entry);
});
```

See [`@tepa/provider-core`](../provider-core) for full logging documentation.

## Native Tool Use

This provider supports native tool calling via the OpenAI Responses API. When tool schemas are passed via `options.tools`, they are forwarded as function definitions. The LLM returns structured `function_call` blocks with pre-parsed parameters, eliminating text-based JSON parsing errors.

### Implementing Custom Providers

Any object implementing the `LLMProvider` interface from `@tepa/types` can be used:

```typescript
import type { LLMProvider } from "@tepa/types";

class MyProvider implements LLMProvider {
  async complete(messages, options) {
    // Your implementation
  }
}
```
