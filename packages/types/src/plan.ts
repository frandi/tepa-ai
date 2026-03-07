export interface PlanStep {
  id: string;
  description: string;
  tools: string[];
  expectedOutcome: string;
  dependencies: string[];
  /** Optional model override for this step's LLM call. Falls back to executor default. */
  model?: string;
}

export interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}
