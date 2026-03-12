# Future Iterations

Tepa's current release covers the core pipeline, tool system, event hooks, and Anthropic provider. The ideas below represent possible directions for Tepa's evolution — they are not promises or commitments. Whether any of these materialize depends on community interest, contributor bandwidth, and how the project's needs evolve over time. They're listed here to share the vision and invite conversation, not to set expectations.

## CLI Tool (`@tepa/cli`)

A standalone CLI package that allows developers to run Tepa from the terminal without writing code. Key commands: `tepa run`, `tepa init`, `tepa plan` (dry run), `tepa tools list`, `tepa logs`, and `tepa replay`. The CLI would parse YAML prompt files and config files, making Tepa accessible to non-TypeScript workflows. The monorepo structure already accommodates this as a new workspace.

## Parallel Step Execution

The current implementation executes plan steps sequentially. Future versions could allow the Planner to mark steps as parallelizable (no dependencies between them), and the Executor would run them concurrently. This would significantly speed up plans with independent steps like "read file A" and "read file B."

## Streaming and Real-Time Output

Support streaming LLM responses and real-time progress reporting. The event system already enables callers to observe pipeline progress (e.g., registering `postPlanner` or `postExecutor` callbacks to emit updates), but a full streaming API would allow UIs to show the pipeline working in real time, step by step — including token-level LLM output streaming.

## Persistent Memory Across Runs

Allow Tepa to remember context from previous runs. For example, if a developer runs Tepa twice on the same project, the second run could benefit from knowing what the first run learned about the project's structure and code style. This would be implemented as a persistent scratchpad that survives across runs.

## Multi-Agent Coordination

Allow multiple Tepa instances to collaborate on different parts of a larger task. A coordinator agent would break a high-level goal into sub-goals, dispatch them to individual Tepa pipelines, and merge the results. This builds naturally on the single-agent architecture.

## Plan Visualization

A web-based or terminal UI that visualizes the pipeline's execution: the plan as a directed graph, step-by-step progress, evaluator feedback, and cycle history. Useful for debugging and understanding agent behavior.

## Cost Estimation and Budgeting

Before running a pipeline, estimate the likely cost based on model pricing, estimated token usage, and number of expected cycles. Allow setting a dollar-amount budget instead of (or in addition to) a token budget.

## Conversation Mode

An interactive mode where Tepa pauses after each cycle and asks the developer for feedback before continuing. Useful for sensitive tasks where full autonomy isn't desired, or for teaching the pipeline about domain-specific constraints. The event system already makes basic human-in-the-loop workflows possible (e.g., a `postPlanner` callback that awaits human approval before execution proceeds). A future Conversation Mode would build on this with a higher-level API: a pre-built set of event callbacks, a standardized prompt/response interface, and integration with CLI or web-based input channels — so developers get interactive mode out of the box without wiring up custom callbacks.

## Advanced Event Features

The current event system is intentionally minimal. Future iterations could introduce: conditional event execution (fire only on certain cycles or verdicts without caller-side branching), event priority/weighting (beyond simple registration order), event timeouts (auto-abort if an async callback doesn't resolve within a limit), and an event replay/audit log (record all transformations applied by events for debugging and reproducibility).
