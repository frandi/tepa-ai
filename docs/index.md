# Tepa Documentation

Tepa is a TypeScript framework for building autonomous AI agent pipelines that plan, execute, and self-correct. These docs cover everything from first install to full API reference.

## Learn

| #   | Section                                    | What you'll find                                                                                              |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | [Introduction](./01-introduction.md)       | What Tepa is, the problems it solves, key differentiators, and who it's for                                   |
| 2   | [Getting Started](./02-getting-started.md) | Prerequisites, installation, a minimal working example, and understanding the result                          |
| 3   | [How Tepa Works](./03-how-tepa-works.md)   | The Plan-Execute-Evaluate cycle, self-correction, scratchpad, event system overview, and package architecture |

## Build

| #   | Section                                                | What you'll find                                                                                                                    |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 4   | [The Pipeline in Detail](./04-pipeline-in-detail.md)   | Deep dive into prompt structure, Planner, Executor, Evaluator, lifecycle events, cycle termination, and tool resolution             |
| 5   | [Configuration](./05-configuration.md)                 | `TepaConfig` structure, defaults, `defineConfig()`, model assignment, limits, and logging levels                                    |
| 6   | [Tool System](./06-tool-system.md)                     | Defining tools, parameter schemas, the tool registry, all built-in tools, and creating third-party tool packages                    |
| 7   | [Event System Patterns](./07-event-system-patterns.md) | Callback contract, execution order, error handling, and patterns for human-in-the-loop, safety filters, progress tracking, and more |
| 8   | [LLM Providers](./08-llm-providers.md)                 | Provider interface, built-in providers (Anthropic, OpenAI, Gemini), native tool use, logging system, and building a custom provider |

## Explore

| #   | Section                                          | What you'll find                                                                                               |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 9   | [Examples and Demos](./09-examples-and-demos.md) | Three runnable demos — autonomous code generation, data analysis pipeline, and human-in-the-loop study planner |

## Reference

| #   | Section                                        | What you'll find                                                                                            |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 10  | [Contributing](./10-contributing.md)           | Development setup, code conventions, how to add tools and providers, PR guidelines                          |
| 11  | [API Reference](./11-api-reference.md)         | Complete reference for every exported class, interface, type, function, and error across all packages       |
| 12  | [Future Iterations](./12-future-iterations.md) | Vision and ideas for possible future directions — CLI, parallel execution, streaming, multi-agent, and more |
