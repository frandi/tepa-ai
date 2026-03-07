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
  CycleMetadata,
  EventMap,
} from "@tepa/types";
import {
  Tepa,
  type PlannerInput,
  type ExecutorInput,
  type EvaluatorInput,
} from "../../src/tepa.js";

// --- Helpers ---

function makeResponse(text: string, inputTokens = 10, outputTokens = 10): LLMResponse {
  return {
    text,
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "end_turn",
  };
}

function makePlanJson(
  steps: Array<{ id: string; description: string; tools: string[]; dependencies?: string[] }>,
): string {
  return JSON.stringify({
    reasoning: "Test plan",
    estimatedTokens: 100,
    steps: steps.map((s) => ({
      ...s,
      expectedOutcome: `${s.description} done`,
      dependencies: s.dependencies ?? [],
    })),
  });
}

function makeEvalJson(verdict: "pass" | "fail", extra: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = { verdict, confidence: 0.95 };
  if (verdict === "pass") base.summary = "All objectives met";
  if (verdict === "fail") base.feedback = "Incomplete results";
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
    description: `Mock ${name} tool`,
    parameters: {
      input: { type: "string", description: "Input value", required: true },
    },
    execute: vi.fn(async () => result),
  };
}

const samplePrompt: TepaPrompt = {
  goal: "Generate a report from data",
  context: { dataDir: "/tmp/data" },
  expectedOutput: "A report file at /tmp/data/report.md",
};

// --- Integration Tests ---

describe("Pipeline Integration", () => {
  describe("full pipeline — happy path", () => {
    it("completes single-cycle pass with correct TepaResult shape", async () => {
      const provider = createMockProvider([
        makeResponse(makePlanJson([
          { id: "step_1", description: "Read data", tools: ["file_read"] },
          { id: "step_2", description: "Write report", tools: ["file_write"], dependencies: ["step_1"] },
        ])),
        makeResponse('{"input": "data.csv"}'),    // executor params for step_1
        makeResponse('{"input": "report.md"}'),    // executor params for step_2
        makeResponse(makeEvalJson("pass", { summary: "Report generated successfully" })),
      ]);

      const fileRead = createMockTool("file_read", { content: "name,score\nAlice,95" });
      const fileWrite = createMockTool("file_write", { bytesWritten: 150 });

      const tepa = new Tepa({
        tools: [fileRead, fileWrite],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("pass");
      expect(result.cycles).toBe(1);
      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.feedback).toBe("Report generated successfully");
      expect(result.logs).toHaveLength(2);
      expect(result.logs[0]!.step).toBe("step_1");
      expect(result.logs[1]!.step).toBe("step_2");
      expect(result.outputs).toEqual([]);

      // Verify tools were actually invoked
      expect(fileRead.execute).toHaveBeenCalledTimes(1);
      expect(fileWrite.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("full pipeline — self-correction", () => {
    it("feeds evaluator feedback to planner on cycle 2", async () => {
      const provider = createMockProvider([
        // Cycle 1
        makeResponse(makePlanJson([{ id: "step_1", description: "Generate code", tools: ["gen"] }])),
        makeResponse('{"input": "v1"}'),
        makeResponse(makeEvalJson("fail", { feedback: "Missing error handling in generated code" })),
        // Cycle 2
        makeResponse(makePlanJson([{ id: "step_1", description: "Fix error handling", tools: ["gen"] }])),
        makeResponse('{"input": "v2"}'),
        makeResponse(makeEvalJson("pass", { summary: "Code with error handling complete" })),
      ]);

      const gen = createMockTool("gen", { code: "generated" });

      const tepa = new Tepa({
        tools: [gen],
        provider,
        config: { limits: { maxTokens: 100_000, maxCycles: 5 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("pass");
      expect(result.cycles).toBe(2);

      // Verify planner received feedback on cycle 2
      const calls = (provider.complete as ReturnType<typeof vi.fn>).mock.calls;
      // Call index 3 = cycle 2 planner call
      const plannerMsg = (calls[3]![0] as LLMMessage[])[0]!.content;
      expect(plannerMsg).toContain("Missing error handling");

      // Call index 3 should use revised planner system prompt
      const systemPrompt = (calls[3]![1] as LLMRequestOptions).systemPrompt!;
      expect(systemPrompt).toContain("revising");
    });
  });

  describe("full pipeline — max cycles termination", () => {
    it("returns fail status with feedback after exhausting max cycles", async () => {
      const provider = createMockProvider([
        // Cycle 1: fail
        makeResponse(makePlanJson([{ id: "step_1", description: "Try", tools: ["tool_a"] }])),
        makeResponse('{"input": "x"}'),
        makeResponse(makeEvalJson("fail", { feedback: "Not complete" })),
        // Cycle 2: fail
        makeResponse(makePlanJson([{ id: "step_1", description: "Retry", tools: ["tool_a"] }])),
        makeResponse('{"input": "y"}'),
        makeResponse(makeEvalJson("fail", { feedback: "Still not complete" })),
      ]);

      const tool = createMockTool("tool_a", "partial");

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxCycles: 2, maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("fail");
      expect(result.cycles).toBe(2);
      expect(result.feedback).toContain("Still not complete");
      expect(result.tokensUsed).toBeGreaterThan(0);
    });
  });

  describe("full pipeline — token budget termination", () => {
    it("returns terminated status when budget is exhausted", async () => {
      // Each call = 20 tokens. Budget = 45, so 3rd call (evaluator) exceeds it.
      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeResponse('{"input": "x"}'),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "result");

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 45 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("terminated");
      expect(result.feedback).toContain("Token budget exceeded");
    });
  });

  describe("full pipeline — event hooks", () => {
    it("fires all 6 event types in correct pipeline order", async () => {
      const order: string[] = [];

      const events: EventMap = {
        prePlanner: [() => { order.push("prePlanner"); }],
        postPlanner: [() => { order.push("postPlanner"); }],
        preExecutor: [() => { order.push("preExecutor"); }],
        postExecutor: [() => { order.push("postExecutor"); }],
        preEvaluator: [() => { order.push("preEvaluator"); }],
        postEvaluator: [() => { order.push("postEvaluator"); }],
      };

      const provider = createMockProvider([
        makeResponse(makePlanJson([{ id: "step_1", description: "Do", tools: ["tool_a"] }])),
        makeResponse('{"input": "x"}'),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "done");

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events,
      });

      await tepa.run(samplePrompt);

      expect(order).toEqual([
        "prePlanner",
        "postPlanner",
        "preExecutor",
        "postExecutor",
        "preEvaluator",
        "postEvaluator",
      ]);
    });

    it("fires all events on each cycle during self-correction", async () => {
      const eventCounts: Record<string, number> = {};

      const countEvent = (name: string) => () => {
        eventCounts[name] = (eventCounts[name] ?? 0) + 1;
      };

      const events: EventMap = {
        prePlanner: [countEvent("prePlanner")],
        postPlanner: [countEvent("postPlanner")],
        preExecutor: [countEvent("preExecutor")],
        postExecutor: [countEvent("postExecutor")],
        preEvaluator: [countEvent("preEvaluator")],
        postEvaluator: [countEvent("postEvaluator")],
      };

      const provider = createMockProvider([
        // Cycle 1: fail
        makeResponse(makePlanJson([{ id: "step_1", description: "Try", tools: ["tool_a"] }])),
        makeResponse('{"input": "x"}'),
        makeResponse(makeEvalJson("fail")),
        // Cycle 2: pass
        makeResponse(makePlanJson([{ id: "step_1", description: "Fix", tools: ["tool_a"] }])),
        makeResponse('{"input": "y"}'),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "done");

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events,
      });

      await tepa.run(samplePrompt);

      // Each event should have fired exactly 2 times (once per cycle)
      for (const name of Object.keys(eventCounts)) {
        expect(eventCounts[name]).toBe(2);
      }
    });

    it("provides accurate CycleMetadata to event callbacks", async () => {
      const captured: Array<{ event: string; meta: CycleMetadata }> = [];

      const capture = (name: string) => (_data: unknown, meta: unknown) => {
        captured.push({ event: name, meta: meta as CycleMetadata });
      };

      const events: EventMap = {
        prePlanner: [capture("prePlanner")],
        postEvaluator: [capture("postEvaluator")],
      };

      const provider = createMockProvider([
        // Cycle 1: fail
        makeResponse(makePlanJson([{ id: "step_1", description: "A", tools: ["tool_a"] }])),
        makeResponse('{"input": "x"}'),
        makeResponse(makeEvalJson("fail")),
        // Cycle 2: pass
        makeResponse(makePlanJson([{ id: "step_1", description: "B", tools: ["tool_a"] }])),
        makeResponse('{"input": "y"}'),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "ok");

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
        events,
      });

      await tepa.run(samplePrompt);

      // Cycle 1 prePlanner: cycle 1, 0 used, 0 tokens
      expect(captured[0]!.meta.cycleNumber).toBe(1);
      expect(captured[0]!.meta.totalCyclesUsed).toBe(0);
      expect(captured[0]!.meta.tokensUsed).toBe(0);

      // Cycle 2 prePlanner: cycle 2, 1 used, tokens > 0
      expect(captured[2]!.meta.cycleNumber).toBe(2);
      expect(captured[2]!.meta.totalCyclesUsed).toBe(1);
      expect(captured[2]!.meta.tokensUsed).toBeGreaterThan(0);
    });
  });

  describe("full pipeline — custom tool integration", () => {
    it("third-party tool defined with only @tepa/types works in the pipeline", async () => {
      // Simulate a third-party tool — defined using only the ToolDefinition interface
      const customDbTool: ToolDefinition = {
        name: "database_query",
        description: "Execute a SQL query against a database",
        parameters: {
          query: { type: "string", description: "SQL query", required: true },
          database: { type: "string", description: "Database name", required: true },
        },
        execute: vi.fn(async (params: Record<string, unknown>) => ({
          rows: [{ id: 1, name: "Alice" }],
          rowCount: 1,
          query: params.query,
        })),
      };

      const provider = createMockProvider([
        makeResponse(makePlanJson([
          { id: "step_1", description: "Query database", tools: ["database_query"] },
        ])),
        makeResponse('{"query": "SELECT * FROM users", "database": "mydb"}'),
        makeResponse(makeEvalJson("pass", { summary: "Query results retrieved" })),
      ]);

      const tepa = new Tepa({
        tools: [customDbTool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run({
        goal: "Get user data from database",
        context: { database: "mydb" },
        expectedOutput: "Query results with user records",
      });

      expect(result.status).toBe("pass");
      expect(customDbTool.execute).toHaveBeenCalledWith({
        query: "SELECT * FROM users",
        database: "mydb",
      });
    });
  });

  describe("full pipeline — mixed step types", () => {
    it("handles plans with both tool steps and LLM reasoning steps", async () => {
      const provider = createMockProvider([
        makeResponse(makePlanJson([
          { id: "step_1", description: "Read data file", tools: ["file_read"] },
          { id: "step_2", description: "Analyze patterns", tools: [], dependencies: ["step_1"] },
          { id: "step_3", description: "Write report", tools: ["file_write"], dependencies: ["step_2"] },
        ])),
        makeResponse('{"input": "data.csv"}'),                            // executor: step_1 params
        makeResponse("The data shows an upward trend in scores"),         // executor: step_2 reasoning
        makeResponse('{"input": "report.md"}'),                           // executor: step_3 params
        makeResponse(makeEvalJson("pass", { summary: "Analysis complete" })),
      ]);

      const fileRead = createMockTool("file_read", "name,score\nAlice,95");
      const fileWrite = createMockTool("file_write", { bytesWritten: 200 });

      const tepa = new Tepa({
        tools: [fileRead, fileWrite],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.status).toBe("pass");
      expect(result.logs).toHaveLength(3);
      // Step 2 should have no tool
      expect(result.logs[1]!.tool).toBeUndefined();
      expect(result.logs[1]!.message).toContain("completed");
    });
  });

  describe("full pipeline — token tracking accuracy", () => {
    it("accumulates tokens correctly across 2 cycles", async () => {
      // Each response: 10 input + 10 output = 20 tokens
      // Per cycle: planner(20) + executor(20) + evaluator(20) = 60
      // 2 cycles = 120 tokens total
      const provider = createMockProvider([
        // Cycle 1
        makeResponse(makePlanJson([{ id: "step_1", description: "A", tools: ["tool_a"] }])),
        makeResponse('{"input": "x"}'),
        makeResponse(makeEvalJson("fail")),
        // Cycle 2
        makeResponse(makePlanJson([{ id: "step_1", description: "B", tools: ["tool_a"] }])),
        makeResponse('{"input": "y"}'),
        makeResponse(makeEvalJson("pass")),
      ]);

      const tool = createMockTool("tool_a", "ok");

      const tepa = new Tepa({
        tools: [tool],
        provider,
        config: { limits: { maxTokens: 100_000 } },
      });

      const result = await tepa.run(samplePrompt);

      expect(result.tokensUsed).toBe(120);
    });
  });
});
