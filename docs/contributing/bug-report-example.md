# Bug Report Example

> This is a filled-in example of the [bug report template](../../.github/ISSUE_TEMPLATE/bug_report.md) to show what a good bug report looks like.

---

**Title:** Executor skips steps when upstream step returns empty string

---

## What happened?

I have a custom tool that returns an empty string `""` as a valid result. Steps that depend on it get skipped with "upstream failure", even though the tool completed successfully. The pipeline finishes with `status: "pass"` but the output is incomplete because the downstream steps never ran.

## Reproduction

```typescript
import { Tepa } from "@tepa/core";
import { AnthropicProvider } from "@tepa/provider-anthropic";
import { defineTool } from "@tepa/tools";

const emptyTool = defineTool({
  name: "return_empty",
  description: "Returns an empty string",
  parameters: {},
  execute: async () => "",
});

const tepa = new Tepa({
  provider: new AnthropicProvider(),
  tools: [emptyTool],
});

const result = await tepa.run({
  prompt: { goal: "Use return_empty tool, then summarize the result" },
});

// Steps after return_empty are skipped
console.log(result.outputs);
```

## Environment

- **Node.js:** 20.11.0
- **Packages:**
  ```
  my-project@1.0.0
  ├── @tepa/core@0.1.4
  └── @tepa/tools@0.1.3
  ```
- **OS:** Ubuntu 24.04

## Logs (optional)

```
[cycle:1] Planner produced 2 steps
[cycle:1] Step 1/2: "call_return_empty" — status: success, output: ""
[cycle:1] Step 2/2: "summarize_result" — SKIPPED (upstream failure)
[cycle:1] Evaluator verdict: pass (confidence: 0.72)
```
