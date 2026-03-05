export interface OutputArtifact {
  path: string;
  description: string;
  type: "file" | "data" | "report";
}

export interface LogEntry {
  timestamp: number;
  cycle: number;
  step?: string;
  tool?: string;
  message: string;
  durationMs?: number;
  tokensUsed?: number;
}

export interface TepaResult {
  status: "pass" | "fail" | "terminated";
  cycles: number;
  tokensUsed: number;
  outputs: OutputArtifact[];
  logs: LogEntry[];
  feedback: string;
}
