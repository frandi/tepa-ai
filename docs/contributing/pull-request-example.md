# Pull Request Example

> This is a filled-in example of the [pull request template](../../.github/pull_request_template.md) to show what a good PR looks like.

---

**Title:** Fix executor treating empty string output as upstream failure

---

## What

Fix the Executor's dependency check to distinguish between empty output and failed status.

## Why

Steps that return `""` as valid output cause all downstream dependents to be skipped. Closes #47.

## How

Changed the upstream failure check in `packages/tepa/src/core/executor.ts` from a truthy check (`if (!upstreamResult.output)`) to an explicit status check (`if (upstreamResult.status === "failed")`). This preserves skip-on-failure while allowing falsy-but-valid outputs like empty strings.

## Type of Change

- [x] Bug fix
- [ ] Enhancement to existing feature
- [ ] Documentation
- [ ] Other:

## Pre-submit

- [x] `npm run build && npm test && npm run lint` passes
- [x] Tests added/updated (if applicable)

## How to Test

1. `npm test -- packages/tepa --grep "empty output"` — runs the new regression test
2. Or manually: create a tool that returns `""`, add a dependent step, confirm it executes instead of being skipped
