import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { TepaConfig, DeepPartial } from "@tepa/types";
import { defineConfig } from "./define-config.js";
import { TepaConfigError } from "../utils/errors.js";

export async function loadConfig(filePath: string): Promise<TepaConfig> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    throw new TepaConfigError(`Failed to read config file: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  let raw: unknown;

  try {
    if (ext === ".yaml" || ext === ".yml") {
      raw = parseYaml(content);
    } else if (ext === ".json") {
      raw = JSON.parse(content);
    } else {
      throw new TepaConfigError(
        `Unsupported config file format: ${ext} (use .yaml, .yml, or .json)`,
      );
    }
  } catch (err) {
    if (err instanceof TepaConfigError) throw err;
    throw new TepaConfigError(`Failed to parse config file: ${filePath}`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TepaConfigError("Config file must contain an object");
  }

  return defineConfig(raw as DeepPartial<TepaConfig>);
}
