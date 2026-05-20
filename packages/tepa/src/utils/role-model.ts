import type { ReasoningEffort, RoleModel } from "@tepa/types";

/**
 * Normalize a {@link RoleModel} (which may be a plain string or an object
 * carrying a reasoning hint) into an `{ id, reasoning }` pair.
 */
export function resolveRoleModel(roleModel: RoleModel): {
  id: string;
  reasoning?: ReasoningEffort;
} {
  if (typeof roleModel === "string") {
    return { id: roleModel };
  }
  return roleModel.reasoning !== undefined
    ? { id: roleModel.id, reasoning: roleModel.reasoning }
    : { id: roleModel.id };
}
