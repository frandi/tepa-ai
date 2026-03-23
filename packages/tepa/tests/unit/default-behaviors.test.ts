import { describe, it, expect, beforeEach } from "vitest";
import type {
  TepaLogger,
  CycleMetadata,
  Plan,
  PostStepPayload,
  EvaluationResult,
} from "@tepa/types";
import type { ExecutorOutput } from "../../src/core/executor.js";
import { createDefaultBehaviors } from "../../src/events/default-behaviors.js";
import { LogEntryCollector } from "../../src/utils/logger.js";

const baseCycle: CycleMetadata = {
  cycleNumber: 1,
  totalCyclesUsed: 0,
  tokensUsed: 0,
};

const defaultConfig = {
  model: { planner: "test-planner", executor: "test-executor", evaluator: "test-evaluator" },
  limits: { maxCycles: 5, maxTokens: 64000, toolTimeout: 30000, retryAttempts: 1 },
  tools: [] as string[],
  logging: { level: "info" as const },
};

function createMockLogger(): TepaLogger & { calls: Record<string, string[]> } {
  const calls: Record<string, string[]> = { debug: [], info: [], warn: [], error: [] };
  return {
    calls,
    debug(msg: string) {
      calls.debug.push(msg);
    },
    info(msg: string) {
      calls.info.push(msg);
    },
    warn(msg: string) {
      calls.warn.push(msg);
    },
    error(msg: string) {
      calls.error.push(msg);
    },
  };
}

describe("createDefaultBehaviors", () => {
  let logger: ReturnType<typeof createMockLogger>;
  let collector: LogEntryCollector;

  beforeEach(() => {
    logger = createMockLogger();
    collector = new LogEntryCollector();
  });

  it("returns a DefaultBehaviorMap with handlers for all lifecycle events", () => {
    const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
    expect(behaviors.prePlanner).toBeTypeOf("function");
    expect(behaviors.postPlanner).toBeTypeOf("function");
    expect(behaviors.preExecutor).toBeTypeOf("function");
    expect(behaviors.postStep).toBeTypeOf("function");
    expect(behaviors.postExecutor).toBeTypeOf("function");
    expect(behaviors.preEvaluator).toBeTypeOf("function");
    expect(behaviors.postEvaluator).toBeTypeOf("function");
  });

  describe("postPlanner", () => {
    it("logs plan step count via logger.info", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
      const plan: Plan = {
        steps: [
          {
            id: "s1",
            description: "step 1",
            tools: ["file_read"],
            expectedOutcome: "ok",
            dependencies: [],
          },
          {
            id: "s2",
            description: "step 2",
            tools: ["file_write"],
            expectedOutcome: "ok",
            dependencies: [],
          },
        ],
        estimatedTokens: 1000,
        reasoning: "test",
      };

      behaviors.prePlanner!(undefined, baseCycle);
      behaviors.postPlanner!(plan, baseCycle);

      expect(logger.calls.info[0]).toContain("2 steps");
      expect(logger.calls.info[0]).toContain("Planning");
    });

    it("collects entries in LogEntryCollector", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
      const plan: Plan = {
        steps: [
          { id: "s1", description: "step 1", tools: [], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 500,
        reasoning: "test",
      };

      behaviors.postPlanner!(plan, baseCycle);

      const entries = collector.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.message).toContain("planning");
    });

    it("handles singular step count", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
      const plan: Plan = {
        steps: [
          { id: "s1", description: "step 1", tools: [], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 500,
        reasoning: "test",
      };

      behaviors.postPlanner!(plan, baseCycle);

      expect(logger.calls.info[0]).toContain("1 step");
      expect(logger.calls.info[0]).not.toContain("1 steps");
    });
  });

  describe("postStep", () => {
    it("logs individual step results via logger.info", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);

      const plan: Plan = {
        steps: [
          {
            id: "s1",
            description: "list files",
            tools: ["directory_list"],
            expectedOutcome: "ok",
            dependencies: [],
          },
          {
            id: "s2",
            description: "write file",
            tools: ["file_write"],
            expectedOutcome: "ok",
            dependencies: [],
          },
        ],
        estimatedTokens: 1000,
        reasoning: "test",
      };
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);

      const stepPayload: PostStepPayload = {
        step: {
          id: "s1",
          description: "list files",
          tools: ["directory_list"],
          expectedOutcome: "ok",
          dependencies: [],
        },
        result: {
          stepId: "s1",
          status: "success",
          output: "file1.js, file2.js",
          tokensUsed: 300,
          durationMs: 500,
        },
        cycle: 1,
      };

      // Clear info calls from postPlanner
      logger.calls.info = [];
      behaviors.postStep!(stepPayload, baseCycle);

      expect(logger.calls.info[0]).toContain("step 1/2");
      expect(logger.calls.info[0]).toContain("directory_list");
      expect(logger.calls.info[0]).toContain("+"); // success icon
    });

    it("logs token and output details at debug level", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);

      const plan: Plan = {
        steps: [
          { id: "s1", description: "a", tools: ["t1"], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 500,
        reasoning: "test",
      };
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);

      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: {
            stepId: "s1",
            status: "success",
            output: "some output",
            tokensUsed: 300,
            durationMs: 100,
          },
          cycle: 1,
        },
        baseCycle,
      );

      expect(logger.calls.debug.some((m) => m.includes("300 tokens"))).toBe(true);
      expect(logger.calls.debug.some((m) => m.includes("some output"))).toBe(true);
    });

    it("increments step counter across multiple steps", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);

      const plan: Plan = {
        steps: [
          { id: "s1", description: "a", tools: ["t1"], expectedOutcome: "ok", dependencies: [] },
          { id: "s2", description: "b", tools: ["t2"], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 1000,
        reasoning: "test",
      };
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);
      logger.calls.info = [];

      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: { stepId: "s1", status: "success", output: null, tokensUsed: 0, durationMs: 100 },
          cycle: 1,
        },
        baseCycle,
      );
      behaviors.postStep!(
        {
          step: plan.steps[1]!,
          result: { stepId: "s2", status: "success", output: null, tokensUsed: 0, durationMs: 200 },
          cycle: 1,
        },
        baseCycle,
      );

      expect(logger.calls.info[0]).toContain("step 1/2");
      expect(logger.calls.info[1]).toContain("step 2/2");
    });
  });

  describe("postExecutor", () => {
    it("logs execution summary with success count", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
      behaviors.preExecutor!(undefined, baseCycle);

      const output: ExecutorOutput = {
        results: [
          { stepId: "s1", status: "success", output: "ok", tokensUsed: 500, durationMs: 100 },
          {
            stepId: "s2",
            status: "failure",
            output: null,
            error: "fail",
            tokensUsed: 200,
            durationMs: 50,
          },
          { stepId: "s3", status: "success", output: "ok", tokensUsed: 300, durationMs: 80 },
        ],
        logs: [],
        tokensUsed: 1000,
        tokensByModel: new Map([["test-executor", 1000]]),
      };

      behaviors.postExecutor!(output, baseCycle);

      const infoOutput = logger.calls.info.find((m) => m.includes("Execution"));
      expect(infoOutput).toContain("2/3 succeeded");
    });
  });

  describe("postEvaluator", () => {
    it("logs evaluation verdict and confidence", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
      behaviors.preEvaluator!(undefined, baseCycle);

      const evaluation: EvaluationResult = {
        verdict: "pass",
        confidence: 0.97,
        summary: "Looks good",
        tokensUsed: 1200,
      };

      behaviors.postEvaluator!(evaluation, baseCycle);

      const infoOutput = logger.calls.info.find((m) => m.includes("Evaluation"));
      expect(infoOutput).toContain("pass");
      expect(infoOutput).toContain("0.97");
    });

    it("logs budget info at debug level without double-counting evaluation tokens", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);
      behaviors.preEvaluator!(undefined, baseCycle);

      const evaluation: EvaluationResult = {
        verdict: "pass",
        confidence: 0.95,
        tokensUsed: 1200,
      };

      // In the real pipeline, cycle.tokensUsed already includes evaluation tokens
      // (set from tokenTracker.getUsed() after evaluator tokens are added)
      const cycle: CycleMetadata = { cycleNumber: 1, totalCyclesUsed: 0, tokensUsed: 4000 };
      behaviors.postEvaluator!(evaluation, cycle);

      expect(logger.calls.debug.some((m) => m.includes("Budget:"))).toBe(true);
      // Budget should use cycle.tokensUsed directly (4000), not cycle.tokensUsed + evaluation.tokensUsed
      expect(logger.calls.debug.some((m) => m.includes("4000/64000"))).toBe(true);
    });
  });

  describe("step counter reset", () => {
    it("resets step counter on preExecutor for new cycles", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);

      const plan: Plan = {
        steps: [
          { id: "s1", description: "a", tools: ["t1"], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 500,
        reasoning: "test",
      };
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);
      logger.calls.info = [];

      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: { stepId: "s1", status: "success", output: null, tokensUsed: 0, durationMs: 100 },
          cycle: 1,
        },
        baseCycle,
      );
      expect(logger.calls.info[0]).toContain("step 1/1");

      // Simulate cycle 2 - preExecutor resets counter
      behaviors.preExecutor!(undefined, { cycleNumber: 2, totalCyclesUsed: 1, tokensUsed: 1000 });
      logger.calls.info = [];

      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: { stepId: "s1", status: "success", output: null, tokensUsed: 0, durationMs: 100 },
          cycle: 2,
        },
        { cycleNumber: 2, totalCyclesUsed: 1, tokensUsed: 1000 },
      );
      expect(logger.calls.info[0]).toContain("step 1/1");
    });
  });

  describe("collector entries", () => {
    it("collects entries for all stage events", () => {
      const behaviors = createDefaultBehaviors(logger, collector, defaultConfig);

      const plan: Plan = {
        steps: [{ id: "s1", description: "a", tools: [], expectedOutcome: "ok", dependencies: [] }],
        estimatedTokens: 500,
        reasoning: "test",
      };

      behaviors.prePlanner!(undefined, baseCycle);
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);
      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: { stepId: "s1", status: "success", output: null, tokensUsed: 0, durationMs: 100 },
          cycle: 1,
        },
        baseCycle,
      );
      behaviors.postExecutor!(
        { results: [], logs: [], tokensUsed: 0, tokensByModel: new Map() },
        baseCycle,
      );
      behaviors.preEvaluator!(undefined, baseCycle);
      behaviors.postEvaluator!({ verdict: "pass", confidence: 0.9, tokensUsed: 0 }, baseCycle);

      const entries = collector.getEntries();
      // postPlanner + postStep + postExecutor + postEvaluator = 4 entries
      expect(entries).toHaveLength(4);
    });
  });
});
