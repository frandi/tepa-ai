import { z } from "zod";
import type { ToolDefinition, ParameterDef } from "@tepa/types";

const parameterDefSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().min(1, "Parameter description must be non-empty"),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const toolDefinitionSchema = z.object({
  name: z.string().min(1, "Tool name must be non-empty"),
  description: z.string().min(1, "Tool description must be non-empty"),
  parameters: z.record(parameterDefSchema),
  execute: z.function(),
});

/** Create a validated ToolDefinition. Throws if the schema is malformed. */
export function defineTool(definition: {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}): ToolDefinition {
  const result = toolDefinitionSchema.safeParse(definition);

  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid tool definition: ${messages.join("; ")}`);
  }

  return definition;
}
