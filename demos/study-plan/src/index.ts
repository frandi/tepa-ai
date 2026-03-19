import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.resolve(__dirname, "..");

// Load .env.local first, then .env as fallback
dotenv.config({ path: path.join(demoRoot, ".env.local") });
dotenv.config({ path: path.join(demoRoot, ".env") });

import { Tepa, parsePromptFile } from "@tepa/core";
import type { Plan, PlanStep, EvaluationResult, PostStepPayload } from "@tepa/types";
import { fileReadTool, fileWriteTool, directoryListTool, scratchpadTool } from "@tepa/tools";
import { OpenAIProvider, OpenAIModels } from "@tepa/provider-openai";

const rl = readline.createInterface({ input: stdin, output: stdout });

async function ask(question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim().toLowerCase();
}

async function main() {
  console.log("=== Tepa Demo: Study Plan (Human-in-the-Loop) ===\n");

  // Get user input
  const userInput = await rl.question("What would you like to study?\n> ");

  // Load prompt from YAML file
  const promptPath = path.join(demoRoot, "prompts", "task.yaml");
  const prompt = await parsePromptFile(promptPath);

  // Resolve paths to absolute
  const outputDir = path.resolve(demoRoot, prompt.context.outputDir as string);
  const outputFile = path.resolve(demoRoot, prompt.context.outputFile as string);
  prompt.context.outputDir = outputDir;
  prompt.context.outputFile = outputFile;

  // Inject user input into the prompt
  prompt.context.userInput = userInput;

  console.log(`\nGoal: ${prompt.goal}`);
  console.log(`User input: ${userInput}`);
  console.log(`Output: ${outputFile}\n`);

  // Shared state for step visualization
  const depthMap = new Map<string, number>();

  // Create the Tepa pipeline
  const tepa = new Tepa({
    tools: [fileReadTool, fileWriteTool, directoryListTool, scratchpadTool],
    provider: new OpenAIProvider(),
    config: {
      model: {
        planner: OpenAIModels.GPT_5,
        executor: OpenAIModels.GPT_5_Mini,
        evaluator: OpenAIModels.GPT_5,
      },
      limits: {
        maxCycles: 3,
        maxTokens: 250_000,
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
          console.log(
            `${indent}${step.id}: ${icon} — ${step.description} (${result.tokensUsed} tok, ${result.durationMs}ms)${model}`,
          );
          if (result.error) {
            console.log(`${indent}  Error: ${result.error}`);
          }
        },
      ],
      postPlanner: [
        async (data: unknown) => {
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

          // Human-in-the-loop: ask for plan approval
          const answer = await ask("\nDo you approve this plan? (yes/no): ");
          if (answer !== "yes" && answer !== "y") {
            console.log(
              "  [Note] Plan revision is not yet supported. Continuing with current plan.\n",
            );
          }
        },
      ],
      postEvaluator: [
        async (data: unknown) => {
          const result = data as EvaluationResult;
          const icon = result.verdict === "pass" ? "PASS" : "FAIL";
          console.log(`\n--- Evaluation: ${icon} (confidence: ${result.confidence}) ---`);
          if (result.feedback) console.log(`  Feedback: ${result.feedback}`);
          if (result.summary) console.log(`  Summary: ${result.summary}`);
          console.log();

          // Human-in-the-loop: ask whether to continue on failure
          if (result.verdict === "fail") {
            const answer = await ask("Continue with another cycle to improve? (yes/no): ");
            if (answer !== "yes" && answer !== "y") {
              console.log("  [User override] Accepting current results.\n");
              return { ...result, verdict: "pass" as const };
            }
          }
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

  rl.close();
  process.exit(result.status === "pass" ? 0 : 1);
}

main().catch((error) => {
  rl.close();
  const message = error instanceof Error ? error.message : String(error);
  console.error("\nDemo failed:", message);

  if (/api key/i.test(message) || /authentication failed/i.test(message)) {
    console.error(
      "\nTo fix this, set up your OpenAI API key:\n" +
        "  1. Get your key at https://platform.openai.com/api-keys\n" +
        "  2. Create a .env file in this demo directory with:\n" +
        "     OPENAI_API_KEY=sk-...\n",
    );
  }

  process.exit(1);
});
