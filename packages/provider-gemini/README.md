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
import { Tepa } from "tepa";
import { GeminiProvider } from "@tepa/provider-gemini";

const tepa = new Tepa({
  tools: [/* ... */],
  provider: new GeminiProvider(),
});
```

### Provider Options

```typescript
const provider = new GeminiProvider({
  apiKey: "...",            // Defaults to GEMINI_API_KEY or GOOGLE_API_KEY env var
  maxRetries: 3,            // Default: 3
  retryBaseDelayMs: 1000,   // Base delay for exponential backoff
});
```
