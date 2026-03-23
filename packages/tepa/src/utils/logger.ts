import type { LogLevel, TepaLogger, LogEntry } from "@tepa/types";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function shouldLog(configured: LogLevel, attempted: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(attempted) >= LEVEL_ORDER.indexOf(configured);
}

/**
 * Creates a built-in console logger that respects the configured log level.
 * This is the default logger when no external logger is provided.
 */
export function createConsoleLogger(level: LogLevel): TepaLogger {
  return {
    debug(msg: string, meta?: Record<string, unknown>): void {
      if (!shouldLog(level, "debug")) return;
      meta ? console.log(msg, meta) : console.log(msg);
    },
    info(msg: string, meta?: Record<string, unknown>): void {
      if (!shouldLog(level, "info")) return;
      meta ? console.log(msg, meta) : console.log(msg);
    },
    warn(msg: string, meta?: Record<string, unknown>): void {
      if (!shouldLog(level, "warn")) return;
      meta ? console.warn(msg, meta) : console.warn(msg);
    },
    error(msg: string, meta?: Record<string, unknown>): void {
      if (!shouldLog(level, "error")) return;
      meta ? console.error(msg, meta) : console.error(msg);
    },
  };
}

/**
 * Collects structured LogEntry records in memory for result.logs.
 * Independent of the TepaLogger — always collects regardless of log level.
 */
export class LogEntryCollector {
  private readonly entries: LogEntry[] = [];

  add(entry: Omit<LogEntry, "timestamp">): void {
    this.entries.push({ ...entry, timestamp: Date.now() });
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }
}
