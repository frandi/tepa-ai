import * as fs from "node:fs";
import * as path from "node:path";
import type { LLMLogCallback } from "@tepa/types";

const DEFAULT_LOG_DIR = ".tepa/logs";

export interface FileLogWriter {
  callback: LLMLogCallback;
  filePath: string;
}

export function createFileLogWriter(dir?: string): FileLogWriter {
  const logDir = path.resolve(dir ?? DEFAULT_LOG_DIR);
  fs.mkdirSync(logDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(logDir, `llm-${timestamp}.jsonl`);

  const callback: LLMLogCallback = (entry) => {
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
  };

  return { callback, filePath };
}
