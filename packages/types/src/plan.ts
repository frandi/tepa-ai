export interface PlanStep {
  id: string;
  description: string;
  tools: string[];
  expectedOutcome: string;
  dependencies: string[];
}

export interface Plan {
  steps: PlanStep[];
  estimatedTokens: number;
  reasoning: string;
}
