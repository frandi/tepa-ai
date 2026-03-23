import * as fs from "node:fs";
import * as path from "node:path";
import pino from "pino";
import pretty from "pino-pretty";

const DEFAULT_LOG_DIR = ".tepa/logs";

export interface SessionLogger {
  info(msg: string): void;
  error(msg: string): void;
  finalize(opts?: { llmLogPath?: string }): void;
  sessionLogPath: string;
}

export function createSessionLogger(opts?: { logDir?: string }): SessionLogger {
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

  const logger = pino(
    { level: "info" },
    pino.multistream([
      { stream: consoleStream, level: "info" },
      { stream: fileStream, level: "info" },
    ]),
  );

  return {
    sessionLogPath,

    info(msg: string) {
      logger.info(msg);
    },

    error(msg: string) {
      logger.error(msg);
    },

    finalize(finalOpts?: { llmLogPath?: string }) {
      if (finalOpts?.llmLogPath) {
        logger.info(`LLM call log: ${finalOpts.llmLogPath}`);
      }
      logger.info(`Session log: ${sessionLogPath}`);
    },
  };
}
