import type {
  LLMProvider,
  LLMMessage,
  TepaPrompt,
  ExecutionResult,
  EvaluationResult,
} from "@tepa/types";
import type { Scratchpad } from "./scratchpad.js";

/**
 * Build the system prompt for evaluation.
 */
function buildEvalSystemPrompt(): string {
  return `You are an evaluation agent. Your job is to judge whether a pipeline execution successfully achieved its goal.

You will receive:
- The original goal and expected output
- The execution results from each step (status, output, errors)
- The current scratchpad state

You must assess:
1. **Structural criteria**: Were the expected outputs produced? Do files exist in the right format? Are all required artifacts present?
2. **Qualitative criteria**: Is the content meaningful and correct? Are recommendations specific? Does the output actually address the goal?

You MUST respond with ONLY a valid JSON object in this exact format (no markdown, no code fences, no extra text):

{
  "verdict": "pass" or "fail",
  "confidence": <number between 0 and 1>,
  "feedback": "If fail: specific, actionable description of what went wrong and what needs to be fixed",
  "summary": "If pass: concise description of what was achieved"
}

Rules:
- Set verdict to "pass" ONLY if the goal is fully achieved and expected outputs are complete.
- Set verdict to "fail" if ANY expected output is missing, incomplete, or incorrect.
- Confidence should reflect how certain you are about the verdict (1.0 = completely certain).
- Feedback (on fail) must be specific and actionable — reference specific steps that failed and what should change.
- Summary (on pass) should briefly describe the successful outcome.`;
}

/**
 * Build the user message for evaluation.
 */
function buildEvalUserMessage(
  prompt: TepaPrompt,
  executionResults: ExecutionResult[],
  scratchpad: Scratchpad,
): string {
  const expectedOutput =
    typeof prompt.expectedOutput === "string"
      ? prompt.expectedOutput
      : JSON.stringify(prompt.expectedOutput, null, 2);

  const resultsSection = executionResults
    .map((r) => {
      const outputStr =
        typeof r.output === "string" ? r.output : JSON.stringify(r.output);
      const summary =
        outputStr.length > 500 ? outputStr.slice(0, 500) + "..." : outputStr;
      return [
        `  Step "${r.stepId}": ${r.status}`,
        `    Output: ${summary}`,
        r.error ? `    Error: ${r.error}` : null,
        `    Tokens: ${r.tokensUsed}, Duration: ${r.durationMs}ms`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const scratchpadEntries = scratchpad.entries();
  const scratchpadSection =
    Object.keys(scratchpadEntries).length > 0
      ? `Scratchpad State:\n${JSON.stringify(scratchpadEntries, null, 2)}`
      : "Scratchpad: (empty)";

  return `Goal: ${prompt.goal}

Expected Output:
${expectedOutput}

Execution Results:
${resultsSection}

${scratchpadSection}`;
}

/**
 * Extract JSON from an LLM response string.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return trimmed.slice(jsonStart, jsonEnd + 1);
  }

  return trimmed;
}

/**
 * Validate and parse the evaluation result from the LLM response.
 */
function parseEvalResult(data: unknown): Omit<EvaluationResult, "tokensUsed"> {
  if (typeof data !== "object" || data === null) {
    throw new Error("Evaluation result must be a JSON object");
  }

  const obj = data as Record<string, unknown>;

  if (obj.verdict !== "pass" && obj.verdict !== "fail") {
    throw new Error('Evaluation must have a "verdict" of "pass" or "fail"');
  }

  if (
    typeof obj.confidence !== "number" ||
    obj.confidence < 0 ||
    obj.confidence > 1
  ) {
    throw new Error(
      '"confidence" must be a number between 0 and 1',
    );
  }

  const result: Omit<EvaluationResult, "tokensUsed"> = {
    verdict: obj.verdict,
    confidence: obj.confidence,
  };

  if (obj.verdict === "fail") {
    if (typeof obj.feedback !== "string" || obj.feedback.length === 0) {
      throw new Error('Failed evaluation must include non-empty "feedback"');
    }
    result.feedback = obj.feedback;
  }

  if (obj.verdict === "pass") {
    if (typeof obj.summary === "string" && obj.summary.length > 0) {
      result.summary = obj.summary;
    }
  }

  return result;
}

/**
 * Build a simplified retry prompt when the first attempt produces unparseable output.
 */
function buildEvalRetryPrompt(): string {
  return `Your previous response could not be parsed as valid JSON. Please try again.

Respond with ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.

The JSON must have this structure:
{
  "verdict": "pass" or "fail",
  "confidence": <number between 0 and 1>,
  "feedback": "If fail: description of what went wrong",
  "summary": "If pass: description of what was achieved"
}`;
}

export class Evaluator {
  private readonly provider: LLMProvider;
  private readonly model: string;

  constructor(provider: LLMProvider, model: string) {
    this.provider = provider;
    this.model = model;
  }

  /**
   * Try to parse and validate an LLM response as an evaluation result.
   * Returns null on failure.
   */
  private tryParse(text: string): Omit<EvaluationResult, "tokensUsed"> | null {
    try {
      const jsonStr = extractJson(text);
      const parsed = JSON.parse(jsonStr);
      return parseEvalResult(parsed);
    } catch {
      return null;
    }
  }

  /**
   * Evaluate execution results against the original prompt's expected output.
   * Returns a verdict (pass/fail), confidence, and feedback or summary.
   * Retries once on parse failure before returning a synthetic fail result.
   */
  async evaluate(
    prompt: TepaPrompt,
    executionResults: ExecutionResult[],
    scratchpad: Scratchpad,
  ): Promise<EvaluationResult> {
    const userContent = buildEvalUserMessage(prompt, executionResults, scratchpad);
    const systemPrompt = buildEvalSystemPrompt();
    const options = { model: this.model, systemPrompt };

    const messages: LLMMessage[] = [
      { role: "user", content: userContent },
    ];

    // First attempt
    let response = await this.provider.complete(messages, options);
    let totalTokens = response.tokensUsed.input + response.tokensUsed.output;

    const firstResult = this.tryParse(response.text);
    if (firstResult) {
      return { ...firstResult, tokensUsed: totalTokens };
    }

    // Retry with conversational context
    const retryMessages: LLMMessage[] = [
      { role: "user", content: userContent },
      { role: "assistant", content: response.text },
      { role: "user", content: buildEvalRetryPrompt() },
    ];

    response = await this.provider.complete(retryMessages, options);
    totalTokens += response.tokensUsed.input + response.tokensUsed.output;

    const retryResult = this.tryParse(response.text);
    if (retryResult) {
      return { ...retryResult, tokensUsed: totalTokens };
    }

    // Both attempts failed — return synthetic fail
    return {
      verdict: "fail",
      confidence: 0,
      feedback: `Evaluator produced unparseable response after retry: ${response.text.slice(0, 500)}`,
      tokensUsed: totalTokens,
    };
  }
}

// Export utilities for testing
export {
  buildEvalSystemPrompt as _buildEvalSystemPrompt,
  buildEvalUserMessage as _buildEvalUserMessage,
  buildEvalRetryPrompt as _buildEvalRetryPrompt,
  parseEvalResult as _parseEvalResult,
};
