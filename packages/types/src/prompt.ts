export interface ExpectedOutput {
  path?: string;
  description: string;
  criteria?: string[];
}

export interface TepaPrompt {
  goal: string;
  context: Record<string, unknown>;
  expectedOutput: string | ExpectedOutput[];
}
