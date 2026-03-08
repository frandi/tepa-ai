import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(__dirname, "..");

// Load .env.local first, then .env as fallback
dotenv.config({ path: path.join(demoRoot, ".env.local") });
dotenv.config({ path: path.join(demoRoot, ".env") });

import { Tepa, parsePromptFile } from "tepa";
import type { Plan, PlanStep, EvaluationResult, PostStepPayload } from "@tepa/types";
import {
  fileReadTool,
  fileWriteTool,
  directoryListTool,
  fileSearchTool,
  shellExecuteTool,
  httpRequestTool,
} from "@tepa/tools";
import { AnthropicProvider } from "@tepa/provider-anthropic";

async function main() {
  // Load prompt from YAML file
  const promptPath = path.join(demoRoot, "prompts", "task.yaml");
  const prompt = await parsePromptFile(promptPath);

  // Resolve the project root to an absolute path
  const projectRoot = path.resolve(demoRoot, prompt.context.projectRoot as string);
  prompt.context.projectRoot = projectRoot;

  console.log("=== Tepa Demo: API Client Generation ===\n");
  console.log(`Goal: ${prompt.goal}`);
  console.log(`Project: ${projectRoot}\n`);

  // Shared state for step visualization
  const depthMap = new Map<string, number>();

  // Create the Tepa pipeline
  const tepa = new Tepa({
    tools: [
      fileReadTool,
      fileWriteTool,
      directoryListTool,
      fileSearchTool,
      shellExecuteTool,
      httpRequestTool,
    ],
    provider: new AnthropicProvider(),
    config: {
      limits: {
        maxCycles: 3,
        maxTokens: 400_000,
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
          console.log(`${indent}${step.id}: ${icon} — ${step.description} (${result.tokensUsed} tok, ${result.durationMs}ms)${model}`);
          if (result.error) {
            console.log(`${indent}  Error: ${result.error}`);
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

          console.log(`\n--- Plan (${plan.steps.length} steps) ---`);
          for (const step of plan.steps) {
            const depth = depthMap.get(step.id) ?? 0;
            const indent = "  " + "  ".repeat(depth);
            const tools = step.tools.length > 0 ? step.tools.join(", ") : "LLM reasoning";
            const deps = step.dependencies.length > 0 ? ` <- ${step.dependencies.join(", ")}` : "";
            const model = step.model ? ` [${step.model}]` : "";
            console.log(`${indent}${step.id}: ${step.description} (${tools})${deps}${model}`);
          }
          console.log();
        },
      ],
      postEvaluator: [
        (data: unknown) => {
          const result = data as EvaluationResult;
          const icon = result.verdict === "pass" ? "PASS" : "FAIL";
          console.log(`\n--- Evaluation: ${icon} (confidence: ${result.confidence}) ---`);
          if (result.feedback) console.log(`  Feedback: ${result.feedback}`);
          if (result.summary) console.log(`  Summary: ${result.summary}`);
          console.log();
        },
      ],
    },
  });

  // Run the pipeline
  const result = await tepa.run(prompt);

  // Print final result
  console.log("\n=== Result ===");
  console.log(`Status: ${result.status}`);
  console.log(`Cycles: ${result.cycles}`);
  console.log(`Tokens used: ${result.tokensUsed}`);
  console.log(`Feedback: ${result.feedback}`);

  if (result.logs.length > 0) {
    console.log(`\nExecution log: ${result.logs.length} entries`);
  }

  process.exit(result.status === "pass" ? 0 : 1);
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
