# @tepa/provider-gemini

Google Gemini LLM provider for the Tepa agent pipeline. Uses the [@google/genai](https://www.npmjs.com/package/@google/genai) SDK.

## Install

```bash
npm install @tepa/provider-gemini
```

## Setup

Set your Gemini API key as an environment variable:

```bash
export GEMINI_API_KEY=...
```

Or use `GOOGLE_API_KEY`, or pass it directly in the constructor.

## Usage

```typescript
import { Tepa } from "@tepa/core";
import { GeminiProvider } from "@tepa/provider-gemini";

const tepa = new Tepa({
  tools: [
    /* ... */
  ],
  provider: new GeminiProvider(),
});
```

### Provider Options

```typescript
const provider = new GeminiProvider({
  apiKey: "...", // Defaults to GEMINI_API_KEY or GOOGLE_API_KEY env var
  maxRetries: 3, // Default: 3
  retryBaseDelayMs: 1000, // Base delay for exponential backoff
});
```

## Logging

Every LLM call is automatically logged to a JSONL file in `.tepa/logs/`. You can also pass a `TepaLogger` (e.g., pino, winston) for unified human-readable log output alongside your application:

```typescript
import pino from "pino";

const logger = pino({ level: "debug" });
const provider = new GeminiProvider({ logger });
```

For structured log callbacks, use `onLog()` to add custom listeners or send logs to external services:

```typescript
const provider = new GeminiProvider({ defaultLog: false });

provider.onLog((entry) => {
  externalLogger.send(entry);
});
```

See [`@tepa/provider-core`](../provider-core) for full logging documentation.

## Native Tool Use

This provider supports native tool calling via Gemini's function calling API. When tool schemas are passed via `options.tools`, they are forwarded as function declarations. The LLM returns structured `functionCall` parts with pre-parsed parameters, eliminating text-based JSON parsing errors.
