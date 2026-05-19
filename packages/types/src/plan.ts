export interface PlanStep {
  id: string;
  description: string;
  tools: string[];
  expectedOutcome: string;
  dependencies: string[];
  /** Which executor tier should handle this step. Defaults to "low" if omitted. */
  tier?: "low" | "high";
}

export interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}
