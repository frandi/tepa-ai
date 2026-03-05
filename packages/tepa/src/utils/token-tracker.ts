import { TepaTokenBudgetExceeded } from "./errors.js";

export class TokenTracker {
  private used = 0;
  private readonly budget: number;

  constructor(budget: number) {
    this.budget = budget;
  }

  add(tokens: number): void {
    this.used += tokens;
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
}
