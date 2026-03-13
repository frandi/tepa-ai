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

Set your API key as an environment variable:

```bash
# Pick the one that matches your provider
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
```

## Minimal Working Example

Here is a complete pipeline in under 15 lines. It reads a directory, analyzes its contents, and writes a summary file — planning the steps, executing them, and verifying the result autonomously.

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

console.log(`Status: ${result.status}`);
console.log(`Cycles: ${result.cycles}`);
console.log(`Tokens used: ${result.tokensUsed}`);
console.log(`Feedback: ${result.feedback}`);
```

That's it. No plan to write, no retry logic to implement, no output to parse. Tepa handles all of it.

### Using a Different Provider

Swap the provider — nothing else changes:

```typescript
import { OpenAIProvider } from "@tepa/provider-openai";

const tepa = new Tepa({
  provider: new OpenAIProvider(),
  tools: [fileReadTool, fileWriteTool, directoryListTool, scratchpadTool],
});
```

```typescript
import { GeminiProvider } from "@tepa/provider-gemini";

const tepa = new Tepa({
  provider: new GeminiProvider(),
  tools: [fileReadTool, fileWriteTool, directoryListTool, scratchpadTool],
});
```

## Understanding the Result

`tepa.run()` returns a `TepaResult` object:

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

| Field        | Description                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `"pass"` — the evaluator judged the output as meeting the goal. `"fail"` — max cycles reached without a passing evaluation. `"terminated"` — the token budget was exhausted mid-cycle. |
| `cycles`     | How many Plan-Execute-Evaluate cycles ran before the pipeline stopped.                                                                                                                 |
| `tokensUsed` | Total tokens consumed across all LLM calls (planner + executor + evaluator, across all cycles).                                                                                        |
| `outputs`    | Artifacts produced by the pipeline (file paths, descriptions, types).                                                                                                                  |
| `logs`       | Structured log entries with timestamps, cycle numbers, step IDs, tool names, durations, and token counts.                                                                              |
| `feedback`   | On success, a summary from the evaluator. On failure, the evaluator's feedback explaining what fell short. On termination, the budget-exceeded message.                                |

## What Just Happened

When you called `tepa.run()`, the framework ran a full **Plan-Execute-Evaluate** cycle behind the scenes:

1. **Planner** — The LLM received your goal, context, and expected output along with the list of available tools. It produced a structured plan: a sequence of steps, each specifying which tool to call, what parameters to pass, and which steps it depends on.

   For the example above, the plan might look like:
   - Step 1: Call `directory_list` on `./src` to discover the project structure.
   - Step 2 _(depends on step 1)_: Call `file_read` on key files to understand their purpose.
   - Step 3 _(depends on step 2)_: Call `file_write` to create `./summary.md` with the analysis.

2. **Executor** — Steps were sorted by their dependencies and executed in order. For each step, the LLM received the step's description along with the tool schemas and returned a structured `tool_use` block. The framework invoked the tool, captured the result, and fed it into downstream steps.

3. **Evaluator** — After all steps completed, the LLM reviewed the execution results against the expected output. It checked whether `./summary.md` exists and whether its content actually describes the project structure. It returned a verdict — `pass` or `fail` — with a confidence score and feedback.

4. **Self-Correction** _(if needed)_ — If the evaluator returned `fail`, its feedback would have been sent back to the Planner to generate a revised plan. The cycle would repeat until the goal is met, the cycle limit is reached, or the token budget runs out. In the example above, sensible defaults apply: up to 5 cycles and 10,000 tokens.

All of this happened inside a single `await tepa.run()` call.

## Next Steps

- [**How Tepa Works**](./03-how-tepa-works.md) — A deeper look at the Plan-Execute-Evaluate cycle, the scratchpad, the event system, and the package architecture.
- [**Configuration**](./05-configuration.md) — Customize cycle limits, token budgets, per-stage models, and logging levels.
- [**Tool System**](./06-tool-system.md) — Explore built-in tools and create your own.
- [**Examples and Demos**](./09-examples-and-demos.md) — See Tepa in action with real-world use cases: code generation, data analysis, and human-in-the-loop workflows.
