# Getting Started

## Prerequisites

- **Node.js** >= 18
- An **API key** for at least one supported LLM provider:
  - [Anthropic](https://console.anthropic.com/) (`ANTHROPIC_API_KEY`)
  - [OpenAI](https://platform.openai.com/) (`OPENAI_API_KEY`)
  - [Google Gemini](https://aistudio.google.com/) (`GEMINI_API_KEY`)

## Installation

Install the core framework, a provider for your LLM of choice, and the built-in tool kit:

```bash
# With Anthropic (Claude)
npm install @tepa/core @tepa/tools @tepa/provider-anthropic

# With OpenAI
npm install @tepa/core @tepa/tools @tepa/provider-openai

# With Google Gemini
npm install @tepa/core @tepa/tools @tepa/provider-gemini
```

Since the code in this tutorial uses ES module `import` syntax, make sure your `package.json` includes:

```json
{
  "type": "module"
}
```

If you started with `npm init -y`, open `package.json` and add the `"type": "module"` field.

### Set Your API Key

Set the API key for your chosen provider as an environment variable:

=== "Bash (Linux/macOS)"

    ```bash
    # Pick the one that matches your provider
    export ANTHROPIC_API_KEY="sk-ant-..."
    export OPENAI_API_KEY="sk-..."
    export GEMINI_API_KEY="..."
    ```

=== "PowerShell (Windows)"

    ```powershell
    # Pick the one that matches your provider
    $env:ANTHROPIC_API_KEY="sk-ant-..."
    $env:OPENAI_API_KEY="sk-..."
    $env:GEMINI_API_KEY="..."
    ```

=== "CMD (Windows)"

    ```cmd
    rem Pick the one that matches your provider
    set ANTHROPIC_API_KEY=sk-ant-...
    set OPENAI_API_KEY=sk-...
    set GEMINI_API_KEY=...
    ```

!!! tip "Use a `.env` file instead"

    To avoid setting environment variables every time, create a `.env` file in your project root:

    ```
    ANTHROPIC_API_KEY=sk-ant-...
    ```

    Then load it with a package like [`dotenv`](https://www.npmjs.com/package/dotenv) at the top of your script:

    ```typescript
    import "dotenv/config";
    ```

## Your First Pipeline

The example below reads a directory and writes a summary file. You give Tepa the goal, the tools, and a description of what success looks like — it handles the planning, execution, and verification.

```typescript
import { Tepa } from "@tepa/core";
import { AnthropicProvider } from "@tepa/provider-anthropic";
import { fileReadTool, fileWriteTool, directoryListTool, scratchpadTool } from "@tepa/tools";

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [fileReadTool, fileWriteTool, directoryListTool, scratchpadTool],
});

const result = await tepa.run({
  goal: "List the files in ./src and write a brief summary of the project structure to ./summary.md.",
  context: { projectDir: "./src" },
  expectedOutput: "A file at ./summary.md describing the project structure.",
});

console.log(result.status); // "pass" — the evaluator confirmed ./summary.md meets the goal
console.log(result.feedback); // a summary of what was produced, or why it fell short
```

Save this as `pipeline.js`, then run it:

=== "Bash (Linux/macOS)"

    ```bash
    node pipeline.js
    ```

=== "PowerShell (Windows)"

    ```powershell
    node pipeline.js
    ```

=== "CMD (Windows)"

    ```cmd
    node pipeline.js
    ```

No plan to write. No retry logic to implement. No output to parse. Tepa planned the steps, executed them using the tools you registered, evaluated the result against your `expectedOutput`, and gave you a verdict.

### Swapping Providers

Change the provider — nothing else changes:

```typescript
import { OpenAIProvider } from "@tepa/provider-openai";
// or
import { GeminiProvider } from "@tepa/provider-gemini";

const tepa = new Tepa({
  provider: new OpenAIProvider(), // or new GeminiProvider()
  tools: [fileReadTool, fileWriteTool, directoryListTool, scratchpadTool],
});
```

## Understanding the Result

`tepa.run()` returns a `TepaResult` object. Here's what each field means:

| Field        | Description                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `"pass"` — output met the expected criteria. `"fail"` — max cycles reached without passing. `"terminated"` — token budget exhausted mid-cycle. |
| `feedback`   | On pass: a summary from the evaluator. On fail: what fell short and why. On termination: the budget-exceeded message.                          |
| `cycles`     | How many Plan-Execute-Evaluate cycles ran before the pipeline stopped.                                                                         |
| `tokensUsed` | Total tokens consumed across all LLM calls (planner + executor + evaluator, across all cycles).                                                |
| `outputs`    | Artifacts produced by the pipeline — file paths, descriptions, types.                                                                          |
| `logs`       | Structured log entries with timestamps, cycle numbers, step IDs, tool names, durations, and token counts.                                      |

```typescript
interface TepaResult {
  status: "pass" | "fail" | "terminated";
  cycles: number;
  tokensUsed: number;
  outputs: OutputArtifact[];
  logs: LogEntry[];
  feedback: string;
}
```

## What Happened Under the Hood

When you called `tepa.run()`, Tepa ran a **Plan → Execute → Evaluate** cycle automatically. The Planner broke your goal into steps, the Executor ran each step using your registered tools, and the Evaluator checked the result against your `expectedOutput`. If it had failed, the evaluator's feedback would have fed back into the Planner for a revised approach — automatically, up to the cycle limit.

All of that happened inside a single `await tepa.run()` call.

Want the full picture? [**How Tepa Works**](./03-how-tepa-works.md) covers the cycle in depth — how the Planner structures steps, how the Executor resolves dependencies, how the Evaluator scores results, and how self-correction works.

## Next Steps

- [**How Tepa Works**](./03-how-tepa-works.md) — A deeper look at the Plan-Execute-Evaluate cycle, the scratchpad, the event system, and the package architecture
- [**Configuration**](./05-configuration.md) — Customize cycle limits, token budgets, per-stage models, and logging levels
- [**Tool System**](./06-tool-system.md) — Explore built-in tools and create your own
- [**Examples and Demos**](./09-examples-and-demos.md) — See Tepa in action: code generation, data analysis, and human-in-the-loop workflows
