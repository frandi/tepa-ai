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
import { createSessionLogger, type SessionLogger } from "./logger.js";

let logger: SessionLogger | undefined;
let provider: GeminiProvider | undefined;

async function main() {
  logger = createSessionLogger();

  // Load prompt from YAML file
  const promptPath = path.join(demoRoot, "prompts", "task.yaml");
  const prompt = await parsePromptFile(promptPath);

  // Resolve the class directory to an absolute path
  const classDir = path.resolve(demoRoot, prompt.context.classDir as string);
  prompt.context.classDir = classDir;

  logger.info("=== Tepa Demo: Student Progress Insights ===\n");
  logger.info(`Goal: ${prompt.goal}`);
  logger.info(`Data: ${classDir}\n`);

  // Shared state for step visualization
  const depthMap = new Map<string, number>();

  // Create the LLM provider (logs all calls to a JSONL file)
  provider = new GeminiProvider();

  // Create the Tepa pipeline
  const tepa = new Tepa({
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
        planner: GeminiModels.Gemini_2_5_Pro,
        executor: GeminiModels.Gemini_2_5_Flash,
        evaluator: GeminiModels.Gemini_2_5_Pro,
        // Cost-conscious: stable 2.5 models for data analysis tasks
        allowedModels: [GeminiModels.Gemini_2_5_Flash, GeminiModels.Gemini_2_5_Pro],
      },
      limits: {
        maxCycles: 3,
        maxTokens: 1_000_000,
      },
      logging: {
        level: "verbose",
      },
    },
    events: {
      postStep: [
        (data: unknown) => {
          const { step, result } = data as PostStepPayload;
          const icon = result.status === "success" ? "OK" : "FAIL";
          const depth = depthMap.get(step.id) ?? 0;
          const indent = "  " + "  ".repeat(depth);
          const model = step.model ? ` [${step.model}]` : "";
          logger!.info(
            `${indent}${step.id}: ${icon} — ${step.description} (${result.tokensUsed} tok, ${result.durationMs}ms)${model}`,
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

          logger!.info(`\n--- Plan (${plan.steps.length} steps) ---`);
          for (const step of plan.steps) {
            const depth = depthMap.get(step.id) ?? 0;
            const indent = "  " + "  ".repeat(depth);
            const tools = step.tools.length > 0 ? step.tools.join(", ") : "LLM reasoning";
            const deps = step.dependencies.length > 0 ? ` <- ${step.dependencies.join(", ")}` : "";
            const model = step.model ? ` [${step.model}]` : "";
            logger!.info(`${indent}${step.id}: ${step.description} (${tools})${deps}${model}`);
          }
          logger!.info("");
        },
      ],
      postEvaluator: [
        (data: unknown) => {
          const result = data as EvaluationResult;
          const icon = result.verdict === "pass" ? "PASS" : "FAIL";
          logger!.info(`\n--- Evaluation: ${icon} (confidence: ${result.confidence}) ---`);
          if (result.feedback) logger!.info(`  Feedback: ${result.feedback}`);
          if (result.summary) logger!.info(`  Summary: ${result.summary}`);
          logger!.info("");
        },
      ],
    },
  });

  // Run the pipeline
  const result = await tepa.run(prompt);

  // Print final result
  logger.info("\n=== Result ===");
  logger.info(`Status: ${result.status}`);
  logger.info(`Cycles: ${result.cycles}`);
  logger.info(`Tokens used: ${result.tokensUsed}`);
  logger.info(`Feedback: ${result.feedback}`);

  if (result.logs.length > 0) {
    logger.info(`\n--- Pipeline Log (${result.logs.length} entries) ---`);
    for (const entry of result.logs) {
      const stepInfo = entry.step ? ` [${entry.step}]` : "";
      const toolInfo = entry.tool ? ` (${entry.tool})` : "";
      logger.info(`  [cycle ${entry.cycle}]${stepInfo}${toolInfo} ${entry.message}`);
    }
  }

  logger.finalize({ llmLogPath: provider.getLogFilePath() });
  process.exit(result.status === "pass" ? 0 : 1);
}

main().catch((error) => {
  const log = logger ?? createSessionLogger();
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
