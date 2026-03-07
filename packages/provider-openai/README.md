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
