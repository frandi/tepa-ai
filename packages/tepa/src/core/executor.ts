import type {
  LLMProvider,
  LLMMessage,
  ToolRegistry,
  Plan,
  PlanStep,
  ExecutionResult,
  LogEntry,
  TepaPrompt,
} from "@tepa/types";
import { Scratchpad } from "./scratchpad.js";

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
 * Build the system prompt for parameter construction.
 */
function buildParamSystemPrompt(): string {
  return `You are an execution agent. Given a step description, available tool schema, and execution context, produce the exact parameters to pass to the tool.

You MUST respond with ONLY a valid JSON object containing the tool parameters. No markdown, no code fences, no extra text.

Example: if the tool expects { "path": "string", "content": "string" }, respond with:
{"path": "/tmp/file.ts", "content": "console.log('hello')"}`;
}

/**
 * Build the user message for parameter construction.
 */
function buildParamUserMessage(
  step: PlanStep,
  toolName: string,
  toolParams: Record<string, unknown>,
  context: ExecutionContext,
  previousStepOutputs: Map<string, unknown>,
): string {
  const parts: string[] = [
    `Step: ${step.description}`,
    `Expected outcome: ${step.expectedOutcome}`,
    `Tool: ${toolName}`,
    `Tool parameters schema: ${JSON.stringify(toolParams)}`,
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
 * Extract JSON parameters from an LLM response string.
 */
function extractParams(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  // Try to extract from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = fenceMatch?.[1]?.trim() ?? trimmed;

  // Find JSON object
  const jsonStart = jsonStr.indexOf("{");
  const jsonEnd = jsonStr.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return JSON.parse(jsonStr.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
  }

  return JSON.parse(jsonStr) as Record<string, unknown>;
}

/**
 * Summarize a value for log output, truncating if too long.
 */
function summarize(value: unknown, maxLength = 200): string {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

export class Executor {
  private readonly registry: ToolRegistry;
  private readonly provider: LLMProvider;
  private readonly model: string;

  constructor(
    registry: ToolRegistry,
    provider: LLMProvider,
    model: string,
  ) {
    this.registry = registry;
    this.provider = provider;
    this.model = model;
  }

  /**
   * Execute a plan step by step, returning results and logs.
   */
  async execute(plan: Plan, context: ExecutionContext): Promise<ExecutorOutput> {
    const results: ExecutionResult[] = [];
    const logs: LogEntry[] = [];
    let totalTokens = 0;
    const stepOutputs = new Map<string, unknown>();

    for (const step of plan.steps) {
      const startTime = Date.now();
      let result: ExecutionResult;

      if (step.tools.length === 0) {
        // LLM reasoning step — no tool
        result = await this.executeReasoningStep(step, context, stepOutputs);
      } else {
        // Tool execution step — execute each tool in sequence
        result = await this.executeToolStep(step, context, stepOutputs);
      }

      const durationMs = Date.now() - startTime;
      result.durationMs = durationMs;
      totalTokens += result.tokensUsed;

      // Store output for subsequent steps
      stepOutputs.set(step.id, result.output);
      results.push(result);

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
        model: this.model,
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
   * Execute a tool step: resolve tool, construct parameters via LLM, invoke.
   */
  private async executeToolStep(
    step: PlanStep,
    context: ExecutionContext,
    stepOutputs: Map<string, unknown>,
  ): Promise<ExecutionResult> {
    // Execute tools sequentially, accumulating outputs
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
        // Use LLM to construct parameters
        const messages: LLMMessage[] = [
          {
            role: "user",
            content: buildParamUserMessage(
              step,
              toolName,
              tool.parameters,
              context,
              stepOutputs,
            ),
          },
        ];

        const paramResponse = await this.provider.complete(messages, {
          model: this.model,
          systemPrompt: buildParamSystemPrompt(),
        });

        totalTokens += paramResponse.tokensUsed.input + paramResponse.tokensUsed.output;

        const params = extractParams(paramResponse.text);

        // Invoke the tool
        const toolOutput = await tool.execute(params);
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
