import type { LogLevel, TepaLogger, TepaLogMeta, LogEntry } from "@tepa/types";

const LEVEL_ORDER: LogLevel[] = ["debug", "info", "warn", "error"];

function shouldLog(configured: LogLevel, attempted: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(attempted) >= LEVEL_ORDER.indexOf(configured);
}

/** Strip well-known internal keys so they don't clutter console output. */
function stripInternalMeta(meta?: TepaLogMeta): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const rest = Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "decorative"));
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * Creates a built-in console logger that respects the configured log level.
 * This is the default logger when no external logger is provided.
 *
 * The console logger always renders decorative messages (separators, blank
 * lines, section headers) since console is the human-readable channel.
 */
export function createConsoleLogger(level: LogLevel): TepaLogger {
  return {
    debug(msg: string, meta?: TepaLogMeta): void {
      if (!shouldLog(level, "debug")) return;
      const cleaned = stripInternalMeta(meta);
      if (cleaned) {
        console.log(msg, cleaned);
      } else {
        console.log(msg);
      }
    },
    info(msg: string, meta?: TepaLogMeta): void {
      if (!shouldLog(level, "info")) return;
      const cleaned = stripInternalMeta(meta);
      if (cleaned) {
        console.log(msg, cleaned);
      } else {
        console.log(msg);
      }
    },
    warn(msg: string, meta?: TepaLogMeta): void {
      if (!shouldLog(level, "warn")) return;
      const cleaned = stripInternalMeta(meta);
      if (cleaned) {
        console.warn(msg, cleaned);
      } else {
        console.warn(msg);
      }
    },
    error(msg: string, meta?: TepaLogMeta): void {
      if (!shouldLog(level, "error")) return;
      const cleaned = stripInternalMeta(meta);
      if (cleaned) {
        console.error(msg, cleaned);
      } else {
        console.error(msg);
      }
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
