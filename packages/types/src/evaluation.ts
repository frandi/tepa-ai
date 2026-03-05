export interface EvaluationResult {
  verdict: "pass" | "fail";
  confidence: number;
  feedback?: string;
  summary?: string;
  tokensUsed: number;
}
