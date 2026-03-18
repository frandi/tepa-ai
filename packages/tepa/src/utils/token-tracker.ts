import { TepaTokenBudgetExceeded } from "./errors.js";

export class TokenTracker {
  private used = 0;
  private readonly budget: number;
  private readonly byModel = new Map<string, number>();

  constructor(budget: number) {
    this.budget = budget;
  }

  add(tokens: number, model?: string): void {
    this.used += tokens;
    if (model) {
      this.byModel.set(model, (this.byModel.get(model) ?? 0) + tokens);
    }
    if (this.used > this.budget) {
      throw new TepaTokenBudgetExceeded(this.used, this.budget);
    }
  }

  getUsed(): number {
    return this.used;
  }

  getBudget(): number {
    return this.budget;
  }

  getRemaining(): number {
    return Math.max(0, this.budget - this.used);
  }

  isExhausted(): boolean {
    return this.used >= this.budget;
  }

  /** Returns token usage broken down by model name. */
  getByModel(): Map<string, number> {
    return new Map(this.byModel);
  }

  /** Returns unique model names used, in order of first use. */
  getModels(): string[] {
    return [...this.byModel.keys()];
  }
}
