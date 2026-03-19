import type { TepaConfig, DeepPartial } from "@tepa/types";
import { z } from "zod";
import { DEFAULT_CONFIG } from "./defaults.js";
import { TepaConfigError } from "../utils/errors.js";

const modelConfigSchema = z.object({
  planner: z.string().min(1),
  executor: z.string().min(1),
  evaluator: z.string().min(1),
  allowedModels: z.array(z.string().min(1)).optional(),
});

const limitsConfigSchema = z.object({
  maxCycles: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  toolTimeout: z.number().int().positive(),
  retryAttempts: z.number().int().nonnegative(),
});

const loggingConfigSchema = z.object({
  level: z.enum(["minimal", "standard", "verbose"]),
  output: z.string().optional(),
});

const tepaConfigSchema = z.object({
  model: modelConfigSchema,
  limits: limitsConfigSchema,
  tools: z.array(z.string()),
  logging: loggingConfigSchema,
});

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal) &&
      targetVal !== null
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result;
}

/** Merge a partial configuration with sensible defaults and validate the result. */
export function defineConfig(partial: DeepPartial<TepaConfig> = {}): TepaConfig {
  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    partial as Record<string, unknown>,
  );

  const parsed = tepaConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new TepaConfigError(`Invalid configuration: ${issues}`);
  }

  return parsed.data;
}
