export interface ExecutionResult {
  stepId: string;
  status: "success" | "failure";
  output: unknown;
  error?: string;
  tokensUsed: number;
  durationMs: number;
}
