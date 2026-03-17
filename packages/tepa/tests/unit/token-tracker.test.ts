import { describe, it, expect } from "vitest";
import { TokenTracker } from "../../src/utils/token-tracker.js";
import { TepaTokenBudgetExceeded } from "../../src/utils/errors.js";

describe("TokenTracker", () => {
  it("starts with zero tokens used", () => {
    const tracker = new TokenTracker(1000);
    expect(tracker.getUsed()).toBe(0);
    expect(tracker.getBudget()).toBe(1000);
    expect(tracker.getRemaining()).toBe(1000);
  });

  it("accumulates token usage", () => {
    const tracker = new TokenTracker(1000);
    tracker.add(100);
    expect(tracker.getUsed()).toBe(100);
    expect(tracker.getRemaining()).toBe(900);

    tracker.add(200);
    expect(tracker.getUsed()).toBe(300);
    expect(tracker.getRemaining()).toBe(700);
  });

  it("throws TepaTokenBudgetExceeded when budget is exceeded", () => {
    const tracker = new TokenTracker(500);
    tracker.add(400);

    expect(() => tracker.add(200)).toThrow(TepaTokenBudgetExceeded);
    try {
      tracker.add(200);
    } catch (err) {
      expect(err).toBeInstanceOf(TepaTokenBudgetExceeded);
      const e = err as TepaTokenBudgetExceeded;
      expect(e.tokensUsed).toBe(800);
      expect(e.tokenBudget).toBe(500);
    }
  });

  it("throws when exactly exceeding budget by 1", () => {
    const tracker = new TokenTracker(100);
    tracker.add(100);
    expect(() => tracker.add(1)).toThrow(TepaTokenBudgetExceeded);
  });

  it("does not throw when exactly at budget", () => {
    const tracker = new TokenTracker(100);
    expect(() => tracker.add(100)).not.toThrow();
    expect(tracker.isExhausted()).toBe(true);
    expect(tracker.getRemaining()).toBe(0);
  });

  it("reports exhaustion correctly", () => {
    const tracker = new TokenTracker(100);
    expect(tracker.isExhausted()).toBe(false);
    tracker.add(50);
    expect(tracker.isExhausted()).toBe(false);
    tracker.add(50);
    expect(tracker.isExhausted()).toBe(true);
  });

  it("tracks tokens by model name", () => {
    const tracker = new TokenTracker(10000);
    tracker.add(500, "claude-sonnet-4-6");
    tracker.add(300, "claude-haiku-4-5");
    tracker.add(200, "claude-sonnet-4-6");

    const byModel = tracker.getByModel();
    expect(byModel.get("claude-sonnet-4-6")).toBe(700);
    expect(byModel.get("claude-haiku-4-5")).toBe(300);
    expect(tracker.getUsed()).toBe(1000);
  });

  it("returns unique model names in order of first use", () => {
    const tracker = new TokenTracker(10000);
    tracker.add(100, "model-a");
    tracker.add(200, "model-b");
    tracker.add(300, "model-a");

    expect(tracker.getModels()).toEqual(["model-a", "model-b"]);
  });

  it("getByModel returns a copy", () => {
    const tracker = new TokenTracker(10000);
    tracker.add(100, "model-a");
    const byModel = tracker.getByModel();
    byModel.set("model-a", 999);
    expect(tracker.getByModel().get("model-a")).toBe(100);
  });

  it("add without model still tracks total but not per-model", () => {
    const tracker = new TokenTracker(10000);
    tracker.add(100);
    tracker.add(200, "model-a");

    expect(tracker.getUsed()).toBe(300);
    expect(tracker.getByModel().size).toBe(1);
    expect(tracker.getByModel().get("model-a")).toBe(200);
  });
});
