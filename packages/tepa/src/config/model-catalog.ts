import type { ModelInfo, ModelConfig } from "@tepa/types";
import { TepaConfigError } from "../utils/errors.js";

/**
 * Resolve the effective model catalog from provider models and config.
 *
 * - Validates that planner, executor, evaluator model IDs exist in the provider catalog.
 * - If `allowedModels` is set, filters to only those IDs (auto-including the executor).
 * - If `allowedModels` is omitted, returns the full provider catalog.
 */
export function resolveModelCatalog(
  providerModels: ModelInfo[],
  modelConfig: ModelConfig,
): ModelInfo[] {
  const catalogMap = new Map(providerModels.map((m) => [m.id, m]));

  // Validate that planner/executor/evaluator exist in provider catalog
  for (const role of ["planner", "executor", "evaluator"] as const) {
    const modelId = modelConfig[role];
    if (!catalogMap.has(modelId)) {
      throw new TepaConfigError(
        `model.${role} "${modelId}" is not in the provider's model catalog. ` +
          `Available: ${providerModels.map((m) => m.id).join(", ")}`,
      );
    }
  }

  if (!modelConfig.allowedModels) {
    return [...providerModels];
  }

  // Validate allowedModels entries exist in catalog
  for (const id of modelConfig.allowedModels) {
    if (!catalogMap.has(id)) {
      throw new TepaConfigError(
        `allowedModels entry "${id}" is not in the provider's model catalog. ` +
          `Available: ${providerModels.map((m) => m.id).join(", ")}`,
      );
    }
  }

  // Build filtered set, auto-including executor
  const allowed = new Set(modelConfig.allowedModels);
  allowed.add(modelConfig.executor);

  return providerModels.filter((m) => allowed.has(m.id));
}
