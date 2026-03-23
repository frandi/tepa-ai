import type {
  TepaConfig,
  TepaLogger,
  Plan,
  PostStepPayload,
  EvaluationResult,
  CycleMetadata,
  DefaultBehaviorMap,
} from "@tepa/types";
import type { ExecutorOutput } from "../core/executor.js";
import type { LogEntryCollector } from "../utils/logger.js";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function summarize(value: unknown, maxLength = 60): string {
  if (value == null) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/**
 * Creates the default behavior map for pipeline lifecycle events.
 * Default behaviors handle logging and are suppressed when a user
 * callback calls `preventDefault()` on the EventContext.
 */
export function createDefaultBehaviors(
  logger: TepaLogger,
  collector: LogEntryCollector,
  config: TepaConfig,
): DefaultBehaviorMap {
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

      const message = `${plan.steps.length} step${plan.steps.length !== 1 ? "s" : ""}`;
      collector.add({
        cycle: cycle.cycleNumber,
        message: `planning: ${message}`,
        durationMs,
      });

      const prefix = `[cycle ${cycle.cycleNumber}]`;
      const stageName = "Planning";
      let line = `${prefix} ${stageName} ... ${message}`;
      if (durationMs != null) line += ` (${formatDuration(durationMs)})`;
      logger.info(line);
    },

    preExecutor: () => {
      executorStart = Date.now();
      stepCounter = 0;
    },

    postStep: (data: unknown, cycle: CycleMetadata) => {
      const { step, result } = data as PostStepPayload;
      stepCounter++;

      const statusIcon = result.status === "success" ? "+" : "x";
      collector.add({
        cycle: cycle.cycleNumber,
        step: step.id,
        tool: step.tools.length > 0 ? step.tools.join(", ") : undefined,
        message: `Step ${stepCounter}/${planStepCount} ${statusIcon} ${result.status}`,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed,
      });

      const prefix = `[cycle ${cycle.cycleNumber}]`;
      const toolInfo = step.tools.length > 0 ? ` (${step.tools.join(", ")})` : "";
      let line = `${prefix}   -> step ${stepCounter}/${planStepCount}${toolInfo} ${statusIcon}`;
      if (result.durationMs != null) line += ` ${formatDuration(result.durationMs)}`;
      logger.info(line);

      // Detailed info at debug level
      if (result.tokensUsed != null) {
        logger.debug(`${prefix}       ${result.tokensUsed} tokens`);
      }
      if (result.output != null) {
        const preview = summarize(result.output);
        if (preview) logger.debug(`${prefix}       ${preview}`);
      }
    },

    postExecutor: (data: unknown, cycle: CycleMetadata) => {
      const output = data as ExecutorOutput;
      const succeeded = output.results.filter((r) => r.status === "success").length;
      const durationMs = executorStart > 0 ? Date.now() - executorStart : undefined;

      const message = `${succeeded}/${output.results.length} succeeded`;
      collector.add({
        cycle: cycle.cycleNumber,
        message: `execution: ${message}`,
        tokensUsed: output.tokensUsed,
        durationMs,
      });

      const prefix = `[cycle ${cycle.cycleNumber}]`;
      let line = `${prefix} Execution ... ${message}`;
      if (durationMs != null) line += ` (${formatDuration(durationMs)})`;
      logger.info(line);

      if (output.tokensUsed != null) {
        logger.debug(`${prefix}   ${output.tokensUsed} tokens`);
      }
    },

    preEvaluator: () => {
      evaluatorStart = Date.now();
    },

    postEvaluator: (data: unknown, cycle: CycleMetadata) => {
      const evaluation = data as EvaluationResult;
      const durationMs = evaluatorStart > 0 ? Date.now() - evaluatorStart : undefined;

      const message = `${evaluation.verdict} | confidence ${evaluation.confidence}`;
      collector.add({
        cycle: cycle.cycleNumber,
        message: `evaluation: ${message}`,
        tokensUsed: evaluation.tokensUsed,
        durationMs,
      });

      const prefix = `[cycle ${cycle.cycleNumber}]`;
      let line = `${prefix} Evaluation ... ${message}`;
      if (durationMs != null) line += ` (${formatDuration(durationMs)})`;
      logger.info(line);

      if (evaluation.tokensUsed != null) {
        logger.debug(`${prefix}   ${evaluation.tokensUsed} tokens`);
      }

      // Budget info at debug level (cycle.tokensUsed already includes evaluation tokens)
      const pct = ((cycle.tokensUsed / config.limits.maxTokens) * 100).toFixed(1);
      logger.debug(`           Budget: ${cycle.tokensUsed}/${config.limits.maxTokens} (${pct}%)`);
    },
  };
}
