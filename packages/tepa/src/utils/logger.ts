import type { LoggingConfig, LogEntry } from "@tepa/types";

export class Logger {
  private readonly level: LoggingConfig["level"];
  private readonly entries: LogEntry[] = [];

  constructor(config: LoggingConfig) {
    this.level = config.level;
  }

  log(entry: Omit<LogEntry, "timestamp">): void {
    const full: LogEntry = { ...entry, timestamp: Date.now() };
    this.entries.push(full);

    if (this.level === "minimal") return;

    const prefix = `[cycle ${full.cycle}]`;
    const stepInfo = full.step ? ` [step ${full.step}]` : "";
    const toolInfo = full.tool ? ` (${full.tool})` : "";
    const line = `${prefix}${stepInfo}${toolInfo} ${full.message}`;

    if (this.level === "verbose") {
      const duration = full.durationMs != null ? ` (${full.durationMs}ms)` : "";
      const tokens = full.tokensUsed != null ? ` [${full.tokensUsed} tokens]` : "";
      console.log(`${line}${duration}${tokens}`);
    } else {
      console.log(line);
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }
}
