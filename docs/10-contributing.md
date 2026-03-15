# Contributing

Tepa is an open-source monorepo. Contributions are welcome — whether you're publishing a community tool or provider package, fixing a bug in the core pipeline, improving documentation, or opening an issue.

Tepa's core repository is intentionally lean. It ships only the essential built-in tools and LLM providers that the majority of users need. Rather than growing the monorepo with every possible integration, the community is encouraged to **build and publish tools and providers as independent npm packages**. This keeps the core lightweight and fosters a wider ecosystem where anyone can contribute without needing to modify this repository.

## Where to Start

| What you want to do | Where to go |
|---|---|
| Publish a custom tool as an npm package | [How to Create a Custom Tool](#how-to-create-a-custom-tool) |
| Publish a custom LLM provider as an npm package | [How to Create a Custom LLM Provider](#how-to-create-a-custom-llm-provider) |
| Fix a bug, improve the core, update docs | [Development Setup](#development-setup) → [Pull Request Guidelines](#pull-request-guidelines) |
| Report a bug or request a feature | [Issue Reporting](#issue-reporting) |

---

## How to Create a Custom Tool

The recommended way to extend Tepa's tool set is to publish a standalone npm package. A tool is just an object satisfying the `ToolDefinition` interface from `@tepa/types` — no dependency on the core repo is needed.

For the conceptual overview and quick-start, see [Tool System](./06-tool-system.md). This section is the complete scaffolding walkthrough.

### 1. Scaffold Your Package

```bash
mkdir tepa-tool-redis-cache
cd tepa-tool-redis-cache
npm init -y
npm install @tepa/types @tepa/tools
npm install -D typescript tsup vitest
```

You need `@tepa/types` for the `ToolDefinition` interface and `@tepa/tools` for the `defineTool` helper that validates your schema at creation time.

Recommended project structure:

```
tepa-tool-redis-cache/
├── src/
│   └── index.ts        # Tool definition(s)
├── tests/
│   └── index.test.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### 2. Define the Tool

Create `src/index.ts`. Write descriptions that tell the LLM exactly what the tool does, what inputs to provide, and what to expect back — the quality of your descriptions directly affects how well the Planner assigns your tool and how reliably the Executor calls it. See [Writing Good Tool Descriptions](./06-tool-system.md#writing-good-tool-descriptions) for guidance.

```typescript
import { defineTool } from "@tepa/tools";

export const redisCacheTool = defineTool({
  name: "redis_cache",
  description:
    "Read and write string values in a Redis cache by key. " +
    "Use 'get' to retrieve a cached value and 'set' to store one with an optional TTL. " +
    "Returns the stored value on get, or a confirmation on set.",
  parameters: {
    operation: {
      type: "string",
      description: "The cache operation to perform: 'get' to read a value, 'set' to write one.",
      required: true,
    },
    key: {
      type: "string",
      description: "The cache key to read from or write to. Use descriptive keys like 'user:123:profile'.",
      required: true,
    },
    value: {
      type: "string",
      description: "The value to store. Required when operation is 'set'. Omit for 'get'.",
    },
    ttl: {
      type: "number",
      description: "Time-to-live in seconds before the key expires. Only applies to 'set'. Default: 3600.",
      default: 3600,
    },
  },
  execute: async (params) => {
    const operation = params.operation as string;
    const key = params.key as string;
    const value = params.value as string | undefined;
    const ttl = (params.ttl as number) ?? 3600;

    // Implement Redis logic here using your preferred client
    if (operation === "set") {
      await redis.set(key, value, "EX", ttl);
      return { status: "ok", key };
    }

    const result = await redis.get(key);
    return { key, value: result };
  },
});
```

**Key rules:**

- Tool names use `snake_case`
- Parameter types: `"string"`, `"number"`, `"boolean"`, `"object"`, `"array"`
- `execute` receives `Record<string, unknown>` — cast parameters to their expected types
- `execute` must return a serializable value — it becomes part of the pipeline's execution result
- `defineTool` validates the schema at creation time using Zod; errors surface immediately

### 3. Configure Build

`tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`tsup.config.ts`:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
```

### 4. Write Tests

```typescript
import { describe, it, expect, vi } from "vitest";
import { redisCacheTool } from "../src/index.js";

describe("redisCacheTool", () => {
  it("has correct metadata", () => {
    expect(redisCacheTool.name).toBe("redis_cache");
    expect(redisCacheTool.parameters.key.required).toBe(true);
    expect(redisCacheTool.parameters.operation.required).toBe(true);
  });

  it("executes a get operation", async () => {
    // Mock your Redis client before testing execute()
    const result = await redisCacheTool.execute({
      operation: "get",
      key: "test-key",
    });
    expect(result).toBeDefined();
  });
});
```

### 5. Publish to npm

```bash
npm run build
npm publish
```

### 6. Use It with Tepa

```bash
npm install @tepa/core @tepa/tools @tepa/provider-anthropic tepa-tool-redis-cache
```

```typescript
import { Tepa } from "@tepa/core";
import { AnthropicProvider } from "@tepa/provider-anthropic";
import { fileReadTool, fileWriteTool } from "@tepa/tools";
import { redisCacheTool } from "tepa-tool-redis-cache";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, redisCacheTool],
});
```

Any `ToolDefinition` works — Tepa doesn't distinguish between built-in and community tools. The Planner sees your tool in its schema list and assigns it to steps; the Executor invokes it identically to any built-in.

---

## How to Create a Custom LLM Provider

Like tools, the recommended way to add LLM provider support is to publish a standalone npm package. Every provider extends `BaseLLMProvider` from `@tepa/provider-core`, which gives you retry logic, exponential backoff, rate limit handling, and the full logging system for free.

For the interface contract and key implementation notes, see [LLM Providers](./08-llm-providers.md). This section is the complete scaffolding walkthrough.

### 1. Scaffold Your Package

```bash
mkdir tepa-provider-myllm
cd tepa-provider-myllm
npm init -y
npm install @tepa/types @tepa/provider-core myllm-sdk
npm install -D typescript tsup vitest
```

Recommended project structure:

```
tepa-provider-myllm/
├── src/
│   ├── myllm.ts          # Provider class extending BaseLLMProvider
│   ├── formatting.ts     # Message/tool format conversion helpers
│   ├── factory.ts        # createProvider() factory function
│   └── index.ts          # Public exports
├── tests/
│   └── myllm.test.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### 2. Implement the Provider

Extend `BaseLLMProvider` and implement four methods. You only implement the API call — the framework handles retrying it:

```typescript
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import type { LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";
import { toMyLLMMessages, toMyLLMTools, extractText, extractToolUse, mapFinishReason } from "./formatting.js";

export interface MyLLMProviderOptions extends BaseLLMProviderOptions {
  apiKey?: string;
}

export class MyLLMProvider extends BaseLLMProvider {
  protected readonly providerName = "myllm";
  private readonly client: MyLLMClient;

  constructor(options: MyLLMProviderOptions = {}) {
    super(options);
    this.client = new MyLLMClient({
      apiKey: options.apiKey ?? process.env.MYLLM_API_KEY,
    });
  }

  // Core method — make the API call and return a normalised LLMResponse
  protected async doComplete(
    messages: LLMMessage[],
    options: LLMRequestOptions,
  ): Promise<LLMResponse> {
    const response = await this.client.chat({
      model: options.model ?? "myllm-default",
      messages: toMyLLMMessages(messages),
      tools: options.tools ? toMyLLMTools(options.tools) : undefined,
      system: options.systemPrompt,
      max_tokens: options.maxTokens,
    });

    return {
      text: extractText(response),
      tokensUsed: {
        input: response.usage.inputTokens,
        output: response.usage.outputTokens,
      },
      finishReason: mapFinishReason(response.stopReason),
      ...(hasToolCalls(response) && {
        toolUse: extractToolUse(response),
      }),
    };
  }

  // Return true for transient errors worth retrying (500s, network errors)
  protected isRetryable(error: unknown): boolean {
    return error instanceof MyLLMServerError || error instanceof MyLLMConnectionError;
  }

  // Return true specifically for rate limit errors — gets 30x longer backoff
  protected isRateLimitError(error: unknown): boolean {
    return error instanceof MyLLMRateLimitError;
  }

  // Extract Retry-After header value in ms, or return null if not present
  protected getRetryAfterMs(error: unknown): number | null {
    if (error instanceof MyLLMAPIError) {
      const retryAfter = error.headers?.["retry-after"];
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
      }
    }
    return null;
  }
}
```

### 3. Add Format Conversion Helpers

Create `src/formatting.ts` to translate between Tepa's normalised types and your provider's API format. Five helpers are needed:

**`toMyLLMMessages(messages: LLMMessage[])`** — Convert Tepa's `{ role, content }` pairs to your SDK's message format. Map `"assistant"` to whatever your SDK calls the model role.

**`toMyLLMTools(tools: ToolSchema[])`** — Convert Tepa tool schemas to your provider's function/tool format. Tepa's schema uses lowercase types (`"string"`, `"object"`) — some SDKs expect uppercase (`"STRING"`, `"OBJECT"`). See [LLM Providers — Schema Conversion by Provider](./08-llm-providers.md#schema-conversion-by-provider) for the exact format each built-in provider produces — use the closest one as a reference for your own.

**`extractText(response)`** — Pull the text content from your SDK's response object.

**`extractToolUse(response)`** — Convert tool call blocks from your SDK's format into `LLMToolUseBlock[]`:
```typescript
// Target shape:
interface LLMToolUseBlock {
  id: string;    // Use a synthetic ID if your SDK doesn't provide one: "myllm-call-0"
  name: string;  // Tool name the LLM wants to call
  input: Record<string, unknown>; // Pre-parsed parameters — not a JSON string
}
```

**`mapFinishReason(reason)`** — Map your SDK's stop reason to Tepa's standard enum:
```typescript
// Valid values: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
function mapFinishReason(reason: string): LLMResponse["finishReason"] {
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (hasToolCalls) return "tool_use"; // Some SDKs don't set a dedicated reason
  return "end_turn";
}
```

Note: the standard values are `"end_turn"`, `"tool_use"`, `"max_tokens"`, and `"stop_sequence"` — not `"stop"`. Using `"stop"` will cause the Executor to mishandle the finish reason.

### 4. Export a Factory

Create `src/factory.ts`:

```typescript
import { MyLLMProvider, type MyLLMProviderOptions } from "./myllm.js";

export function createProvider(identifier: string, options?: MyLLMProviderOptions) {
  if (identifier !== "myllm") {
    throw new Error(`Unknown provider: ${identifier}`);
  }
  return new MyLLMProvider(options);
}
```

### 5. Wire Up Exports

`src/index.ts`:

```typescript
export { MyLLMProvider, type MyLLMProviderOptions } from "./myllm.js";
export { createProvider } from "./factory.js";
```

### 6. Write Tests

```typescript
import { describe, it, expect, vi } from "vitest";
import { MyLLMProvider } from "../src/index.js";

describe("MyLLMProvider", () => {
  it("returns a normalised response", async () => {
    // Mock your SDK client
    const provider = new MyLLMProvider({ apiKey: "test-key" });
    const response = await provider.complete(
      [{ role: "user", content: "Hello" }],
      { model: "myllm-default" },
    );
    expect(response.finishReason).toBe("end_turn");
    expect(response.tokensUsed.input).toBeGreaterThan(0);
  });

  it("maps tool use finish reason correctly", async () => {
    // Mock a tool-use response from the SDK
    const provider = new MyLLMProvider({ apiKey: "test-key" });
    const response = await provider.complete(
      [{ role: "user", content: "Call a tool" }],
      { model: "myllm-default", tools: [/* mock schema */] },
    );
    expect(response.finishReason).toBe("tool_use");
    expect(response.toolUse).toBeDefined();
    expect(response.toolUse?.length).toBeGreaterThan(0);
  });
});
```

### 7. Publish and Use

```bash
npm run build
npm publish
```

```bash
npm install @tepa/core @tepa/tools tepa-provider-myllm
```

```typescript
import { Tepa } from "@tepa/core";
import { MyLLMProvider } from "tepa-provider-myllm";
import { fileReadTool, shellExecuteTool } from "@tepa/tools";

const tepa = new Tepa({
  provider: new MyLLMProvider({ apiKey: process.env.MYLLM_API_KEY }),
  tools: [fileReadTool, shellExecuteTool],
});
```

Any class extending `BaseLLMProvider` or directly implementing `LLMProvider` works — Tepa treats community providers identically to its own built-ins.

---

## Development Setup

This section is for contributors working on the core pipeline, built-in tools, built-in providers, documentation, or bug fixes. If you're publishing an external package, you don't need this — see the sections above.

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9 (ships with Node 18+)
- **Git**

### Fork and Clone

1. **Fork** the repository on GitHub — click "Fork" on [the repo page](https://github.com/frandi/tepa-ai)
2. **Clone your fork** and set up the upstream remote:

```bash
git clone https://github.com/<your-username>/tepa-ai.git
cd tepa-ai
git remote add upstream https://github.com/frandi/tepa-ai.git
npm install
```

`npm install` at the root installs dependencies for all packages via npm workspaces. No separate install steps are needed for individual packages.

Before starting work, sync with the latest upstream:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

### Build

```bash
# Build all packages (respects dependency order)
npm run build

# Smart build — only rebuilds changed packages and their dependents
./build.sh

# Force rebuild everything
./build.sh --all
```

Each package uses [tsup](https://tsup.egoist.dev/) to produce dual ESM/CJS output with TypeScript declarations. The smart build script detects which packages changed since your last commit and rebuilds only those, plus any downstream dependents.

### Test

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch

# Run tests for a specific package
npm test -- packages/tools
npm test -- packages/tepa
```

Tests use [Vitest](https://vitest.dev/) with a workspace configuration covering `@tepa/core`, `@tepa/tools`, `@tepa/provider-core`, `@tepa/provider-anthropic`, and `@tepa/provider-openai`.

### Lint and Format

```bash
npm run lint       # ESLint
npm run format     # Prettier (auto-fix)
```

### Monorepo Structure

```
tepa-ai/
├── packages/
│   ├── types/                  # @tepa/types — shared interfaces, zero deps
│   ├── tepa/                   # @tepa/core — pipeline orchestrator
│   ├── tools/                  # @tepa/tools — built-in tool kit
│   ├── provider-core/          # @tepa/provider-core — base provider + logging
│   ├── provider-anthropic/     # @tepa/provider-anthropic
│   ├── provider-openai/        # @tepa/provider-openai
│   └── provider-gemini/        # @tepa/provider-gemini
├── demos/
│   ├── api-client-gen/         # Autonomous code generation demo
│   ├── student-progress/       # Data analysis demo
│   └── study-plan/             # Human-in-the-loop demo
├── build.sh                    # Smart incremental build script
├── vitest.workspace.ts         # Test workspace config
├── tsconfig.base.json          # Shared TypeScript config
└── package.json                # Root workspace config
```

**Dependency flow:**

```
@tepa/types (zero deps)
    ↑
    ├── @tepa/core
    ├── @tepa/tools
    └── @tepa/provider-core
            ↑
            ├── @tepa/provider-anthropic
            ├── @tepa/provider-openai
            └── @tepa/provider-gemini
```

`@tepa/types` is the foundation. Core, tools, and provider-core are siblings — none depends on the others, only on `@tepa/types`. This is why you can swap providers and tools without touching the core.

---

## Code Conventions

Tepa uses strict TypeScript with ESLint and Prettier enforcement.

**TypeScript:**

- Target: ES2022, module resolution: `bundler`
- `strict: true` — no implicit any, strict null checks
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`
- `noUnusedLocals` and `noUnusedParameters` enabled
- Use `.js` extensions in import paths (required for ESM resolution)

**Style:**

- 2-space indentation
- Double quotes (`"`)
- Semicolons required
- Trailing commas in multiline structures
- 100-character line width
- No `any` types — use proper interfaces from `@tepa/types`
- Prefix intentionally unused parameters with `_` (e.g., `_context`)

Run `npm run lint` and `npm run format` before committing. Both are enforced by the ESLint and Prettier configs at the repo root.

---

## Pull Request Guidelines

PRs to this repository should focus on the core pipeline, existing built-in tools and providers, documentation, and bug fixes. For new tools and providers, publish them as external packages — submit a PR here only if you believe the addition is broadly essential to the community.

1. **Fork the repo** and clone your fork (see [Fork and Clone](#fork-and-clone) above)
2. **Create a branch from `main`** with a descriptive name: `fix/executor-timeout`, `feat/evaluator-confidence-threshold`, `docs/event-patterns`
3. **One concern per PR** — a bug fix, a core enhancement, and a docs update should be separate PRs
4. **Write tests** — bug fixes should include a regression test when practical; pipeline changes need unit tests
5. **Run the full check before pushing:**
   ```bash
   npm run build && npm test && npm run lint
   ```
6. **Push and open a PR** against `main` on the upstream repo:
   ```bash
   git push origin your-branch-name
   ```
7. **Write a clear commit message** — summarise the what and why, use the imperative mood:
   ```
   Fix executor skipping steps when upstream returns empty output
   Add confidence threshold option to evaluator config
   Update event system docs with cleanup pattern
   ```
8. **Keep the PR description concise** — what changed, why, how to test it, linked issues if applicable

See [Pull Request Example](contributing/pull-request-example.md) for a filled-in template.

---

## Issue Reporting

When filing a bug report, include:

- **What you expected** vs. **what happened**
- **Minimal reproduction** — a prompt file + entry script that triggers the issue, or a failing test
- **Environment** — Node.js version, package versions (`npm ls @tepa/core`), OS
- **Logs** — set `logging.level` to `"verbose"` in your config and include the relevant output; if the issue involves LLM responses, check `.tepa/logs/` for the JSONL request/response log

For feature requests, describe the use case first, then the proposed solution. This helps the maintainers understand whether the feature fits the framework's scope before implementation detail is discussed.

See filled-in examples:

- [Bug Report Example](contributing/bug-report-example.md)
- [Feature Request Example](contributing/feature-request-example.md)
