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
  maxRetries: 3,               // retry attempts on transient failures
  timeout: 60_000,             // request timeout in ms
});
```

### Factory Function

Use `createProvider` to create providers from a string identifier:

```typescript
import { createProvider } from "@tepa/provider-anthropic";

const provider = createProvider("anthropic");
// Future: createProvider("openai"), createProvider("gemini"), etc.
```

## Implementing Custom Providers

To support a different LLM, implement the `LLMProvider` interface from `@tepa/types`:

```typescript
import type { LLMProvider, LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

export class MyProvider implements LLMProvider {
  async complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse> {
    // Call your LLM API
    return {
      text: "response text",
      tokensUsed: { input: 100, output: 50 },
      finishReason: "end_turn",
    };
  }
}
```

The provider interface is intentionally minimal — one method, clear input/output types. Future providers (`@tepa/provider-openai`, `@tepa/provider-gemini`) follow the same pattern.
