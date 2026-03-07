import type {
  LLMProvider,
  LLMMessage,
  ToolRegistry,
  ToolSchema,
  TepaPrompt,
  Plan,
  PlanStep,
} from "@tepa/types";
import { TepaCycleError } from "../utils/errors.js";

/**
 * Build the system prompt for initial planning.
 */
function buildPlanSystemPrompt(toolSchemas: ToolSchema[]): string {
  const toolList = toolSchemas
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(
          ([name, def]) =>
            `      - ${name} (${def.type}${def.required ? ", required" : ""}): ${def.description}`,
        )
        .join("\n");
      return `  - ${t.name}: ${t.description}\n${params}`;
    })
    .join("\n\n");

  return `You are a planning agent. Your job is to analyze a goal and produce a structured execution plan.

You have access to the following tools:

${toolList}

Given a goal, context, and expected output, you must:
1. Analyze the goal and break it into discrete, ordered steps.
2. Assign one or more tools to each step (use tool names exactly as listed above).
3. Define dependencies between steps (which steps must complete before this one can start).
4. Estimate the total token usage for executing the plan.
5. Provide your reasoning for the plan structure.

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no code fences, no extra text):

{
  "reasoning": "Your explanation of why this plan structure was chosen",
  "estimatedTokens": <number>,
  "steps": [
    {
      "id": "step_1",
      "description": "What this step does",
      "tools": ["tool_name"],
      "expectedOutcome": "What this step should produce",
      "dependencies": []
    }
  ]
}

Rules:
- Step IDs must be unique and follow the pattern "step_1", "step_2", etc.
- Dependencies reference other step IDs that must complete first.
- Every tool name must exactly match one of the available tools listed above.
- If a step requires LLM reasoning without a tool, use an empty tools array.
- Keep the plan minimal — only include steps necessary to achieve the goal.`;
}

/**
 * Build the system prompt for revised planning (with evaluator feedback).
 */
function buildRevisedPlanSystemPrompt(toolSchemas: ToolSchema[]): string {
  const toolList = toolSchemas
    .map((t) => `  - ${t.name}: ${t.description}`)
    .join("\n");

  return `You are a planning agent revising a previously failed plan.

Available tools:
${toolList}

You will receive the original goal and feedback from an evaluator describing what went wrong. Your job is to produce a MINIMAL revised plan that addresses the feedback. Do not regenerate the entire plan from scratch — only add, modify, or replace the steps necessary to fix the issues identified.

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no code fences, no extra text):

{
  "reasoning": "What you changed and why, based on the feedback",
  "estimatedTokens": <number>,
  "steps": [
    {
      "id": "step_1",
      "description": "What this step does",
      "tools": ["tool_name"],
      "expectedOutcome": "What this step should produce",
      "dependencies": []
    }
  ]
}

Rules:
- Focus on fixing the specific issues from the feedback.
- Reuse successful parts of the previous execution where possible.
- Keep changes minimal — only modify what's necessary.
- The revised plan must be self-contained: all dependency references must point to step IDs that exist within THIS plan. Do not reference step IDs from the original plan unless they are included in the revised plan.`;
}

/**
 * Build the user message for initial planning.
 */
function buildPlanUserMessage(prompt: TepaPrompt): string {
  const expectedOutput =
    typeof prompt.expectedOutput === "string"
      ? prompt.expectedOutput
      : JSON.stringify(prompt.expectedOutput, null, 2);

  return `Goal: ${prompt.goal}

Context:
${JSON.stringify(prompt.context, null, 2)}

Expected Output:
${expectedOutput}`;
}

/**
 * Build the user message for revised planning (includes feedback).
 */
function buildRevisedPlanUserMessage(
  prompt: TepaPrompt,
  feedback: string,
): string {
  return `${buildPlanUserMessage(prompt)}

--- Evaluator Feedback ---
${feedback}

Please produce a revised plan that addresses the feedback above.`;
}

/**
 * Extract JSON from an LLM response string.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();

  // Try to extract from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  // Try to find a JSON object directly
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return trimmed.slice(jsonStart, jsonEnd + 1);
  }

  return trimmed;
}

/**
 * Validate that a parsed object conforms to the Plan structure.
 */
function validatePlanStructure(data: unknown): Plan {
  if (typeof data !== "object" || data === null) {
    throw new Error("Plan must be a JSON object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.reasoning !== "string") {
    throw new Error('Plan must have a "reasoning" string');
  }

  if (typeof obj.estimatedTokens !== "number" || obj.estimatedTokens < 0) {
    throw new Error('Plan must have a non-negative "estimatedTokens" number');
  }

  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error("Plan must have a non-empty \"steps\" array");
  }

  const stepIds = new Set<string>();
  const steps: PlanStep[] = [];

  for (const step of obj.steps) {
    if (typeof step !== "object" || step === null) {
      throw new Error("Each step must be an object");
    }

    const s = step as Record<string, unknown>;

    if (typeof s.id !== "string" || s.id.length === 0) {
      throw new Error("Each step must have a non-empty \"id\" string");
    }

    if (stepIds.has(s.id)) {
      throw new Error(`Duplicate step ID: "${s.id}"`);
    }
    stepIds.add(s.id);

    if (typeof s.description !== "string" || s.description.length === 0) {
      throw new Error(`Step "${s.id}" must have a non-empty "description"`);
    }

    if (!Array.isArray(s.tools)) {
      throw new Error(`Step "${s.id}" must have a "tools" array`);
    }

    for (const tool of s.tools) {
      if (typeof tool !== "string") {
        throw new Error(`Step "${s.id}" tools must be strings`);
      }
    }

    if (typeof s.expectedOutcome !== "string" || s.expectedOutcome.length === 0) {
      throw new Error(
        `Step "${s.id}" must have a non-empty "expectedOutcome"`,
      );
    }

    if (!Array.isArray(s.dependencies)) {
      throw new Error(`Step "${s.id}" must have a "dependencies" array`);
    }

    for (const dep of s.dependencies) {
      if (typeof dep !== "string") {
        throw new Error(`Step "${s.id}" dependencies must be strings`);
      }
    }

    steps.push({
      id: s.id,
      description: s.description,
      tools: s.tools as string[],
      expectedOutcome: s.expectedOutcome,
      dependencies: s.dependencies as string[],
    });
  }

  // Validate dependency references
  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep)) {
        throw new Error(
          `Step "${step.id}" references unknown dependency "${dep}"`,
        );
      }
    }
  }

  return {
    reasoning: obj.reasoning as string,
    estimatedTokens: obj.estimatedTokens as number,
    steps,
  };
}

/**
 * Validate that all tool references in the plan exist in the registry.
 */
function validateToolReferences(
  plan: Plan,
  registry: ToolRegistry,
): void {
  for (const step of plan.steps) {
    for (const toolName of step.tools) {
      if (!registry.get(toolName)) {
        throw new TepaCycleError(
          `Plan references unknown tool "${toolName}" in step "${step.id}". ` +
            `Available tools: ${registry.toSchema().map((t) => t.name).join(", ")}`,
        );
      }
    }
  }
}

/**
 * Build a simplified retry prompt when the first attempt produces unparseable output.
 */
function buildSimplifiedRetryPrompt(): string {
  return `Your previous response could not be parsed as valid JSON. Please try again.

Respond with ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.

The JSON must have this structure:
{
  "reasoning": "string",
  "estimatedTokens": number,
  "steps": [
    {
      "id": "step_1",
      "description": "string",
      "tools": ["tool_name"],
      "expectedOutcome": "string",
      "dependencies": []
    }
  ]
}`;
}

export class Planner {
  private readonly provider: LLMProvider;
  private readonly registry: ToolRegistry;
  private readonly model: string;

  constructor(
    provider: LLMProvider,
    registry: ToolRegistry,
    model: string,
  ) {
    this.provider = provider;
    this.registry = registry;
    this.model = model;
  }

  /**
   * Generate a plan from a prompt, optionally incorporating evaluator feedback.
   * On first call, receives the full prompt.
   * On subsequent calls (self-correction), also receives feedback.
   */
  async plan(prompt: TepaPrompt, feedback?: string): Promise<{ plan: Plan; tokensUsed: number }> {
    const toolSchemas = this.registry.toSchema();
    const hasFeedback = feedback !== undefined && feedback.length > 0;

    const systemPrompt = hasFeedback
      ? buildRevisedPlanSystemPrompt(toolSchemas)
      : buildPlanSystemPrompt(toolSchemas);

    const userMessage = hasFeedback
      ? buildRevisedPlanUserMessage(prompt, feedback)
      : buildPlanUserMessage(prompt);

    const messages: LLMMessage[] = [{ role: "user", content: userMessage }];
    const options = {
      model: this.model,
      systemPrompt,
    };

    // First attempt
    let response = await this.provider.complete(messages, options);
    let totalTokens = response.tokensUsed.input + response.tokensUsed.output;

    try {
      const plan = this.parseAndValidate(response.text);
      return { plan, tokensUsed: totalTokens };
    } catch (_firstError) {
      // Retry once with simplified prompt
      const retryMessages: LLMMessage[] = [
        { role: "user", content: userMessage },
        { role: "assistant", content: response.text },
        { role: "user", content: buildSimplifiedRetryPrompt() },
      ];

      response = await this.provider.complete(retryMessages, options);
      totalTokens += response.tokensUsed.input + response.tokensUsed.output;

      try {
        const plan = this.parseAndValidate(response.text);
        return { plan, tokensUsed: totalTokens };
      } catch (secondError) {
        throw new TepaCycleError(
          `Failed to parse plan from LLM after retry: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
        );
      }
    }
  }

  /**
   * Parse the LLM response text and validate the resulting plan.
   */
  private parseAndValidate(text: string): Plan {
    const jsonStr = extractJson(text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Invalid JSON: ${jsonStr.slice(0, 200)}`);
    }

    const plan = validatePlanStructure(parsed);
    validateToolReferences(plan, this.registry);

    return plan;
  }
}

// Export utilities for testing
export {
  buildPlanSystemPrompt as _buildPlanSystemPrompt,
  buildRevisedPlanSystemPrompt as _buildRevisedPlanSystemPrompt,
  buildPlanUserMessage as _buildPlanUserMessage,
  buildRevisedPlanUserMessage as _buildRevisedPlanUserMessage,
  extractJson as _extractJson,
  validatePlanStructure as _validatePlanStructure,
};
