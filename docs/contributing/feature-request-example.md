# Feature Request Example

> This is a filled-in example of the [feature request template](../../.github/ISSUE_TEMPLATE/feature_request.md) to show what a good feature request looks like.

---

**Title:** Support per-step timeout overrides

---

## What problem are you trying to solve?

My pipeline mixes fast steps (scratchpad reads, ~1s) with slow ones (web scraping via `http_request`, 30–60s). The global `toolTimeout` of 30s causes scraping steps to fail intermittently. But if I raise it to 60s, a broken scratchpad read hangs for a full minute before failing — wasting an entire cycle.

## What would you like to see?

An optional `timeout` field on `PlanStep` that overrides the global `toolTimeout` for that specific step:

```typescript
interface PlanStep {
  id: string;
  description: string;
  tools: string[];
  timeout?: number; // ms — overrides config.limits.toolTimeout
  // ...existing fields
}
```

The Executor would use `step.timeout ?? config.limits.toolTimeout` when invoking tools. This is similar to how per-step `model` overrides already work.

## Anything else?

I considered running separate pipelines with different timeout configs, but that loses dependency ordering between the fast and slow steps. Wrapping each slow tool with its own internal timeout would also work but duplicates logic across every tool.
