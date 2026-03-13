# Contributing

Tepa is an open-source monorepo. Contributions are welcome — whether it's fixing a bug, improving the core pipeline, or enhancing documentation. This guide covers the development setup, code conventions, and the patterns to follow when extending the framework.

Tepa's core repository is intentionally lean. It ships only the essential built-in tools and LLM providers that the majority of users need. Rather than growing the monorepo with every possible integration, we encourage the community to **build and publish tools and providers as independent npm packages**. This keeps the core lightweight, reduces maintenance burden, and fosters a wider ecosystem where anyone can contribute without needing to modify this repository.

If you believe a tool or provider is essential enough to live in the core — because the community broadly needs it and it fits the framework's scope — feel free to open an issue or submit a PR. We're happy to discuss it. But for most cases, publishing your own package is the faster and more flexible path.

We plan to highlight interesting community tools and providers through our future communication channels.

## Development Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9 (ships with Node 18+)
- **Git**

### Fork and Clone

1. **Fork** the repository on GitHub by clicking the "Fork" button on [the repo page](https://github.com/frandi/tepa-ai)
2. **Clone your fork** locally and set up the upstream remote:

```bash
git clone https://github.com/<your-username>/tepa-ai.git
cd tepa-ai
git remote add upstream https://github.com/frandi/tepa-ai.git
npm install
```

`npm install` at the root installs dependencies for all packages via npm workspaces. No separate install steps are needed for individual packages.

Before starting work, sync your fork with the latest upstream changes:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

### Build

```bash
# Build all packages (respects dependency order)
npm run build

# Or use the smart build script (only rebuilds changed packages)
./build.sh

# Force rebuild everything
./build.sh --all
```

Each package uses [tsup](https://tsup.egoist.dev/) to produce dual ESM/CJS output with TypeScript declarations. The build script detects which packages changed since your last commit and rebuilds only those, plus any downstream dependents.

### Test

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# Run tests for a specific package
npm test -- packages/tools
npm test -- packages/tepa
```

Tests use [Vitest](https://vitest.dev/) with a workspace configuration that covers `@tepa/core`, `@tepa/tools`, `@tepa/provider-core`, `@tepa/provider-anthropic`, and `@tepa/provider-openai`.

### Lint and Format

```bash
npm run lint       # ESLint
npm run format     # Prettier (auto-fix)
```

## Monorepo Structure

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

`@tepa/types` is the foundation — every other package depends on it. Providers extend `BaseLLMProvider` from `@tepa/provider-core`. The core pipeline, tools, and providers are independent of each other, connected only through shared type interfaces.

## Code Conventions

Tepa uses strict TypeScript with ESLint and Prettier enforcement.

**TypeScript:**

- Target: ES2022, module resolution: `bundler`
- `strict: true` — no implicit any, strict null checks, etc.
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

These rules are enforced by the ESLint and Prettier configs at the repo root. Run `npm run lint` and `npm run format` before committing.

## How to Create a Custom Tool

The recommended way to add tools to Tepa is to **publish them as standalone npm packages**. A tool is just an object that satisfies the `ToolDefinition` interface from `@tepa/types` — no dependency on the core repo is needed.

### 1. Scaffold Your Package

```bash
mkdir tepa-tool-redis-cache
cd tepa-tool-redis-cache
npm init -y
npm install @tepa/types @tepa/tools
npm install -D typescript tsup vitest
```

You need `@tepa/types` for the `ToolDefinition` interface and `@tepa/tools` for the `defineTool` helper that validates your schema at creation time.

### 2. Define the Tool

Create `src/index.ts`:

```typescript
import { defineTool } from "@tepa/tools";

export const redisCacheTool = defineTool({
  name: "redis_cache",
  description: "Read and write values in a Redis cache",
  parameters: {
    operation: {
      type: "string",
      description: "The operation: 'get' or 'set'",
      required: true,
    },
    key: {
      type: "string",
      description: "The cache key",
      required: true,
    },
    value: {
      type: "string",
      description: "The value to set (required for 'set' operation)",
    },
    ttl: {
      type: "number",
      description: "Time-to-live in seconds",
      default: 3600,
    },
  },
  execute: async (params) => {
    const operation = params.operation as string;
    const key = params.key as string;
    const value = params.value as string | undefined;
    const ttl = (params.ttl as number) ?? 3600;

    // Implement Redis logic here
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
- `execute` must return a serializable value (it becomes part of the pipeline's execution result)
- `defineTool` validates the schema at creation time using Zod

### 3. Write Tests

```typescript
import { describe, it, expect } from "vitest";
import { redisCacheTool } from "../src/index.js";

describe("redisCacheTool", () => {
  it("should have correct metadata", () => {
    expect(redisCacheTool.name).toBe("redis_cache");
    expect(redisCacheTool.parameters.key.required).toBe(true);
  });

  it("should execute a get operation", async () => {
    const result = await redisCacheTool.execute({
      operation: "get",
      key: "test-key",
    });
    expect(result).toBeDefined();
  });
});
```

### 4. Publish to npm

```bash
npm run build
npm publish
```

### 5. Use It with Tepa

Users install your package alongside the core framework and pass the tool to the `Tepa` constructor:

```bash
npm install @tepa/core @tepa/tools @tepa/provider-anthropic tepa-tool-redis-cache
```

```typescript
import { Tepa } from "@tepa/core";
import { AnthropicProvider } from "@tepa/provider-anthropic";
import { redisCacheTool } from "tepa-tool-redis-cache";
import { fileReadTool, fileWriteTool } from "@tepa/tools";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, redisCacheTool],
});
```

Any `ToolDefinition` works — Tepa doesn't care whether it comes from `@tepa/tools` or an external package. The pipeline will include it in tool schemas sent to the LLM and invoke it when the agent requests it.

## How to Create a Custom LLM Provider

Like tools, the recommended way to add LLM provider support is to **publish it as a standalone npm package**. Every provider extends `BaseLLMProvider` from `@tepa/provider-core`, which gives you retry logic, exponential backoff, rate limit handling, and structured logging for free.

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
│   ├── myllm.ts          # Provider class
│   ├── formatting.ts     # Message/tool format conversion
│   ├── factory.ts        # createProvider() factory
│   └── index.ts          # Public exports
├── tests/
│   └── myllm.test.ts
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### 2. Implement the Provider

Extend `BaseLLMProvider` and implement four methods:

```typescript
import { BaseLLMProvider, type BaseLLMProviderOptions } from "@tepa/provider-core";
import type { LLMMessage, LLMRequestOptions, LLMResponse } from "@tepa/types";

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

  // Core method — send messages to the API, return a normalized response
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

  // Return true for transient errors that should be retried
  protected isRetryable(error: unknown): boolean {
    return error instanceof MyLLMServerError || error instanceof MyLLMConnectionError;
  }

  // Return true for 429/rate-limit errors (gets 30x longer backoff)
  protected isRateLimitError(error: unknown): boolean {
    return error instanceof MyLLMRateLimitError;
  }

  // Extract Retry-After header if present
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

You do **not** need to implement retry logic — `BaseLLMProvider` wraps `doComplete` with exponential backoff automatically.

### 3. Add Format Conversion Helpers

Create `src/formatting.ts` to handle the translation between Tepa's normalized types and your provider's API format:

- **`toMyLLMMessages(messages: LLMMessage[])`** — convert Tepa messages (role + content/tool results) to the provider's message format
- **`toMyLLMTools(tools: ToolSchema[])`** — convert Tepa tool schemas to the provider's tool/function format
- **`extractText(response)`** — pull text content from the response
- **`extractToolUse(response)`** — convert tool call blocks to `LLMToolUseBlock[]`
- **`mapFinishReason(reason)`** — map the provider's stop reason to Tepa's `"stop" | "tool_use" | "max_tokens" | "unknown"`

### 4. Export a Factory

Create `src/factory.ts`:

```typescript
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

### 6. Publish and Use

```bash
npm run build
npm publish
```

Users install your provider alongside the core framework:

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

Any class that implements the `LLMProvider` interface (or extends `BaseLLMProvider`) works — Tepa doesn't care whether it comes from a built-in `@tepa/provider-*` package or an external one.

## Pull Request Guidelines

PRs to this repository should focus on the core pipeline, existing built-in tools/providers, documentation, and bug fixes. For new tools and providers, prefer publishing them as external packages (see sections above) — submit a PR here only if you believe the addition is essential for the broader community.

1. **Fork the repo** and clone your fork (see [Fork and Clone](#fork-and-clone) above).
2. **Create a branch from `main`.** Name it descriptively: `fix/executor-timeout`, `feat/evaluator-confidence-threshold`, `docs/event-patterns`.
3. **One concern per PR.** A bug fix, a core enhancement, and a docs update should be separate PRs.
4. **Write tests.** Bug fixes should include a regression test when practical. Changes to the core pipeline need unit tests.
5. **Run the full check before pushing:**
   ```bash
   npm run build && npm test && npm run lint
   ```
6. **Push to your fork and open a PR** against `main` on the upstream repo:
   ```bash
   git push origin your-branch-name
   ```
   Then open a pull request from your fork on GitHub.
7. **Write a clear commit message.** Summarize the what and why in the first line. Use the imperative mood.
   ```
   Fix executor skipping steps when upstream returns empty output
   Add confidence threshold option to evaluator config
   Update event system docs with cleanup pattern
   ```
8. **Keep the PR description concise.** Explain what changed, why, and how to test it. Link related issues if applicable.

See [Pull Request Example](contributing/pull-request-example.md) for a filled-in template showing what a good PR looks like.

## Issue Reporting

When filing an issue, include:

- **What you expected** vs. **what happened**
- **Minimal reproduction** — a prompt file + entry script that triggers the issue, or a failing test
- **Environment** — Node.js version, package versions (`npm ls @tepa/core`), OS
- **Logs** — set logging to `verbose` in your config and include the relevant output. If the issue involves LLM responses, check `.tepa/logs/` for the JSONL request/response log

For feature requests, describe the use case first, then the proposed solution. This helps the maintainers understand whether the feature fits the framework's scope.

See filled-in examples of each template:

- [Bug Report Example](contributing/bug-report-example.md)
- [Feature Request Example](contributing/feature-request-example.md)
