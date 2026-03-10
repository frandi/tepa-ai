# Tepa

> *From Javanese tepa slira: the practice of self-reflection, measuring oneself against a standard before acting.*

Tepa is a TypeScript framework for building autonomous agent pipelines. It runs a cyclic loop of **Planner → Executor → Evaluator** — planning how to approach a task, executing the plan with tools, evaluating the results, and self-correcting until the goal is achieved or limits are reached.

## Architecture

```
@tepa/types              ← shared interfaces, zero dependencies
    ↑
    ├── @tepa/core        ← core pipeline engine
    ├── @tepa/tools       ← built-in tool collection
    ├── @tepa/provider-anthropic  ← Anthropic Claude provider
    ├── @tepa/provider-gemini     ← Google Gemini provider
    └── @tepa/provider-openai     ← OpenAI provider
         ↑
         └── demos/*      ← example applications
```

The core engine (`@tepa/core`) and tools (`@tepa/tools`) are **siblings** — they depend on `@tepa/types` but not on each other. This means you can use custom tools without installing `@tepa/tools`, and third-party tool packages only need `@tepa/types`.

## Quick Start

```bash
npm install @tepa/core @tepa/tools @tepa/provider-anthropic
```

```typescript
import { Tepa } from "@tepa/core";
import { fileReadTool, fileWriteTool, shellExecuteTool } from "@tepa/tools";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  tools: [fileReadTool, fileWriteTool, shellExecuteTool],
  provider: new AnthropicProvider(),
});

const result = await tepa.run({
  goal: "Create a hello world TypeScript file and verify it compiles",
  context: { projectDir: "./my-project" },
  expectedOutput: "A file at src/hello.ts that compiles without errors",
});

console.log(result.status);  // "pass" | "fail" | "terminated"
console.log(result.feedback); // Summary or failure description
```

## Install Patterns

```bash
# Full install — core + built-in tools + Anthropic provider
npm install @tepa/core @tepa/tools @tepa/provider-anthropic

# Minimal — core only, bring your own tools and provider
npm install @tepa/core

# Custom tool author — only needs the type interfaces
npm install @tepa/types
```

## Packages

| Package | Description |
|---------|-------------|
| [`@tepa/core`](packages/tepa) | Core pipeline engine: Planner, Executor, Evaluator, orchestrator, config, events |
| [`@tepa/types`](packages/types) | Shared TypeScript interfaces. Zero runtime dependencies |
| [`@tepa/tools`](packages/tools) | Built-in tool collection + `defineTool` helper + `ToolRegistry` |
| [`@tepa/provider-anthropic`](packages/provider-anthropic) | Anthropic Claude LLM provider |
| [`@tepa/provider-gemini`](packages/provider-gemini) | Google Gemini LLM provider |
| [`@tepa/provider-openai`](packages/provider-openai) | OpenAI LLM provider |

## How It Works

1. You provide a **prompt** (goal, context, expected output) and register **tools**
2. The **Planner** analyzes the goal and creates a step-by-step plan
3. The **Executor** runs each step using **native tool calling** — tool schemas are passed to the LLM's API, which returns structured parameters directly (no text-based JSON parsing)
4. The **Evaluator** checks results against expected output
5. If the evaluator fails, feedback goes back to the Planner for a **revised plan**
6. The loop continues until pass, max cycles, or token budget exhaustion

## Configuration

```typescript
const tepa = new Tepa({
  tools: [/* ... */],
  provider: new AnthropicProvider(),
  config: {
    model: {
      planner: "claude-sonnet-4-20250514",
      executor: "claude-sonnet-4-20250514",
      evaluator: "claude-sonnet-4-20250514",
    },
    limits: {
      maxCycles: 5,        // max Planner→Executor→Evaluator loops
      maxTokens: 10_000,   // total token budget across all cycles
      toolTimeout: 30_000, // per-tool timeout in ms
    },
    logging: {
      level: "standard",   // "minimal" | "standard" | "verbose"
    },
  },
});
```

All config fields have sensible defaults — zero configuration works out of the box.

## Event System

Hook into the pipeline at any stage to observe, transform, or control the flow:

```typescript
const tepa = new Tepa({
  tools: [/* ... */],
  provider: new AnthropicProvider(),
  events: {
    postPlanner: [
      (plan, cycle) => {
        console.log(`Cycle ${cycle.cycleNumber}: ${plan.steps.length} steps planned`);
        // Return nothing — plan passes through unchanged
      },
    ],
    preExecutor: [
      async (input, cycle) => {
        // Pause for human approval
        await askForApproval(input.plan);
        return input; // Continue with original input
      },
    ],
    postEvaluator: [
      {
        handler: (result) => {
          sendSlackNotification(result.verdict);
        },
        continueOnError: true, // Don't abort if notification fails
      },
    ],
  },
});
```

Eight event points: `prePlanner`, `postPlanner`, `preExecutor`, `postExecutor`, `preEvaluator`, `postEvaluator`, `preStep`, `postStep`.

## Custom Tools

Any object conforming to `ToolDefinition` works as a tool:

```typescript
import type { ToolDefinition } from "@tepa/types";

const myTool: ToolDefinition = {
  name: "database_query",
  description: "Execute a SQL query",
  parameters: {
    query: { type: "string", description: "SQL query", required: true },
  },
  execute: async ({ query }) => {
    // your implementation
  },
};

const tepa = new Tepa({
  tools: [myTool],
  provider: new AnthropicProvider(),
});
```

## Prompt Files

Prompts can be loaded from YAML or JSON files:

```typescript
import { Tepa, parsePromptFile } from "@tepa/core";

const prompt = await parsePromptFile("./prompts/task.yaml");
const result = await tepa.run(prompt);
```

```yaml
# prompts/task.yaml
goal: Analyze student grades and produce a report
context:
  dataDir: ./data
  format: csv
expectedOutput:
  - path: ./data/report.md
    description: A markdown report with grade analysis
    criteria:
      - Includes class-wide averages
      - Flags at-risk students
```

## Demos

The `demos/` directory contains working examples:

- **[API Client Generation](demos/api-client-gen)** — Generates a typed API client, runs tests, and self-corrects on failure
- **[Student Progress](demos/student-progress)** — Analyzes CSV grade/attendance data and produces insight reports
- **[Study Plan](demos/study-plan)** — Human-in-the-loop: user provides a learning goal, approves the plan, and decides whether to accept results or continue

Run a demo:

```bash
cd demos/api-client-gen
cp .env.example .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY
./run.sh
```

Each demo has its own `.env.example` — copy it to `.env.local` and set your API key. The `run.sh` script cleans previous output before running.

## Monorepo Development

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

MIT
