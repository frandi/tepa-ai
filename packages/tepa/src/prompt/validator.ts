import { z } from "zod";
import type { TepaPrompt } from "@tepa/types";
import { TepaPromptError } from "../utils/errors.js";

const expectedOutputObjectSchema = z.object({
  path: z.string().optional(),
  description: z.string().min(1),
  criteria: z.array(z.string()).optional(),
});

const tepaPromptSchema = z.object({
  goal: z.string().min(1, "Prompt must have a non-empty goal"),
  context: z.record(z.unknown()),
  expectedOutput: z.union([
    z.string().min(1, "expectedOutput string must be non-empty"),
    z.array(expectedOutputObjectSchema).min(1, "expectedOutput array must have at least one item"),
  ]),
});

/** Validate that the given data conforms to the TepaPrompt structure. Throws TepaPromptError on failure. */
export function validatePrompt(data: unknown): TepaPrompt {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TepaPromptError("Prompt must be an object");
  }

  const parsed = tepaPromptSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new TepaPromptError(`Invalid prompt: ${issues}`);
  }

  return parsed.data;
}
