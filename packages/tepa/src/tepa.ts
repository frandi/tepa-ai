import type {
  TepaConfig,
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
import { validatePrompt } from "./prompt/validator.js";
import { Planner } from "./core/planner.js";
import { Executor, type ExecutorOutput } from "./core/executor.js";
import { Evaluator } from "./core/evaluator.js";
import { Scratchpad } from "./core/scratchpad.js";
import { TokenTracker } from "./utils/token-tracker.js";
import { Logger } from "./utils/logger.js";
import { TepaTokenBudgetExceeded, TepaError } from "./utils/errors.js";
import { EventBus } from "./events/event-bus.js";

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

  constructor(options: TepaOptions) {
    this.config = defineConfig(options.config);
    this.provider = options.provider;
    this.tools = options.tools;
    this.eventMap = options.events;
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
    const logger = new Logger(this.config.logging);
    const eventBus = new EventBus(this.eventMap);

    const planner = new Planner(
      this.provider,
      registry,
      this.config.model.planner,
      this.config.model,
    );
    const executor = new Executor(
      registry,
      this.provider,
      this.config.model.executor,
    );
    const evaluator = new Evaluator(
      this.provider,
      this.config.model.evaluator,
    );

    const allLogs: LogEntry[] = [];
    let feedback: string | undefined;
    let lastResults: ExecutionResult[] = [];
    let lastEvaluation: EvaluationResult | undefined;
    let cyclesUsed = 0;

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
        tokenTracker.add(planResult.tokensUsed);

        logger.log({
          cycle,
          message: `Plan generated with ${planResult.plan.steps.length} steps (${planResult.tokensUsed} tokens)`,
        });

        let plan = await eventBus.run("postPlanner", planResult.plan, cycleMeta);

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
        tokenTracker.add(executorOutput.tokensUsed);
        allLogs.push(...executorOutput.logs);

        logger.log({
          cycle,
          message: `Execution complete: ${executorOutput.results.filter((r) => r.status === "success").length}/${executorOutput.results.length} steps succeeded (${executorOutput.tokensUsed} tokens)`,
        });

        let executorResult = await eventBus.run(
          "postExecutor",
          executorOutput,
          cycleMeta,
        );
        lastResults = executorResult.results;

        // Write execution summary to scratchpad so the planner has context on re-planning
        scratchpad.write("_execution_summary", lastResults.map((r) => ({
          stepId: r.stepId,
          status: r.status,
          output: r.output,
          ...(r.error ? { error: r.error } : {}),
        })));

        // --- Evaluator ---
        let evaluatorInput: EvaluatorInput = {
          prompt,
          results: executorResult.results,
          scratchpad,
        };
        evaluatorInput = await eventBus.run(
          "preEvaluator",
          evaluatorInput,
          cycleMeta,
        );

        const evaluation = await evaluator.evaluate(
          evaluatorInput.prompt,
          evaluatorInput.results,
          evaluatorInput.scratchpad,
        );
        tokenTracker.add(evaluation.tokensUsed);

        logger.log({
          cycle,
          message: `Evaluation: ${evaluation.verdict} (confidence: ${evaluation.confidence}, ${evaluation.tokensUsed} tokens)`,
        });

        lastEvaluation = await eventBus.run(
          "postEvaluator",
          evaluation,
          cycleMeta,
        );

        if (lastEvaluation.verdict === "pass") {
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
    }
  }
}
