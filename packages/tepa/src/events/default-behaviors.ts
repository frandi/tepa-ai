import type {
  TepaConfig,
  Plan,
  PostStepPayload,
  EvaluationResult,
  CycleMetadata,
  DefaultBehaviorMap,
} from "@tepa/types";
import type { ExecutorOutput } from "../core/executor.js";
import type { Logger } from "../utils/logger.js";

/**
 * Creates the default behavior map for pipeline lifecycle events.
 * Default behaviors handle logging and are suppressed when a user
 * callback calls `preventDefault()` on the EventContext.
 */
export function createDefaultBehaviors(logger: Logger, config: TepaConfig): DefaultBehaviorMap {
  // Track stage timing and step indexing via closures
  let plannerStart = 0;
  let executorStart = 0;
  let evaluatorStart = 0;
  let planStepCount = 0;
  let stepCounter = 0;

  return {
    prePlanner: () => {
      plannerStart = Date.now();
    },

    postPlanner: (data: unknown, cycle: CycleMetadata) => {
      const plan = data as Plan;
      const durationMs = plannerStart > 0 ? Date.now() - plannerStart : undefined;
      planStepCount = plan.steps.length;
      logger.stage({
        cycle: cycle.cycleNumber,
        stage: "planning",
        message: `${plan.steps.length} step${plan.steps.length !== 1 ? "s" : ""}`,
        durationMs,
      });
    },

    preExecutor: () => {
      executorStart = Date.now();
      stepCounter = 0;
    },

    postStep: (data: unknown, cycle: CycleMetadata) => {
      const { step, result } = data as PostStepPayload;
      stepCounter++;
      logger.step({
        cycle: cycle.cycleNumber,
        stepId: step.id,
        stepIndex: stepCounter,
        totalSteps: planStepCount,
        tool: step.tools.length > 0 ? step.tools.join(", ") : undefined,
        status: result.status,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed,
        output: result.output,
      });
    },

    postExecutor: (data: unknown, cycle: CycleMetadata) => {
      const output = data as ExecutorOutput;
      const succeeded = output.results.filter((r) => r.status === "success").length;
      const durationMs = executorStart > 0 ? Date.now() - executorStart : undefined;
      logger.stage({
        cycle: cycle.cycleNumber,
        stage: "execution",
        message: `${succeeded}/${output.results.length} succeeded`,
        tokensUsed: output.tokensUsed,
        durationMs,
      });
    },

    preEvaluator: () => {
      evaluatorStart = Date.now();
    },

    postEvaluator: (data: unknown, cycle: CycleMetadata) => {
      const evaluation = data as EvaluationResult;
      const durationMs = evaluatorStart > 0 ? Date.now() - evaluatorStart : undefined;
      logger.stage({
        cycle: cycle.cycleNumber,
        stage: "evaluation",
        message: `${evaluation.verdict} \u00B7 confidence ${evaluation.confidence}`,
        tokensUsed: evaluation.tokensUsed,
        durationMs,
      });
      logger.budget(cycle.tokensUsed + evaluation.tokensUsed, config.limits.maxTokens);
    },
  };
}
