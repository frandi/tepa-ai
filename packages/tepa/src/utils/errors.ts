export class TepaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TepaError";
  }
}

export class TepaConfigError extends TepaError {
  constructor(message: string) {
    super(message);
    this.name = "TepaConfigError";
  }
}

export class TepaPromptError extends TepaError {
  constructor(message: string) {
    super(message);
    this.name = "TepaPromptError";
  }
}

export class TepaToolError extends TepaError {
  constructor(message: string) {
    super(message);
    this.name = "TepaToolError";
  }
}

export class TepaCycleError extends TepaError {
  constructor(message: string) {
    super(message);
    this.name = "TepaCycleError";
  }
}

export class TepaTokenBudgetExceeded extends TepaError {
  public readonly tokensUsed: number;
  public readonly tokenBudget: number;

  constructor(tokensUsed: number, tokenBudget: number) {
    super(`Token budget exceeded: used ${tokensUsed} of ${tokenBudget} tokens`);
    this.name = "TepaTokenBudgetExceeded";
    this.tokensUsed = tokensUsed;
    this.tokenBudget = tokenBudget;
  }
}
