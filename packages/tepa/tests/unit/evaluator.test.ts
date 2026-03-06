import { describe, it, expect, vi } from "vitest";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  LLMRequestOptions,
  TepaPrompt,
  ExecutionResult,
} from "@tepa/types";
import { Evaluator, _parseEvalResult } from "../../src/core/evaluator.js";
import { Scratchpad } from "../../src/core/scratchpad.js";

// --- Helpers ---

function createMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    complete: vi.fn(async (_messages: LLMMessage[], _options: LLMRequestOptions) => {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`No mock response for call index ${callIndex}`);
      }
      callIndex++;
      return response;
    }),
  };
}

function makeResponse(text: string, inputTokens = 30, outputTokens = 40): LLMResponse {
  return {
    text,
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "end_turn",
  };
}

const samplePrompt: TepaPrompt = {
  goal: "Create a hello world TypeScript file",
  context: { projectDir: "/tmp/project" },
  expectedOutput: "A file at /tmp/project/hello.ts that prints 'Hello World'",
};

const successResults: ExecutionResult[] = [
  {
    stepId: "step_1",
    status: "success",
    output: { bytesWritten: 42 },
    tokensUsed: 50,
    durationMs: 120,
  },
  {
    stepId: "step_2",
    status: "success",
    output: { content: "console.log('Hello World')" },
    tokensUsed: 30,
    durationMs: 80,
  },
];

const failedResults: ExecutionResult[] = [
  {
    stepId: "step_1",
    status: "success",
    output: { bytesWritten: 42 },
    tokensUsed: 50,
    durationMs: 120,
  },
  {
    stepId: "step_2",
    status: "failure",
    output: null,
    error: "File not found: /tmp/project/hello.ts",
    tokensUsed: 30,
    durationMs: 80,
  },
];

function makePassJson(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    verdict: "pass",
    confidence: 0.95,
    summary: "Successfully created hello.ts with Hello World output",
    ...overrides,
  });
}

function makeFailJson(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    verdict: "fail",
    confidence: 0.8,
    feedback:
      'Step "step_2" failed: file was not found at the expected path. The file_write in step_1 may have used the wrong path.',
    ...overrides,
  });
}

// --- Tests ---

describe("parseEvalResult", () => {
  it("parses a valid pass result", () => {
    const result = _parseEvalResult(JSON.parse(makePassJson()));
    expect(result.verdict).toBe("pass");
    expect(result.confidence).toBe(0.95);
    expect(result.summary).toContain("hello.ts");
  });

  it("parses a valid fail result", () => {
    const result = _parseEvalResult(JSON.parse(makeFailJson()));
    expect(result.verdict).toBe("fail");
    expect(result.confidence).toBe(0.8);
    expect(result.feedback).toContain("step_2");
  });

  it("rejects non-object input", () => {
    expect(() => _parseEvalResult("string")).toThrow("must be a JSON object");
    expect(() => _parseEvalResult(null)).toThrow("must be a JSON object");
  });

  it("rejects invalid verdict", () => {
    expect(() =>
      _parseEvalResult({ verdict: "maybe", confidence: 0.5 }),
    ).toThrow('"verdict"');
  });

  it("rejects confidence out of range", () => {
    expect(() =>
      _parseEvalResult({ verdict: "pass", confidence: 1.5 }),
    ).toThrow('"confidence"');
    expect(() =>
      _parseEvalResult({ verdict: "pass", confidence: -0.1 }),
    ).toThrow('"confidence"');
  });

  it("rejects fail without feedback", () => {
    expect(() =>
      _parseEvalResult({ verdict: "fail", confidence: 0.5 }),
    ).toThrow('"feedback"');
    expect(() =>
      _parseEvalResult({ verdict: "fail", confidence: 0.5, feedback: "" }),
    ).toThrow('"feedback"');
  });

  it("allows pass without summary", () => {
    const result = _parseEvalResult({ verdict: "pass", confidence: 0.9 });
    expect(result.verdict).toBe("pass");
    expect(result.summary).toBeUndefined();
  });
});

describe("Evaluator", () => {
  describe("evaluate — pass verdict", () => {
    it("returns pass for complete, correct execution results", async () => {
      const provider = createMockProvider([makeResponse(makePassJson())]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        successResults,
        new Scratchpad(),
      );

      expect(result.verdict).toBe("pass");
      expect(result.confidence).toBe(0.95);
      expect(result.summary).toContain("hello.ts");
      expect(result.tokensUsed).toBe(70); // 30 + 40
    });

    it("sends goal, expected output, and results to LLM", async () => {
      const provider = createMockProvider([makeResponse(makePassJson())]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      await evaluator.evaluate(samplePrompt, successResults, new Scratchpad());

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const messages = callArgs[0] as LLMMessage[];
      const userContent = messages[0]!.content;

      expect(userContent).toContain("Create a hello world TypeScript file");
      expect(userContent).toContain("hello.ts");
      expect(userContent).toContain("step_1");
      expect(userContent).toContain("step_2");
      expect(userContent).toContain("success");
    });

    it("includes scratchpad state in LLM context", async () => {
      const provider = createMockProvider([makeResponse(makePassJson())]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");
      const scratchpad = new Scratchpad();
      scratchpad.write("analysis", "Project structure looks good");

      await evaluator.evaluate(samplePrompt, successResults, scratchpad);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const messages = callArgs[0] as LLMMessage[];
      expect(messages[0]!.content).toContain("analysis");
      expect(messages[0]!.content).toContain("Project structure looks good");
    });

    it("uses the evaluation system prompt", async () => {
      const provider = createMockProvider([makeResponse(makePassJson())]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      await evaluator.evaluate(samplePrompt, successResults, new Scratchpad());

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = callArgs[1] as LLMRequestOptions;
      expect(options.systemPrompt).toContain("evaluation agent");
      expect(options.systemPrompt).toContain("Structural criteria");
      expect(options.systemPrompt).toContain("Qualitative criteria");
    });
  });

  describe("evaluate — fail verdict", () => {
    it("returns fail with specific feedback for incomplete results", async () => {
      const provider = createMockProvider([makeResponse(makeFailJson())]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        failedResults,
        new Scratchpad(),
      );

      expect(result.verdict).toBe("fail");
      expect(result.confidence).toBe(0.8);
      expect(result.feedback).toContain("step_2");
      expect(result.feedback).toContain("file was not found");
    });

    it("returns fail when expected outputs are missing", async () => {
      const missingOutputFeedback = makeFailJson({
        feedback: "Expected output file /tmp/project/hello.ts was never created. Step step_1 completed but produced no file artifact.",
      });
      const provider = createMockProvider([makeResponse(missingOutputFeedback)]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        failedResults,
        new Scratchpad(),
      );

      expect(result.verdict).toBe("fail");
      expect(result.feedback).toContain("Expected output file");
      expect(result.feedback).toContain("hello.ts");
    });

    it("feedback references specific steps", async () => {
      const detailedFeedback = makeFailJson({
        feedback: 'Step "step_1" wrote to wrong path /tmp/wrong.ts instead of /tmp/project/hello.ts. Step "step_2" consequently failed to read the file.',
      });
      const provider = createMockProvider([makeResponse(detailedFeedback)]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        failedResults,
        new Scratchpad(),
      );

      expect(result.feedback).toContain("step_1");
      expect(result.feedback).toContain("step_2");
      expect(result.feedback).toContain("wrong path");
    });
  });

  describe("evaluate — graceful handling of bad LLM output", () => {
    it("returns fail with raw text when LLM produces unparseable JSON", async () => {
      const provider = createMockProvider([
        makeResponse("I think everything looks fine but I can't format JSON"),
      ]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        successResults,
        new Scratchpad(),
      );

      expect(result.verdict).toBe("fail");
      expect(result.confidence).toBe(0);
      expect(result.feedback).toContain("unparseable");
    });

    it("returns fail when LLM response has invalid structure", async () => {
      const provider = createMockProvider([
        makeResponse(JSON.stringify({ verdict: "maybe", confidence: 2.0 })),
      ]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        successResults,
        new Scratchpad(),
      );

      expect(result.verdict).toBe("fail");
      expect(result.confidence).toBe(0);
      expect(result.feedback).toContain("validation failed");
    });

    it("handles JSON wrapped in markdown code fences", async () => {
      const wrappedJson = "```json\n" + makePassJson() + "\n```";
      const provider = createMockProvider([makeResponse(wrappedJson)]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        successResults,
        new Scratchpad(),
      );

      expect(result.verdict).toBe("pass");
    });
  });

  describe("evaluate — token tracking", () => {
    it("correctly reports token usage", async () => {
      const provider = createMockProvider([
        makeResponse(makePassJson(), 100, 200),
      ]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        successResults,
        new Scratchpad(),
      );

      expect(result.tokensUsed).toBe(300);
    });

    it("reports tokens even on parse failure", async () => {
      const provider = createMockProvider([
        makeResponse("not json", 50, 60),
      ]);
      const evaluator = new Evaluator(provider, "claude-sonnet-4-20250514");

      const result = await evaluator.evaluate(
        samplePrompt,
        successResults,
        new Scratchpad(),
      );

      expect(result.tokensUsed).toBe(110);
    });
  });
});
