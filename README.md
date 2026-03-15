# Tepa

> _From Javanese **tepa slira**: the practice of self-reflection, measuring oneself against a standard before acting._

**Most AI agents know how to run. Tepa knows when it's done.**

Tepa is a TypeScript framework for building agents that don't just execute tasks — they verify their own output, and keep refining until it passes.

---

## The Problem

AI agents fail quietly. They execute, return output, and declare success. Whether that output is actually correct is left to you to find out — usually downstream, usually too late. And when something goes wrong, there's no recovery path: you write the retry logic yourself, every time.

## The Solution

Tepa structures every task as a **Plan → Execute → Evaluate** loop:

- The **Planner** breaks your goal into structured steps with assigned tools
- The **Executor** carries out each step using native LLM tool calling — no text parsing, no fragile JSON extraction
- The **Evaluator** checks results against your stated expected output and sends feedback back to the Planner if it fails

The loop runs until the agent passes, hits a cycle limit, or exhausts its token budget. You define what "done" looks like. Tepa is accountable to that definition.

---

## Quick Start

```bash
npm install @tepa/core @tepa/tools @tepa/provider-anthropic
```

```typescript
import { Tepa } from "@tepa/core";
import { fileReadTool, fileWriteTool, shellExecuteTool } from "@tepa/tools";
import { AnthropicProvider } from "@tepa/provider-anthropic";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, shellExecuteTool],
});

const result = await tepa.run({
  goal: "Create a hello world TypeScript file and verify it compiles",
  context: { projectDir: "./my-project" },
  expectedOutput: "A file at src/hello.ts that compiles without errors",
});

console.log(result.status); // "pass" | "fail" | "terminated" ← a verdict, not a guess
console.log(result.feedback); // what happened, or why it failed
```

---

## Is Tepa Right for Your Use Case?

Tepa is intentionally scoped. It does one thing well: **goal-oriented pipelines with a verifiable success condition**.

| Tepa is a great fit for…                           | Tepa is not designed for…                      |
| -------------------------------------------------- | ---------------------------------------------- |
| Code generation + automated testing                | Conversational chatbots or multi-turn dialogue |
| Data analysis and structured report generation     | Simple single-prompt → response tasks          |
| Document pipelines with quality criteria           | Low-latency or streaming applications          |
| Multi-step automated workflows with error recovery | Long-lived agents with persistent memory       |

Not sure? Read [When Tepa Might Not Be the Best Fit](./docs/01-introduction.md#when-tepa-isnt-the-right-tool) in the introduction — including how to use Tepa _alongside_ your existing stack rather than replacing it.

---

## Built to Extend

Tepa's core is lean on purpose. It ships the tools and providers most users need — and a clean interface for the rest.

```
@tepa/types              ← shared interfaces, zero dependencies
    ↑
    ├── @tepa/core        ← pipeline engine (Planner → Executor → Evaluator)
    ├── @tepa/tools       ← built-in tools (file I/O, shell, HTTP, web search…)
    ├── @tepa/provider-anthropic  ← Claude
    ├── @tepa/provider-gemini     ← Gemini
    └── @tepa/provider-openai     ← OpenAI
```

Any npm package that implements `ToolDefinition` or extends `BaseLLMProvider` works with Tepa out of the box — no core changes needed. Build your own tools and providers, publish them as independent packages, and they're first-class citizens alongside the built-ins.

→ [Tool System](./docs/06-tool-system.md) · [LLM Providers](./docs/08-llm-providers.md) · [Contributing](./docs/10-contributing.md)

---

## Documentation

|               | Section                                               |                                                            |
| ------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| **Learn**     | [Introduction](./docs/01-introduction.md)             | What Tepa is, who it's for, and when to use something else |
|               | [Getting Started](./docs/02-getting-started.md)       | Installation, first example, understanding results         |
|               | [How Tepa Works](./docs/03-how-tepa-works.md)         | The Plan-Execute-Evaluate cycle in depth                   |
| **Build**     | [Pipeline in Detail](./docs/04-pipeline-in-detail.md) | Prompt structure, lifecycle events, tool resolution        |
|               | [Configuration](./docs/05-configuration.md)           | Models, limits, logging                                    |
|               | [Tool System](./docs/06-tool-system.md)               | Built-in tools, custom tools, third-party packages         |
|               | [Event System](./docs/07-event-system-patterns.md)    | Human-in-the-loop, safety filters, monitoring              |
|               | [LLM Providers](./docs/08-llm-providers.md)           | Anthropic, OpenAI, Gemini, custom providers                |
| **Explore**   | [Examples & Demos](./docs/09-examples-and-demos.md)   | Runnable demos with walkthroughs                           |
| **Reference** | [API Reference](./docs/11-api-reference.md)           | Complete API surface                                       |

---

## License

MIT — free to use, modify, and distribute. See [LICENSE](./LICENSE).
