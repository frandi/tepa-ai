import type {
  TepaConfig,
  TepaLogger,
  DeepPartial,
  TepaPrompt,
  TepaResult,
  LLMProvider,
  ToolDefinition,
  ToolRegistry,
  ToolSchema,
  EventMap,
  CycleMetadata,
  Plan,
  ExecutionResult,
  EvaluationResult,
  LogEntry,
} from "@tepa/types";
import { defineConfig } from "./config/define-config.js";
import { resolveModelCatalog } from "./config/model-catalog.js";
import { validatePrompt } from "./prompt/validator.js";
import { Planner } from "./core/planner.js";
import { Executor, type ExecutorOutput } from "./core/executor.js";
import { Evaluator } from "./core/evaluator.js";
import { Scratchpad } from "./core/scratchpad.js";
import { TokenTracker } from "./utils/token-tracker.js";
import { createConsoleLogger, LogEntryCollector } from "./utils/logger.js";
import { TepaTokenBudgetExceeded, TepaError } from "./utils/errors.js";
import { EventBus } from "./events/event-bus.js";
import { createDefaultBehaviors } from "./events/default-behaviors.js";

const SEPARATOR = "-".repeat(46);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Options for constructing a Tepa pipeline instance. */
export interface TepaOptions {
  /** Partial configuration merged with defaults. */
  config?: DeepPartial<TepaConfig>;
  /** Tools available to the pipeline's Planner and Executor. */
  tools: ToolDefinition[];
  /** LLM provider used by all pipeline components. */
  provider: LLMProvider;
  /** Optional event hook callbacks for pipeline lifecycle. */
  events?: EventMap;
  /** Optional external logger. If omitted, a built-in console logger is used. */
  logger?: TepaLogger;
}

/**
 * Inline ToolRegistry implementation so the core package
 * does not depend on @tepa/tools.
 */
class InlineToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  toSchema(): ToolSchema[] {
    return this.list().map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }
}

/** Data passed to prePlanner event callbacks. */
export interface PlannerInput {
  prompt: TepaPrompt;
  feedback?: string;
}

/** Data passed to preExecutor event callbacks. */
export interface ExecutorInput {
  plan: Plan;
  prompt: TepaPrompt;
  cycle: number;
  scratchpad: Scratchpad;
  previousResults?: ExecutionResult[];
}

/** Data passed to preEvaluator event callbacks. */
export interface EvaluatorInput {
  prompt: TepaPrompt;
  results: ExecutionResult[];
  scratchpad: Scratchpad;
}

/**
 * Main Tepa pipeline orchestrator.
 *
 * Runs the Planner → Executor → Evaluator cycle with event hooks,
 * self-correction on failure, and configurable termination limits.
 */
export class Tepa {
  private readonly config: TepaConfig;
  private readonly provider: LLMProvider;
  private readonly tools: ToolDefinition[];
  private readonly eventMap?: EventMap;
  private readonly externalLogger?: TepaLogger;

  constructor(options: TepaOptions) {
    this.config = defineConfig(options.config);
    this.provider = options.provider;
    this.tools = options.tools;
    this.eventMap = options.events;
    this.externalLogger = options.logger;
  }

  /**
   * Run the pipeline to completion.
   * Returns when the evaluator passes, max cycles are reached, or token budget is exhausted.
   */
  async run(promptInput: TepaPrompt): Promise<TepaResult> {
    const prompt = validatePrompt(promptInput);

    const registry = new InlineToolRegistry();
    for (const tool of this.tools) {
      registry.register(tool);
    }

    const scratchpad = new Scratchpad();
    const tokenTracker = new TokenTracker(this.config.limits.maxTokens);
    const logger = this.externalLogger ?? createConsoleLogger(this.config.logging.level);
    const collector = new LogEntryCollector();
    const defaults = createDefaultBehaviors(logger, collector, this.config);
    const eventBus = new EventBus(this.eventMap, defaults);

    const providerModels = this.provider.getModels();
    const modelCatalog = resolveModelCatalog(providerModels, this.config.model);

    const planner = new Planner(
      this.provider,
      registry,
      this.config.model.planner,
      modelCatalog,
      this.config.model.executor,
    );
    const executor = new Executor(registry, this.provider, this.config.model.executor);
    const evaluator = new Evaluator(this.provider, this.config.model.evaluator);

    const allLogs: LogEntry[] = [];
    let feedback: string | undefined;
    let lastResults: ExecutionResult[] = [];
    let lastEvaluation: EvaluationResult | undefined;
    let cyclesUsed = 0;
    let resultStatus: "pass" | "fail" | "terminated" = "fail";

    const pipelineStart = Date.now();

    // Start banner
    const goalPreview = prompt.goal
      ? prompt.goal.length > 60
        ? prompt.goal.slice(0, 60) + "..."
        : prompt.goal
      : "";
    logger.info(`> Pipeline started -- goal: "${goalPreview}"`);
    const bannerParts: string[] = [];
    if (this.tools.length > 0) bannerParts.push(`Tools: ${this.tools.length}`);
    bannerParts.push(
      `Limits: ${this.config.limits.maxCycles} cycles, ${this.config.limits.maxTokens} tokens`,
    );
    if (bannerParts.length > 0) logger.info(`  ${bannerParts.join(" | ")}`);
    logger.info(SEPARATOR, { decorative: true });

    try {
      for (let cycle = 1; cycle <= this.config.limits.maxCycles; cycle++) {
        cyclesUsed = cycle;

        const cycleMeta: CycleMetadata = {
          cycleNumber: cycle,
          totalCyclesUsed: cycle - 1,
          tokensUsed: tokenTracker.getUsed(),
        };

        // --- Planner ---
        let plannerInput: PlannerInput = { prompt, feedback };
        plannerInput = await eventBus.run("prePlanner", plannerInput, cycleMeta);

        const planResult = await planner.plan(
          plannerInput.prompt,
          plannerInput.feedback,
          scratchpad,
        );
        tokenTracker.add(planResult.tokensUsed, this.config.model.planner);

        const plan = await eventBus.run("postPlanner", planResult.plan, cycleMeta);

        // --- Executor ---
        let executorInput: ExecutorInput = {
          plan,
          prompt,
          cycle,
          scratchpad,
          previousResults: lastResults.length > 0 ? lastResults : undefined,
        };
        executorInput = await eventBus.run("preExecutor", executorInput, cycleMeta);

        const executorOutput: ExecutorOutput = await executor.execute(
          executorInput.plan,
          {
            prompt: executorInput.prompt,
            cycle: executorInput.cycle,
            scratchpad: executorInput.scratchpad,
            previousResults: executorInput.previousResults,
          },
          eventBus,
          cycleMeta,
        );
        for (const [model, tokens] of executorOutput.tokensByModel) {
          tokenTracker.add(tokens, model);
        }
        allLogs.push(...executorOutput.logs);

        const executorResult = await eventBus.run("postExecutor", executorOutput, cycleMeta);
        lastResults = executorResult.results;

        // Write execution summary to scratchpad so the planner has context on re-planning
        scratchpad.write(
          "_execution_summary",
          lastResults.map((r) => ({
            stepId: r.stepId,
            status: r.status,
            output: r.output,
            ...(r.error ? { error: r.error } : {}),
          })),
        );

        // --- Evaluator ---
        let evaluatorInput: EvaluatorInput = {
          prompt,
          results: executorResult.results,
          scratchpad,
        };
        evaluatorInput = await eventBus.run("preEvaluator", evaluatorInput, cycleMeta);

        const evaluation = await evaluator.evaluate(
          evaluatorInput.prompt,
          evaluatorInput.results,
          evaluatorInput.scratchpad,
        );
        tokenTracker.add(evaluation.tokensUsed, this.config.model.evaluator);

        // Update cycle metadata with latest token count for postEvaluator
        const updatedCycleMeta: CycleMetadata = {
          ...cycleMeta,
          tokensUsed: tokenTracker.getUsed(),
        };

        lastEvaluation = await eventBus.run("postEvaluator", evaluation, updatedCycleMeta);

        if (lastEvaluation.verdict === "pass") {
          resultStatus = "pass";
          return {
            status: "pass",
            cycles: cyclesUsed,
            tokensUsed: tokenTracker.getUsed(),
            outputs: [],
            logs: allLogs,
            feedback: lastEvaluation.summary ?? "Pipeline completed successfully.",
          };
        }

        // Fail — feed feedback to next cycle's planner
        feedback = lastEvaluation.feedback;
      }

      // Max cycles exhausted
      resultStatus = "fail";
      return {
        status: "fail",
        cycles: cyclesUsed,
        tokensUsed: tokenTracker.getUsed(),
        outputs: [],
        logs: allLogs,
        feedback:
          lastEvaluation?.feedback ??
          `Max cycles (${this.config.limits.maxCycles}) reached without passing.`,
      };
    } catch (error) {
      if (error instanceof TepaTokenBudgetExceeded) {
        resultStatus = "terminated";
        return {
          status: "terminated",
          cycles: cyclesUsed,
          tokensUsed: error.tokensUsed,
          outputs: [],
          logs: allLogs,
          feedback: error.message,
        };
      }

      // Pipeline component errors (planner parse failures, cycle errors, etc.)
      // return a structured failure rather than crashing
      if (error instanceof TepaError) {
        resultStatus = "fail";
        return {
          status: "fail",
          cycles: cyclesUsed,
          tokensUsed: tokenTracker.getUsed(),
          outputs: [],
          logs: allLogs,
          feedback: error.message,
        };
      }

      throw new TepaError(
        `Pipeline failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      const durationMs = Date.now() - pipelineStart;

      // End banner
      logger.info(SEPARATOR, { decorative: true });
      const statusIcon = resultStatus === "pass" ? "[OK]" : "[FAIL]";
      const endParts: string[] = [];
      if (cyclesUsed > 0) endParts.push(`${cyclesUsed} cycle${cyclesUsed !== 1 ? "s" : ""}`);
      const tokensUsed = tokenTracker.getUsed();
      endParts.push(`${tokensUsed} tokens`);
      endParts.push(formatDuration(durationMs));
      logger.info(
        `${statusIcon} Pipeline completed -- ${resultStatus}${endParts.length > 0 ? ` | ${endParts.join(" | ")}` : ""}`,
      );

      // Model info
      const models = tokenTracker.getModels();
      if (models.length > 0) {
        const unique = [...new Set(models)];
        logger.info(`  Models: ${unique.join(", ")}`);
      }

      // Verbose details at debug level
      const tokensByModel = tokenTracker.getByModel();
      if (tokensByModel.size > 0) {
        const breakdown = [...tokensByModel.entries()]
          .map(([model, tokens]) => `${model}: ${tokens}`)
          .join(", ");
        logger.debug(`  Token breakdown: ${breakdown}`);
      }
      const pct = ((tokensUsed / this.config.limits.maxTokens) * 100).toFixed(1);
      logger.debug(`  Budget: ${tokensUsed}/${this.config.limits.maxTokens} (${pct}%)`);
    }
  }
}
