import { exec } from "node:child_process";
import path from "node:path";
import { defineTool } from "./define-tool.js";

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT_SIZE = 1_000_000;

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n... (output truncated)";
}

export const shellExecuteTool = defineTool({
  name: "shell_execute",
  description: "Execute a shell command and capture stdout, stderr, and exit code",
  parameters: {
    command: { type: "string", description: "Shell command to execute", required: true },
    cwd: { type: "string", description: "Working directory for the command" },
    timeout: {
      type: "number",
      description: "Timeout in milliseconds (default: 30000)",
      default: DEFAULT_TIMEOUT,
    },
  },
  execute: async (params) => {
    const command = params.command as string;
    const cwd = params.cwd ? path.resolve(params.cwd as string) : undefined;
    const timeout = (params.timeout as number) ?? DEFAULT_TIMEOUT;

    return new Promise((resolve) => {
      exec(command, { timeout, cwd }, (error, stdout, stderr) => {
        resolve({
          stdout: truncate(String(stdout), MAX_OUTPUT_SIZE),
          stderr: truncate(String(stderr), MAX_OUTPUT_SIZE),
          exitCode: error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0,
        });
      });
    });
  },
});
