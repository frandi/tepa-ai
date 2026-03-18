import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CycleMetadata, Plan, PostStepPayload, EvaluationResult } from "@tepa/types";
import type { ExecutorOutput } from "../../src/core/executor.js";
import { createDefaultBehaviors } from "../../src/events/default-behaviors.js";
import { Logger } from "../../src/utils/logger.js";

const baseCycle: CycleMetadata = {
  cycleNumber: 1,
  totalCyclesUsed: 0,
  tokensUsed: 0,
};

const defaultConfig = {
  model: { planner: "test-planner", executor: "test-executor", evaluator: "test-evaluator" },
  limits: { maxCycles: 5, maxTokens: 64000, toolTimeout: 30000, retryAttempts: 1 },
  tools: [] as string[],
  logging: { level: "standard" as const },
};

describe("createDefaultBehaviors", () => {
  let logger: Logger;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger({ level: "standard" });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("returns a DefaultBehaviorMap with handlers for all lifecycle events", () => {
    const behaviors = createDefaultBehaviors(logger, defaultConfig);
    expect(behaviors.prePlanner).toBeTypeOf("function");
    expect(behaviors.postPlanner).toBeTypeOf("function");
    expect(behaviors.preExecutor).toBeTypeOf("function");
    expect(behaviors.postStep).toBeTypeOf("function");
    expect(behaviors.postExecutor).toBeTypeOf("function");
    expect(behaviors.preEvaluator).toBeTypeOf("function");
    expect(behaviors.postEvaluator).toBeTypeOf("function");
  });

  describe("postPlanner", () => {
    it("logs plan step count", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);
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

      const output = consoleSpy.mock.calls[0]![0] as string;
      expect(output).toContain("2 steps");
      expect(output).toContain("Planning");
    });

    it("handles singular step count", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);
      const plan: Plan = {
        steps: [
          { id: "s1", description: "step 1", tools: [], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 500,
        reasoning: "test",
      };

      behaviors.postPlanner!(plan, baseCycle);

      const output = consoleSpy.mock.calls[0]![0] as string;
      expect(output).toContain("1 step");
      expect(output).not.toContain("1 steps");
    });
  });

  describe("postStep", () => {
    it("logs individual step results", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);

      // Set up plan step count via postPlanner
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
      consoleSpy.mockClear();

      // Reset step counter via preExecutor
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

      behaviors.postStep!(stepPayload, baseCycle);

      const output = consoleSpy.mock.calls[0]![0] as string;
      expect(output).toContain("step 1/2");
      expect(output).toContain("directory_list");
      expect(output).toContain("\u2713"); // checkmark
    });

    it("increments step counter across multiple steps", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);

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
      consoleSpy.mockClear();

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

      expect(consoleSpy.mock.calls[0]![0] as string).toContain("step 1/2");
      expect(consoleSpy.mock.calls[1]![0] as string).toContain("step 2/2");
    });
  });

  describe("postExecutor", () => {
    it("logs execution summary with success count", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);
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
      };

      behaviors.postExecutor!(output, baseCycle);

      const logOutput = consoleSpy.mock.calls[0]![0] as string;
      expect(logOutput).toContain("2/3 succeeded");
      expect(logOutput).toContain("Execution");
    });
  });

  describe("postEvaluator", () => {
    it("logs evaluation verdict and confidence", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);
      behaviors.preEvaluator!(undefined, baseCycle);

      const evaluation: EvaluationResult = {
        verdict: "pass",
        confidence: 0.97,
        summary: "Looks good",
        tokensUsed: 1200,
      };

      behaviors.postEvaluator!(evaluation, baseCycle);

      const logOutput = consoleSpy.mock.calls[0]![0] as string;
      expect(logOutput).toContain("pass");
      expect(logOutput).toContain("0.97");
      expect(logOutput).toContain("Evaluation");
    });

    it("calls budget in verbose mode", () => {
      const verboseLogger = new Logger({ level: "verbose" });
      const behaviors = createDefaultBehaviors(verboseLogger, defaultConfig);
      behaviors.preEvaluator!(undefined, baseCycle);

      const evaluation: EvaluationResult = {
        verdict: "pass",
        confidence: 0.95,
        tokensUsed: 1200,
      };

      const cycle: CycleMetadata = { cycleNumber: 1, totalCyclesUsed: 0, tokensUsed: 4000 };
      behaviors.postEvaluator!(evaluation, cycle);

      const allOutput = consoleSpy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("Budget:");
      expect(allOutput).toContain("5200/64000");
    });
  });

  describe("step counter reset", () => {
    it("resets step counter on preExecutor for new cycles", () => {
      const behaviors = createDefaultBehaviors(logger, defaultConfig);

      const plan: Plan = {
        steps: [
          { id: "s1", description: "a", tools: ["t1"], expectedOutcome: "ok", dependencies: [] },
        ],
        estimatedTokens: 500,
        reasoning: "test",
      };
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);
      consoleSpy.mockClear();

      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: { stepId: "s1", status: "success", output: null, tokensUsed: 0, durationMs: 100 },
          cycle: 1,
        },
        baseCycle,
      );
      expect(consoleSpy.mock.calls[0]![0] as string).toContain("step 1/1");

      // Simulate cycle 2 - preExecutor resets counter
      behaviors.preExecutor!(undefined, { cycleNumber: 2, totalCyclesUsed: 1, tokensUsed: 1000 });
      consoleSpy.mockClear();

      behaviors.postStep!(
        {
          step: plan.steps[0]!,
          result: { stepId: "s1", status: "success", output: null, tokensUsed: 0, durationMs: 100 },
          cycle: 2,
        },
        { cycleNumber: 2, totalCyclesUsed: 1, tokensUsed: 1000 },
      );
      expect(consoleSpy.mock.calls[0]![0] as string).toContain("step 1/1");
    });
  });

  describe("minimal mode", () => {
    it("does not print anything in minimal mode", () => {
      const minimalLogger = new Logger({ level: "minimal" });
      const behaviors = createDefaultBehaviors(minimalLogger, defaultConfig);

      const plan: Plan = {
        steps: [{ id: "s1", description: "a", tools: [], expectedOutcome: "ok", dependencies: [] }],
        estimatedTokens: 500,
        reasoning: "test",
      };

      behaviors.prePlanner!(undefined, baseCycle);
      behaviors.postPlanner!(plan, baseCycle);
      behaviors.preExecutor!(undefined, baseCycle);
      behaviors.postExecutor!({ results: [], logs: [], tokensUsed: 0 }, baseCycle);
      behaviors.preEvaluator!(undefined, baseCycle);
      behaviors.postEvaluator!({ verdict: "pass", confidence: 0.9, tokensUsed: 0 }, baseCycle);

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});
