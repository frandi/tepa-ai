import * as fs from "node:fs";
import * as path from "node:path";
import pino from "pino";
import pretty from "pino-pretty";
import type { TepaLogger } from "@tepa/types";

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

  const pinoLogger = pino(
    { level: "debug" },
    pino.multistream([
      { stream: consoleStream, level: "debug" },
      { stream: fileStream, level: "debug" },
    ]),
  );

  return {
    sessionLogPath,

    debug(msg: string) {
      pinoLogger.debug(msg);
    },

    info(msg: string) {
      pinoLogger.info(msg);
    },

    warn(msg: string) {
      pinoLogger.warn(msg);
    },

    error(msg: string) {
      pinoLogger.error(msg);
    },

    finalize(finalOpts?: { llmLogPath?: string }) {
      if (finalOpts?.llmLogPath) {
        pinoLogger.info(`LLM call log: ${finalOpts.llmLogPath}`);
      }
      pinoLogger.info(`Session log: ${sessionLogPath}`);
    },
  };
}
