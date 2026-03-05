import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { TepaPrompt } from "@tepa/types";
import { validatePrompt } from "./validator.js";
import { TepaPromptError } from "../utils/errors.js";

export async function parsePromptFile(filePath: string): Promise<TepaPrompt> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    throw new TepaPromptError(`Failed to read prompt file: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  let raw: unknown;

  try {
    if (ext === ".yaml" || ext === ".yml") {
      raw = parseYaml(content);
    } else if (ext === ".json") {
      raw = JSON.parse(content);
    } else {
      throw new TepaPromptError(
        `Unsupported prompt file format: ${ext} (use .yaml, .yml, or .json)`,
      );
    }
  } catch (err) {
    if (err instanceof TepaPromptError) throw err;
    throw new TepaPromptError(`Failed to parse prompt file: ${filePath}`);
  }

  return validatePrompt(raw);
}
