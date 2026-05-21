import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(__dirname, "..");

// Load .env.local first, then .env as fallback
dotenv.config({ path: path.join(demoRoot, ".env.local") });
dotenv.config({ path: path.join(demoRoot, ".env") });

import { Tepa, parsePromptFile } from "@tepa/core";
import type { Plan, PlanStep, EvaluationResult, PostStepPayload } from "@tepa/types";
import {
  fileReadTool,
  fileWriteTool,
  directoryListTool,
  dataParseTool,
  shellExecuteTool,
  scratchpadTool,
  logObserveTool,
} from "@tepa/tools";
import { GeminiProvider, GeminiModels } from "@tepa/provider-gemini";
import { createLlmvantageBridge } from "@tepa/observability-llmvantage";
import { createDemoLogger, type DemoLogger } from "./logger.js";

let logger: DemoLogger | undefined;
let provider: GeminiProvider | undefined;

async function main() {
  logger = createDemoLogger();

  // Load prompt from YAML file
  const promptPath = path.join(demoRoot, "prompts", "task.yaml");
  const prompt = await parsePromptFile(promptPath);

  // Resolve the class directory to an absolute path
  const classDir = path.resolve(demoRoot, prompt.context.classDir as string);
  prompt.context.classDir = classDir;

  logger.info("=== Tepa Demo: Student Progress Insights ===", { decorative: true });
  logger.info("", { decorative: true });
  logger.info(`Goal: ${prompt.goal}`);
  logger.info(`Data: ${classDir}`);
  logger.info("", { decorative: true });

  // Shared state for step visualization
  const depthMap = new Map<string, number>();

  // Create the LLM provider (logs all calls to a JSONL file)
  provider = new GeminiProvider({ logger });

  // Per-call cost rollup via @tepa/observability-llmvantage.
  // Pricing values are illustrative — verify against current Gemini pricing.
  const costBridge = createLlmvantageBridge({
    pricing: {
      gemini: {
        [GeminiModels.Gemini_3_5_Flash]: {
          inputPer1M: 0.3,
          outputPer1M: 2.5,
          cacheReadPer1M: 0.075,
        },
      },
    },
  });
  provider.onLog(costBridge.callback);

  // Create the Tepa pipeline
  const tepa = new Tepa({
    logger,
    tools: [
      fileReadTool,
      fileWriteTool,
      directoryListTool,
      dataParseTool,
      shellExecuteTool,
      scratchpadTool,
      logObserveTool,
    ],
    provider,
    config: {
      model: {
        planner: { id: GeminiModels.Gemini_3_5_Flash, reasoning: "high" },
        evaluator: { id: GeminiModels.Gemini_3_5_Flash, reasoning: "high" },
        executor: {
          low: { id: GeminiModels.Gemini_3_5_Flash, reasoning: "minimal" },
          high: { id: GeminiModels.Gemini_3_5_Flash, reasoning: "medium" },
        },
      },
      limits: {
        maxCycles: 3,
        maxTokens: 1_000_000,
      },
      logging: {
        level: "debug",
      },
    },
    events: {
      postStep: [
        (data: unknown) => {
          const { step, result } = data as PostStepPayload;
          const icon = result.status === "success" ? "OK" : "FAIL";
          const depth = depthMap.get(step.id) ?? 0;
          const indent = "  " + "  ".repeat(depth);
          const tier = step.tier ? ` [${step.tier}]` : "";
          logger!.info(
            `${indent}${step.id}: ${icon} — ${step.description} (${result.tokensUsed} tok, ${result.durationMs}ms)${tier}`,
          );
          if (result.error) {
            logger!.info(`${indent}  Error: ${result.error}`);
          }
        },
      ],
      postPlanner: [
        (data: unknown) => {
          const plan = data as Plan;
          // Build depth map from dependencies (BFS from roots)
          depthMap.clear();
          const childMap = new Map<string, string[]>();
          for (const s of plan.steps) {
            depthMap.set(s.id, 0);
            childMap.set(s.id, []);
          }
          for (const s of plan.steps) {
            for (const dep of s.dependencies) {
              if (childMap.has(dep)) childMap.get(dep)!.push(s.id);
            }
          }
          // BFS to compute depths
          const roots = plan.steps.filter((s) => s.dependencies.length === 0);
          const queue: PlanStep[] = [...roots];
          while (queue.length > 0) {
            const current = queue.shift()!;
            const currentDepth = depthMap.get(current.id)!;
            for (const childId of childMap.get(current.id)!) {
              const newDepth = currentDepth + 1;
              if (newDepth > (depthMap.get(childId) ?? 0)) {
                depthMap.set(childId, newDepth);
              }
              const child = plan.steps.find((s) => s.id === childId);
              if (child) queue.push(child);
            }
          }

          logger!.info("", { decorative: true });
          logger!.info(`--- Plan (${plan.steps.length} steps) ---`, { decorative: true });
          for (const step of plan.steps) {
            const depth = depthMap.get(step.id) ?? 0;
            const indent = "  " + "  ".repeat(depth);
            const tools = step.tools.length > 0 ? step.tools.join(", ") : "LLM reasoning";
            const deps = step.dependencies.length > 0 ? ` <- ${step.dependencies.join(", ")}` : "";
            const tier = step.tier ? ` [${step.tier}]` : "";
            logger!.info(`${indent}${step.id}: ${step.description} (${tools})${deps}${tier}`);
          }
          logger!.info("", { decorative: true });
        },
      ],
      postEvaluator: [
        (data: unknown) => {
          const result = data as EvaluationResult;
          const icon = result.verdict === "pass" ? "PASS" : "FAIL";
          logger!.info("", { decorative: true });
          logger!.info(`--- Evaluation: ${icon} (confidence: ${result.confidence}) ---`, {
            decorative: true,
          });
          if (result.feedback) logger!.info(`  Feedback: ${result.feedback}`);
          if (result.summary) logger!.info(`  Summary: ${result.summary}`);
          logger!.info("", { decorative: true });
        },
      ],
    },
  });

  // Run the pipeline
  const result = await tepa.run(prompt);

  // Print final result
  logger.info("", { decorative: true });
  logger.info("=== Result ===", { decorative: true });
  logger.info(`Status: ${result.status}`);
  logger.info(`Cycles: ${result.cycles}`);
  logger.info(`Tokens used: ${result.tokensUsed}`);
  logger.info(`Feedback: ${result.feedback}`);

  if (result.logs.length > 0) {
    logger.info("", { decorative: true });
    logger.info(`--- Pipeline Log (${result.logs.length} entries) ---`, { decorative: true });
    for (const entry of result.logs) {
      const stepInfo = entry.step ? ` [${entry.step}]` : "";
      const toolInfo = entry.tool ? ` (${entry.tool})` : "";
      logger.info(`  [cycle ${entry.cycle}]${stepInfo}${toolInfo} ${entry.message}`);
    }
  }

  const costSummary = costBridge.summary();
  const fmt = (n: number) => `$${n.toFixed(6)}`;
  logger.info("", { decorative: true });
  logger.info(`--- Cost Summary (${costSummary.cost.currency}) ---`, { decorative: true });
  logger.info(
    `  Calls: ${costSummary.calls} success / ${costSummary.retries} retry / ${costSummary.errors} error`,
  );
  logger.info(
    `  Tokens: input=${costSummary.tokens.input}, output=${costSummary.tokens.output}, cacheRead=${costSummary.tokens.cacheRead}, cacheWrite=${costSummary.tokens.cacheWrite}`,
  );
  logger.info(`  Total cost: ${fmt(costSummary.cost.total)}`);
  for (const [key, m] of Object.entries(costSummary.byModel)) {
    logger.info(
      `    ${key}: ${m.calls} calls, ${m.tokens.input}+${m.tokens.output} tok → ${fmt(m.cost)}`,
    );
  }
  if (costSummary.pricingMissing.length > 0) {
    logger.info(`  Missing pricing for: ${costSummary.pricingMissing.join(", ")}`);
  }

  logger.finalize({ llmLogPath: provider.getLogFilePath() });
  process.exit(result.status === "pass" ? 0 : 1);
}

main().catch((error) => {
  const log = logger ?? createDemoLogger();
  const message = error instanceof Error ? error.message : String(error);
  log.error(`\nDemo failed: ${message}`);

  if (/api key/i.test(message) || /authentication failed/i.test(message)) {
    log.error(
      "\nTo fix this, set up your Gemini API key:\n" +
        "  1. Get your key at https://aistudio.google.com/apikey\n" +
        "  2. Create a .env file in this demo directory with:\n" +
        "     GEMINI_API_KEY=...\n",
    );
  }

  log.finalize({ llmLogPath: provider?.getLogFilePath() });
  process.exit(1);
});
