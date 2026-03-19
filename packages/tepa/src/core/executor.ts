import type {
  LLMProvider,
  LLMMessage,
  ToolRegistry,
  ToolSchema,
  Plan,
  PlanStep,
  ExecutionResult,
  LogEntry,
  TepaPrompt,
  CycleMetadata,
} from "@tepa/types";
import { Scratchpad } from "./scratchpad.js";
import { TepaCycleError } from "../utils/errors.js";
import type { EventBus } from "../events/event-bus.js";

export interface ExecutionContext {
  /** The original prompt driving this pipeline run. */
  prompt: TepaPrompt;
  /** Current cycle number (1-based). */
  cycle: number;
  /** Shared scratchpad that persists across steps within a run. */
  scratchpad: Scratchpad;
  /** Results from previous cycles, if any. */
  previousResults?: ExecutionResult[];
}

export interface ExecutorOutput {
  results: ExecutionResult[];
  logs: LogEntry[];
  tokensUsed: number;
}

/**
 * Build the system prompt for native tool-use execution.
 */
function buildToolUseSystemPrompt(): string {
  return `You are an execution agent. Given a step description and execution context, use the provided tool to accomplish the task. Call the tool with the correct parameters based on the context.`;
}

/**
 * Build the user message for native tool-use execution.
 */
function buildToolUseUserMessage(
  step: PlanStep,
  toolName: string,
  context: ExecutionContext,
  previousStepOutputs: Map<string, unknown>,
): string {
  const parts: string[] = [
    `Step: ${step.description}`,
    `Expected outcome: ${step.expectedOutcome}`,
    `Tool to use: ${toolName}`,
    `Original goal: ${context.prompt.goal}`,
  ];

  if (Object.keys(context.prompt.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context.prompt.context)}`);
  }

  const scratchpadEntries = context.scratchpad.entries();
  if (Object.keys(scratchpadEntries).length > 0) {
    parts.push(`Scratchpad: ${JSON.stringify(scratchpadEntries)}`);
  }

  if (previousStepOutputs.size > 0) {
    const outputs: Record<string, unknown> = {};
    for (const [stepId, output] of previousStepOutputs) {
      outputs[stepId] = output;
    }
    parts.push(`Previous step outputs: ${JSON.stringify(outputs)}`);
  }

  return parts.join("\n\n");
}

/**
 * Build the system prompt for LLM reasoning steps (no tool).
 */
function buildReasoningSystemPrompt(): string {
  return `You are an execution agent performing a reasoning step. Analyze the given context and produce a thoughtful response that addresses the step's description and expected outcome. Your response will be stored and used by subsequent steps.`;
}

/**
 * Build the user message for LLM reasoning steps.
 */
function buildReasoningUserMessage(
  step: PlanStep,
  context: ExecutionContext,
  previousStepOutputs: Map<string, unknown>,
): string {
  const parts: string[] = [
    `Task: ${step.description}`,
    `Expected outcome: ${step.expectedOutcome}`,
    `Original goal: ${context.prompt.goal}`,
  ];

  if (Object.keys(context.prompt.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context.prompt.context)}`);
  }

  const scratchpadEntries = context.scratchpad.entries();
  if (Object.keys(scratchpadEntries).length > 0) {
    parts.push(`Scratchpad: ${JSON.stringify(scratchpadEntries)}`);
  }

  if (previousStepOutputs.size > 0) {
    const outputs: Record<string, unknown> = {};
    for (const [stepId, output] of previousStepOutputs) {
      outputs[stepId] = output;
    }
    parts.push(`Previous step outputs: ${JSON.stringify(outputs)}`);
  }

  return parts.join("\n\n");
}

/**
 * Summarize a value for log output, truncating if too long.
 */
function summarize(value: unknown, maxLength = 200): string {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/**
 * Topological sort via Kahn's algorithm.
 * Returns steps in dependency-safe execution order.
 * Throws TepaCycleError if circular dependencies are detected.
 */
function topoSort(steps: PlanStep[]): PlanStep[] {
  const stepMap = new Map<string, PlanStep>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const step of steps) {
    stepMap.set(step.id, step);
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }

  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (adjacency.has(dep)) {
        adjacency.get(dep)!.push(step.id);
        inDegree.set(step.id, inDegree.get(step.id)! + 1);
      }
    }
  }

  // Seed queue with zero-in-degree steps in original array order
  const queue: string[] = [];
  for (const step of steps) {
    if (inDegree.get(step.id) === 0) {
      queue.push(step.id);
    }
  }

  const sorted: PlanStep[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(stepMap.get(id)!);

    for (const neighbor of adjacency.get(id)!) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length < steps.length) {
    throw new TepaCycleError("Circular dependency detected in plan steps");
  }

  return sorted;
}

/**
 * Returns a new Map containing only outputs for the step's declared dependencies.
 */
function filterOutputsByDependencies(
  step: PlanStep,
  allOutputs: Map<string, unknown>,
): Map<string, unknown> {
  const scoped = new Map<string, unknown>();
  for (const dep of step.dependencies) {
    if (allOutputs.has(dep)) {
      scoped.set(dep, allOutputs.get(dep));
    }
  }
  return scoped;
}

export class Executor {
  private readonly registry: ToolRegistry;
  private readonly provider: LLMProvider;
  private readonly model: string;

  constructor(registry: ToolRegistry, provider: LLMProvider, model: string) {
    this.registry = registry;
    this.provider = provider;
    this.model = model;
  }

  /**
   * Execute a plan step by step, returning results and logs.
   */
  async execute(
    plan: Plan,
    context: ExecutionContext,
    eventBus?: EventBus,
    cycleMeta?: CycleMetadata,
  ): Promise<ExecutorOutput> {
    const results: ExecutionResult[] = [];
    const logs: LogEntry[] = [];
    let totalTokens = 0;
    const stepOutputs = new Map<string, unknown>();

    const sortedSteps = topoSort(plan.steps);

    for (const step of sortedSteps) {
      // Emit preStep
      if (eventBus && cycleMeta) {
        await eventBus.run("preStep", { step, cycle: context.cycle }, cycleMeta);
      }

      const startTime = Date.now();
      let result: ExecutionResult;

      // Check for failed dependencies
      const failedDep = step.dependencies.find(
        (depId) => results.find((r) => r.stepId === depId)?.status === "failure",
      );

      if (failedDep) {
        result = {
          stepId: step.id,
          status: "failure",
          output: null,
          error: `Skipped: dependency "${failedDep}" failed`,
          tokensUsed: 0,
          durationMs: 0,
        };
      } else {
        // Filter outputs to only declared dependencies
        const scopedOutputs = filterOutputsByDependencies(step, stepOutputs);

        if (step.tools.length === 0) {
          // LLM reasoning step — no tool
          result = await this.executeReasoningStep(step, context, scopedOutputs);
        } else {
          // Tool execution step — use native tool calling
          result = await this.executeToolStep(step, context, scopedOutputs);
        }
      }

      const durationMs = Date.now() - startTime;
      result.durationMs = durationMs;
      totalTokens += result.tokensUsed;

      // Store output in full map (unscoped)
      stepOutputs.set(step.id, result.output);
      results.push(result);

      // Emit postStep
      if (eventBus && cycleMeta) {
        await eventBus.run("postStep", { step, result, cycle: context.cycle }, cycleMeta);
      }

      // Record log entry
      logs.push({
        timestamp: startTime,
        cycle: context.cycle,
        step: step.id,
        tool: step.tools.length > 0 ? step.tools.join(", ") : undefined,
        message:
          result.status === "success"
            ? `Step "${step.id}" completed: ${summarize(result.output)}`
            : `Step "${step.id}" failed: ${result.error ?? "Unknown error"}`,
        durationMs,
        tokensUsed: result.tokensUsed,
      });
    }

    return { results, logs, tokensUsed: totalTokens };
  }

  /**
   * Execute a reasoning step (no tool) by delegating to the LLM.
   */
  private async executeReasoningStep(
    step: PlanStep,
    context: ExecutionContext,
    stepOutputs: Map<string, unknown>,
  ): Promise<ExecutionResult> {
    try {
      const messages: LLMMessage[] = [
        {
          role: "user",
          content: buildReasoningUserMessage(step, context, stepOutputs),
        },
      ];

      const response = await this.provider.complete(messages, {
        model: step.model ?? this.model,
        systemPrompt: buildReasoningSystemPrompt(),
      });

      const tokensUsed = response.tokensUsed.input + response.tokensUsed.output;

      return {
        stepId: step.id,
        status: "success",
        output: response.text,
        tokensUsed,
        durationMs: 0, // Will be overwritten by caller
      };
    } catch (error) {
      return {
        stepId: step.id,
        status: "failure",
        output: null,
        error: error instanceof Error ? error.message : String(error),
        tokensUsed: 0,
        durationMs: 0,
      };
    }
  }

  /**
   * Execute a tool step using the provider's native tool-use capability.
   * The LLM receives tool schemas and returns structured tool_use blocks,
   * avoiding the need to parse JSON from free-form text.
   */
  private async executeToolStep(
    step: PlanStep,
    context: ExecutionContext,
    stepOutputs: Map<string, unknown>,
  ): Promise<ExecutionResult> {
    const toolOutputs: unknown[] = [];
    let totalTokens = 0;

    for (const toolName of step.tools) {
      const tool = this.registry.get(toolName);
      if (!tool) {
        return {
          stepId: step.id,
          status: "failure",
          output: null,
          error: `Tool "${toolName}" not found in registry`,
          tokensUsed: totalTokens,
          durationMs: 0,
        };
      }

      try {
        // Build the tool schema for the specific tool
        const toolSchema: ToolSchema = {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        };

        // Ask LLM to call the tool using native tool-use
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: buildToolUseUserMessage(step, toolName, context, stepOutputs),
          },
        ];

        const response = await this.provider.complete(messages, {
          model: step.model ?? this.model,
          systemPrompt: buildToolUseSystemPrompt(),
          tools: [toolSchema],
          toolChoice: { name: toolName },
        });

        totalTokens += response.tokensUsed.input + response.tokensUsed.output;

        // Extract tool call from native tool_use response
        const toolCall = response.toolUse?.find((t) => t.name === toolName);

        if (!toolCall) {
          // No tool_use block returned — tool was not called by the LLM
          return {
            stepId: step.id,
            status: "failure",
            output: null,
            error: `LLM did not call tool "${toolName}" — no tool_use block in response`,
            tokensUsed: totalTokens,
            durationMs: 0,
          };
        }

        // Invoke the tool with the LLM-provided parameters
        const toolOutput = await tool.execute(toolCall.input);
        toolOutputs.push(toolOutput);
      } catch (error) {
        return {
          stepId: step.id,
          status: "failure",
          output: toolOutputs.length > 0 ? toolOutputs : null,
          error: error instanceof Error ? error.message : String(error),
          tokensUsed: totalTokens,
          durationMs: 0,
        };
      }
    }

    return {
      stepId: step.id,
      status: "success",
      output: toolOutputs.length === 1 ? toolOutputs[0] : toolOutputs,
      tokensUsed: totalTokens,
      durationMs: 0, // Will be overwritten by caller
    };
  }
}

// Export utilities for testing
export { topoSort as _topoSort, filterOutputsByDependencies as _filterOutputsByDependencies };
