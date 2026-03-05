import { z } from "zod";
import type { ParameterDef } from "@tepa/types";

const typeToZod: Record<ParameterDef["type"], () => z.ZodTypeAny> = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  object: () => z.record(z.unknown()),
  array: () => z.array(z.unknown()),
};

export function buildZodSchema(
  parameters: Record<string, ParameterDef>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(parameters)) {
    let fieldSchema = typeToZod[def.type]();

    if (!def.required && def.default === undefined) {
      fieldSchema = fieldSchema.optional();
    }

    if (def.default !== undefined) {
      fieldSchema = fieldSchema.default(def.default);
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

export function validateParams(
  params: Record<string, unknown>,
  parameters: Record<string, ParameterDef>,
): Record<string, unknown> {
  const schema = buildZodSchema(parameters);
  const result = schema.safeParse(params);

  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Parameter validation failed: ${messages.join("; ")}`);
  }

  return result.data as Record<string, unknown>;
}
