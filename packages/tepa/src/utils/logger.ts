import type { LoggingConfig, LogEntry } from "@tepa/types";

export interface BannerInfo {
  goal?: string;
  maxCycles?: number;
  maxTokens?: number;
  toolCount?: number;
  status?: string;
  cycles?: number;
  tokensUsed?: number;
  durationMs?: number;
  /** Unique model names used during the pipeline run. */
  models?: string[];
  /** Token usage broken down by model name. */
  tokensByModel?: Map<string, number>;
}

export interface StageEntry {
  cycle: number;
  stage: string;
  message: string;
  tokensUsed?: number;
  durationMs?: number;
}

export interface StepEntry {
  cycle: number;
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  tool?: string;
  status: string;
  durationMs?: number;
  tokensUsed?: number;
  output?: unknown;
}

const SEPARATOR = "\u2500".repeat(46);

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function summarize(value: unknown, maxLength = 60): string {
  if (value == null) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

export class Logger {
  private readonly level: LoggingConfig["level"];
  private readonly entries: LogEntry[] = [];

  constructor(config: LoggingConfig) {
    this.level = config.level;
  }

  /** Pipeline-level start/end banner. */
  banner(type: "start" | "end", info: BannerInfo): void {
    if (this.level === "minimal") return;

    if (type === "start") {
      const goalPreview = info.goal
        ? info.goal.length > 60
          ? info.goal.slice(0, 60) + "..."
          : info.goal
        : "";
      console.log(`\u25B6 Pipeline started \u2014 goal: "${goalPreview}"`);
      const parts: string[] = [];
      if (info.toolCount != null) parts.push(`Tools: ${info.toolCount}`);
      if (info.maxCycles != null && info.maxTokens != null) {
        parts.push(`Limits: ${info.maxCycles} cycles, ${info.maxTokens} tokens`);
      }
      if (parts.length > 0) console.log(`  ${parts.join(" | ")}`);
      console.log(SEPARATOR);
    } else {
      console.log(SEPARATOR);
      const statusIcon = info.status === "pass" ? "\u2714" : "\u2718";
      const parts: string[] = [];
      if (info.cycles != null) parts.push(`${info.cycles} cycle${info.cycles !== 1 ? "s" : ""}`);
      if (this.level === "verbose" && info.tokensUsed != null && info.maxTokens != null) {
        const pct = ((info.tokensUsed / info.maxTokens) * 100).toFixed(1);
        parts.push(`${info.tokensUsed}/${info.maxTokens} tokens (${pct}%)`);
      } else if (info.tokensUsed != null) {
        parts.push(`${info.tokensUsed} tokens`);
      }
      if (info.durationMs != null) parts.push(formatDuration(info.durationMs));
      console.log(
        `${statusIcon} Pipeline completed \u2014 ${info.status}${parts.length > 0 ? ` \u00B7 ${parts.join(" \u00B7 ")}` : ""}`,
      );

      // Model info
      if (info.models && info.models.length > 0) {
        if (this.level === "verbose" && info.tokensByModel && info.tokensByModel.size > 0) {
          // Verbose: show per-model token breakdown
          const breakdown = [...info.tokensByModel.entries()]
            .map(([model, tokens]) => `${model}: ${tokens}`)
            .join(", ");
          console.log(`  Models: ${breakdown}`);
        } else {
          // Standard: show model names
          const unique = [...new Set(info.models)];
          console.log(`  Models: ${unique.join(", ")}`);
        }
      }
    }
  }

  /** Stage-level summary (planner/executor/evaluator). */
  stage(entry: StageEntry): void {
    const logEntry: LogEntry = {
      timestamp: Date.now(),
      cycle: entry.cycle,
      message: `${entry.stage}: ${entry.message}`,
      durationMs: entry.durationMs,
      tokensUsed: entry.tokensUsed,
    };
    this.entries.push(logEntry);

    if (this.level === "minimal") return;

    const prefix = `[cycle ${entry.cycle}]`;
    const stageName = entry.stage.charAt(0).toUpperCase() + entry.stage.slice(1);
    let line = `${prefix} ${stageName} \u00B7\u00B7\u00B7 ${entry.message}`;

    if (this.level === "verbose") {
      const details: string[] = [];
      if (entry.tokensUsed != null) details.push(`${entry.tokensUsed} tokens`);
      if (entry.durationMs != null) details.push(formatDuration(entry.durationMs));
      if (details.length > 0) line += ` (${details.join(", ")})`;
    } else {
      if (entry.durationMs != null) line += ` (${formatDuration(entry.durationMs)})`;
    }

    console.log(line);
  }

  /** Per-step result. */
  step(entry: StepEntry): void {
    const statusIcon = entry.status === "success" ? "\u2713" : "\u2717";
    const logEntry: LogEntry = {
      timestamp: Date.now(),
      cycle: entry.cycle,
      step: entry.stepId,
      tool: entry.tool,
      message: `Step ${entry.stepIndex}/${entry.totalSteps} ${statusIcon} ${entry.status}`,
      durationMs: entry.durationMs,
      tokensUsed: entry.tokensUsed,
    };
    this.entries.push(logEntry);

    if (this.level === "minimal") return;

    const prefix = `[cycle ${entry.cycle}]`;
    const toolInfo = entry.tool ? ` (${entry.tool})` : "";
    let line = `${prefix}   \u2192 step ${entry.stepIndex}/${entry.totalSteps}${toolInfo} ${statusIcon}`;

    if (entry.durationMs != null) line += ` ${formatDuration(entry.durationMs)}`;

    if (this.level === "verbose") {
      if (entry.tokensUsed != null) line += ` [${entry.tokensUsed} tokens]`;
      if (entry.output != null) {
        const preview = summarize(entry.output);
        if (preview) line += ` ${preview}`;
      }
    }

    console.log(line);
  }

  /** Token budget summary (verbose mode only, after evaluation). */
  budget(tokensUsed: number, maxTokens: number): void {
    if (this.level !== "verbose") return;
    const pct = ((tokensUsed / maxTokens) * 100).toFixed(1);
    console.log(`           Budget: ${tokensUsed}/${maxTokens} (${pct}%)`);
  }

  /** Legacy log method — still works for backward compatibility and custom use. */
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
