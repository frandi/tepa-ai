# Tepa

> *From Javanese tepa slira: the practice of self-reflection, measuring oneself against a standard before acting.*

**Tepa is a TypeScript framework for building AI agents that plan, execute, and self-correct.** It runs a cyclic loop of Planner, Executor, and Evaluator — your agent reasons about a goal, acts on it with tools, checks its own work, and retries until it gets it right.

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

console.log(result.status);   // "pass" | "fail" | "terminated"
console.log(result.feedback); // Summary or failure description
```

## How It Works

1. You provide a **goal**, **context**, and **expected output**, then register **tools** the agent can use
2. The **Planner** breaks the goal into steps
3. The **Executor** carries out each step using native LLM tool calling
4. The **Evaluator** checks results against expected output
5. If it fails, feedback loops back to the Planner for a revised approach
6. The cycle continues until **pass**, **max cycles**, or **token budget exhaustion**

## Packages

```
@tepa/types              ← shared interfaces, zero dependencies
    ↑
    ├── @tepa/core        ← pipeline engine (Planner → Executor → Evaluator)
    ├── @tepa/tools       ← built-in tool collection
    ├── @tepa/provider-anthropic  ← Claude
    ├── @tepa/provider-gemini     ← Gemini
    └── @tepa/provider-openai     ← OpenAI
```

Core and tools are **siblings** — they depend on `@tepa/types` but not on each other. You can bring your own tools without installing `@tepa/tools`, and third-party tool packages only need `@tepa/types`.

## Documentation

Full documentation lives in [`docs/`](./docs/index.md):

| | Section | |
|---|---|---|
| **Learn** | [Introduction](./docs/01-introduction.md) | What Tepa is and who it's for |
| | [Getting Started](./docs/02-getting-started.md) | Installation, first example, understanding results |
| | [How Tepa Works](./docs/03-how-tepa-works.md) | The Plan-Execute-Evaluate cycle in depth |
| **Build** | [Pipeline in Detail](./docs/04-pipeline-in-detail.md) | Prompt structure, lifecycle events, tool resolution |
| | [Configuration](./docs/05-configuration.md) | Models, limits, logging |
| | [Tool System](./docs/06-tool-system.md) | Built-in tools, custom tools, third-party packages |
| | [Event System](./docs/07-event-system-patterns.md) | Human-in-the-loop, safety filters, monitoring |
| | [LLM Providers](./docs/08-llm-providers.md) | Anthropic, OpenAI, Gemini, custom providers |
| **Explore** | [Examples & Demos](./docs/09-examples-and-demos.md) | Runnable demos with walkthroughs |
| **Reference** | [API Reference](./docs/11-api-reference.md) | Complete API surface |
| | [Contributing](./docs/10-contributing.md) | Dev setup, conventions, PR guidelines |

## Contributing

Tepa welcomes contributions! The core repo stays lean on purpose — it ships only the essentials. The best way to contribute is to **publish your own tools and providers as independent npm packages** using `@tepa/types`. No changes to this repo needed.

For contributions to the core pipeline, built-in tools, documentation, or bug fixes — fork the repo, create a branch, and open a PR. See the full [Contributing Guide](./docs/10-contributing.md) for dev setup, code conventions, and PR guidelines.

## License

MIT — free to use, modify, and distribute in personal and commercial projects. See [LICENSE](./LICENSE) for details.
