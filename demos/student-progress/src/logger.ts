import * as fs from "node:fs";
import * as path from "node:path";
import pino from "pino";
import pretty from "pino-pretty";
import type { TepaLogger, TepaLogMeta } from "@tepa/types";

const DEFAULT_LOG_DIR = ".tepa/logs";

export interface DemoLogger extends TepaLogger {
  finalize(opts?: { llmLogPath?: string }): void;
  sessionLogPath: string;
}

export function createDemoLogger(opts?: { logDir?: string }): DemoLogger {
  const logDir = path.resolve(opts?.logDir ?? DEFAULT_LOG_DIR);
  fs.mkdirSync(logDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionLogPath = path.join(logDir, `session-${timestamp}.log`);

  const consoleStream = pretty({
    colorize: true,
    sync: true,
    ignore: "pid,hostname,level,time",
    messageFormat: "{msg}",
    hideObject: true,
  });

  const fileStream = pretty({
    colorize: false,
    sync: true,
    ignore: "pid,hostname",
    destination: pino.destination({ dest: sessionLogPath, append: true, sync: true, mkdir: true }),
    translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
    hideObject: true,
  });

  // Separate loggers so we can conditionally skip the file stream
  // for decorative messages (separators, blank lines, section headers).
  const consoleLogger = pino({ level: "debug" }, consoleStream);
  const fileLogger = pino({ level: "debug" }, fileStream);

  function log(level: "debug" | "info" | "warn" | "error", msg: string, meta?: TepaLogMeta): void {
    consoleLogger[level](msg);
    if (!meta?.decorative) {
      fileLogger[level](msg);
    }
  }

  return {
    sessionLogPath,

    debug(msg: string, meta?: TepaLogMeta) {
      log("debug", msg, meta);
    },

    info(msg: string, meta?: TepaLogMeta) {
      log("info", msg, meta);
    },

    warn(msg: string, meta?: TepaLogMeta) {
      log("warn", msg, meta);
    },

    error(msg: string, meta?: TepaLogMeta) {
      log("error", msg, meta);
    },

    finalize(finalOpts?: { llmLogPath?: string }) {
      if (finalOpts?.llmLogPath) {
        log("info", `LLM call log: ${finalOpts.llmLogPath}`);
      }
      log("info", `Session log: ${sessionLogPath}`);
    },
  };
}
