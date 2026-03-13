import { describe, it, expect, vi } from "vitest";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  LLMRequestOptions,
  ToolDefinition,
  TepaPrompt,
  Plan,
  EvaluationResult,
} from "@tepa/types";
import { Tepa, type EvaluatorInput } from "../../src/tepa.js";
import { TepaError } from "../../src/utils/errors.js";

// --- Helpers ---

function makeResponse(text: string, inputTokens = 10, outputTokens = 10): LLMResponse {
  return {
    text,
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "end_turn",
  };
}

/**
 * Create a response with native tool_use blocks.
 */
function makeToolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  inputTokens = 10,
  outputTokens = 10,
): LLMResponse {
  return {
    text: "",
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "tool_use",
    toolUse: [
      {
        id: `call_${toolName}_1`,
        name: toolName,
        input,
      },
    ],
  };
}

function makePlanJson(steps: Array<{ id: string; description: string; tools: string[] }>): string {
  const plan = {
    reasoning: "Test plan",
    estimatedTokens: 100,
    steps: steps.map((s) => ({
      ...s,
      expectedOutcome: `${s.description} done`,
      dependencies: [],
    })),
  };
  return JSON.stringify(plan);
}

function makeEvalJson(verdict: "pass" | "fail", extra: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = { verdict, confidence: 0.9 };
  if (verdict === "pass") base.summary = "All good";
  if (verdict === "fail") base.feedback = "Something failed";
  return JSON.stringify({ ...base, ...extra });
}

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

function createMockTool(name: string, result: unknown): ToolDefinition {
  return {
    name,
    description: `Mock ${name}`,
    parameters: {
      input: { type: "string", description: "Input", required: true },
    },
    execute: vi.fn(async () => result),
  };
}

const samplePrompt: TepaPrompt = {
  goal: "Create a test file",
  context: { dir: "/tmp" },
  expectedOutput: "A file at /tmp/test.ts",
};

// --- Tests ---

describe("Tepa", () => {
  describe("run — happy path", () => {
    it("completes in a single cycle when evaluator passes", async () => {
      // LLM calls: planner plan, executor tool_use, evaluator eval
      const provider = createMockProvider([
        makeResponse(
          makePlanJson([{ id: "step_1", description: "Write file", tools: ["file_write"] }]),
        ),
        makeToolUseResponse("file_write", { input: "hello" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("file_write", { bytesWritten: 5 });

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("pass");
      expect(result.cycles).toBe(1);
      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.feedback).toBe("All good");
      expect(tool.execute).toHaveBeenCalled();
    });
  });

  describe("run — self-correction", () => {
    it("cycle 1 fails, cycle 2 succeeds with feedback", async () => {
      const provider = createMockProvider([
        // Cycle 1: plan → exec tool_use → eval (fail)
        makeResponse(
          makePlanJson([{ id: "step_1", description: "Write file", tools: ["file_write"] }]),
        ),
        makeToolUseResponse("file_write", { input: "v1" }),
        makeResponse(makeEvalJson("fail", { feedback: "Missing header comment" })),
        // Cycle 2: revised plan → exec tool_use → eval (pass)
        makeResponse(
          makePlanJson([
            { id: "step_1", description: "Write file with header", tools: ["file_write"] },
          ]),
        ),
        makeToolUseResponse("file_write", { input: "v2" }),
        makeResponse(makeEvalJson("pass", { summary: "Fixed with header" })),
      ]);

      const tool = createMockTool("file_write", { ok: true });
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("pass");
      expect(result.cycles).toBe(2);
      expect(result.feedback).toBe("Fixed with header");

      // Verify planner received feedback on cycle 2
      const plannerCalls = (provider.complete as ReturnType<typeof vi.fn>).mock.calls;
      // Call index 3 is the second planner call — its user message should contain the feedback
      const secondPlannerMsg = (plannerCalls[3]![0] as LLMMessage[])[0]!.content;
      expect(secondPlannerMsg).toContain("Missing header comment");
    });
  });

  describe("run — termination conditions", () => {
    it("terminates on max cycles with fail status", async () => {
      const provider = createMockProvider([
        // Cycle 1: plan → exec → eval (fail)
        makeResponse(makePlanJson([{ id: "step_1", description: "Try", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("fail", { feedback: "Not good enough" })),
        // Cycle 2: plan → exec → eval (fail)
        makeResponse(makePlanJson([{ id: "step_1", description: "Try again", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "y" }),
        makeResponse(makeEvalJson("fail", { feedback: "Still not good" })),
      ]);

      const tool = createMockTool("tool_a", "output");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxCycles: 2, maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("fail");
      expect(result.cycles).toBe(2);
      expect(result.feedback).toContain("Still not good");
    });

    it("terminates on token budget exhaustion with terminated status", async () => {
      // Each response uses 20 tokens (10 input + 10 output)
      // Budget is 50 tokens — third LLM call (evaluator) will exceed it
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("fail")),
      ]);

      const tool = createMockTool("tool_a", "output");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 50 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("terminated");
      expect(result.feedback).toContain("Token budget exceeded");
    });
  });

  describe("run — event system", () => {
    it("prePlanner event can transform planner input", async () => {
      const modifiedPrompt: TepaPrompt = {
        goal: "Modified goal",
        context: { dir: "/modified" },
        expectedOutput: "Modified output",
      };

      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do it", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "done");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          prePlanner: [
            (data: unknown) => {
              const input = data as { prompt: TepaPrompt; feedback?: string };
              return { ...input, prompt: modifiedPrompt };
            },
          ],
        },
      });

      await tepa.run(samplePrompt);

      // The planner should have received the modified prompt
      const plannerCall = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const userMessage = (plannerCall[0] as LLMMessage[])[0]!.content;
      expect(userMessage).toContain("Modified goal");
    });

    it("postPlanner event can transform the plan", async () => {
      const provider = createMockProvider([
        makeResponse(
          makePlanJson([{ id: "step_1", description: "Original step", tools: ["tool_a"] }]),
        ),
        // Executor will use the injected plan's tool
        makeToolUseResponse("tool_b", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const toolA = createMockTool("tool_a", "a");
      const toolB = createMockTool("tool_b", "b");

      const tepa = new Tepa({
        tools: [toolA, toolB],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          postPlanner: [
            (data: unknown) => {
              const plan = data as Plan;
              return {
                ...plan,
                steps: plan.steps.map((s) => ({
                  ...s,
                  tools: ["tool_b"], // Swap all tools to tool_b
                })),
              };
            },
          ],
        },
      });

      await tepa.run(samplePrompt);

      // tool_b should have been called, not tool_a
      expect(toolB.execute).toHaveBeenCalled();
      expect(toolA.execute).not.toHaveBeenCalled();
    });

    it("postExecutor event can transform executor output", async () => {
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "original_output");
      const postExecutorSpy = vi.fn((data: unknown) => data);

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          postExecutor: [postExecutorSpy],
        },
      });

      await tepa.run(samplePrompt);

      expect(postExecutorSpy).toHaveBeenCalledTimes(1);
      const output = postExecutorSpy.mock.calls[0]![0] as { results: unknown[] };
      expect(output.results).toHaveLength(1);
    });

    it("preEvaluator event can transform evaluator input", async () => {
      const preEvalSpy = vi.fn((data: unknown) => data);

      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "done");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          preEvaluator: [preEvalSpy],
        },
      });

      await tepa.run(samplePrompt);

      expect(preEvalSpy).toHaveBeenCalledTimes(1);
      const input = preEvalSpy.mock.calls[0]![0] as EvaluatorInput;
      expect(input.prompt).toBeDefined();
      expect(input.results).toBeDefined();
      expect(input.scratchpad).toBeDefined();
    });

    it("postEvaluator event can transform evaluation result", async () => {
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        // Evaluator returns fail, but the event will override it to pass
        makeResponse(makeEvalJson("fail", { feedback: "Not good" })),
      ]);

      const tool = createMockTool("tool_a", "done");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          postEvaluator: [
            (data: unknown) => {
              const eval_ = data as EvaluationResult;
              return {
                ...eval_,
                verdict: "pass" as const,
                summary: "Overridden to pass",
              };
            },
          ],
        },
      });

      const result = await tepa.run(samplePrompt);
      expect(result.status).toBe("pass");
      expect(result.feedback).toBe("Overridden to pass");
    });

    it("async event callbacks pause the pipeline until resolved", async () => {
      const order: string[] = [];

      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "done");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          prePlanner: [
            async (data: unknown) => {
              await new Promise((r) => setTimeout(r, 20));
              order.push("prePlanner");
              return data;
            },
          ],
          postPlanner: [
            async (data: unknown) => {
              await new Promise((r) => setTimeout(r, 10));
              order.push("postPlanner");
              return data;
            },
          ],
        },
      });

      await tepa.run(samplePrompt);

      // Events should have fired in pipeline order
      expect(order).toEqual(["prePlanner", "postPlanner"]);
    });

    it("event callback throw aborts the pipeline", async () => {
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
      ]);

      const tool = createMockTool("tool_a", "done");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          postPlanner: [
            () => {
              throw new Error("Event abort!");
            },
          ],
        },
      });

      await expect(tepa.run(samplePrompt)).rejects.toThrow("Event abort!");
    });

    it("event callback with continueOnError does not abort", async () => {
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "done");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events: {
          postPlanner: [
            {
              handler: () => {
                throw new Error("Non-critical");
              },
              continueOnError: true,
            },
          ],
        },
      });

      const result = await tepa.run(samplePrompt);
      expect(result.status).toBe("pass");
    });
  });

  describe("run — cycle metadata", () => {
    it("events receive correct CycleMetadata on each cycle", async () => {
      const capturedMeta: Array<{ event: string; meta: unknown }> = [];

      const provider = createMockProvider([
        // Cycle 1: fail
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("fail", { feedback: "Nope" })),
        // Cycle 2: pass
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "y" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "ok");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxCycles: 3, maxTokens: 100_000 } },
        events: {
          prePlanner: [
            (_data: unknown, meta: unknown) => {
              capturedMeta.push({ event: "prePlanner", meta });
            },
          ],
          postEvaluator: [
            (_data: unknown, meta: unknown) => {
              capturedMeta.push({ event: "postEvaluator", meta });
            },
          ],
        },
      });

      await tepa.run(samplePrompt);

      // Cycle 1 prePlanner
      expect(capturedMeta[0]!.event).toBe("prePlanner");
      expect((capturedMeta[0]!.meta as { cycleNumber: number }).cycleNumber).toBe(1);
      expect((capturedMeta[0]!.meta as { totalCyclesUsed: number }).totalCyclesUsed).toBe(0);
      expect((capturedMeta[0]!.meta as { tokensUsed: number }).tokensUsed).toBe(0);

      // Cycle 1 postEvaluator
      expect(capturedMeta[1]!.event).toBe("postEvaluator");
      expect((capturedMeta[1]!.meta as { cycleNumber: number }).cycleNumber).toBe(1);

      // Cycle 2 prePlanner — should have accumulated tokens from cycle 1
      expect(capturedMeta[2]!.event).toBe("prePlanner");
      expect((capturedMeta[2]!.meta as { cycleNumber: number }).cycleNumber).toBe(2);
      expect((capturedMeta[2]!.meta as { totalCyclesUsed: number }).totalCyclesUsed).toBe(1);
      expect((capturedMeta[2]!.meta as { tokensUsed: number }).tokensUsed).toBeGreaterThan(0);
    });
  });

  describe("run — token accumulation", () => {
    it("accurately accumulates tokens across all components and cycles", async () => {
      // Each response: 10 input + 10 output = 20 tokens
      // Cycle 1: planner(20) + executor(20) + evaluator(20) = 60
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeToolUseResponse("tool_a", { input: "x" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "ok");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);
      expect(result.tokensUsed).toBe(60);
    });
  });

  describe("run — logs", () => {
    it("collects execution logs from all cycles", async () => {
      const provider = createMockProvider([
        makeResponse(
          makePlanJson([
            { id: "step_1", description: "A", tools: ["tool_a"] },
            { id: "step_2", description: "B", tools: ["tool_a"] },
          ]),
        ),
        makeToolUseResponse("tool_a", { input: "1" }),
        makeToolUseResponse("tool_a", { input: "2" }),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "ok");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);
      expect(result.logs.length).toBe(2);
      expect(result.logs[0]!.step).toBe("step_1");
      expect(result.logs[1]!.step).toBe("step_2");
    });
  });

  describe("run — error handling", () => {
    it("wraps unknown errors in TepaError", async () => {
      const provider: LLMProvider = {
        complete: vi.fn(async () => {
          throw new TypeError("Something unexpected");
        }),
      };

      const tool = createMockTool("tool_a", "ok");
      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      await expect(tepa.run(samplePrompt)).rejects.toThrow(TepaError);
      await expect(tepa.run(samplePrompt)).rejects.toThrow("Something unexpected");
    });
  });
});
