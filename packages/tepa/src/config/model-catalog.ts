import type { ModelInfo, ModelConfig, RoleModel } from "@tepa/types";
import { TepaConfigError } from "../utils/errors.js";
import { resolveRoleModel } from "../utils/role-model.js";

/**
 * Validate that every model ID referenced by `modelConfig` exists in the
 * provider's catalog. Throws `TepaConfigError` listing the offending field
 * and the available IDs when a mismatch is found.
 */
export function validateModelConfig(providerModels: ModelInfo[], modelConfig: ModelConfig): void {
  const ids = new Set(providerModels.map((m) => m.id));
  const checks: Array<readonly [string, RoleModel]> = [
    ["model.planner", modelConfig.planner],
    ["model.evaluator", modelConfig.evaluator],
    ["model.executor.low", modelConfig.executor.low],
    ["model.executor.high", modelConfig.executor.high],
  ];

  for (const [path, roleModel] of checks) {
    const { id } = resolveRoleModel(roleModel);
    if (!ids.has(id)) {
      throw new TepaConfigError(
        `${path} "${id}" is not in the provider's model catalog. ` +
          `Available: ${providerModels.map((m) => m.id).join(", ")}`,
      );
    }
  }
}
