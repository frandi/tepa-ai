import { describe, expect, it } from "vitest";
import type { LLMLogEntry } from "@tepa/types";
import { createLlmvantageBridge } from "../src/bridge.js";
import { costForTokens, defaultPricing } from "../src/cost.js";

function makeEntry(overrides: Partial<LLMLogEntry> = {}): LLMLogEntry {
  return {
    timestamp: "2026-05-21T00:00:00.000Z",
    provider: "anthropic",
    status: "success",
    durationMs: 100,
    attempt: 0,
    request: {
      model: "claude-sonnet-4-6",
      messageCount: 1,
      totalCharLength: 10,
      promptPreview: "hi",
      hasSystemPrompt: false,
    },
    response: {
      text: "ok",
      tokensUsed: { input: 1000, output: 500 },
      finishReason: "end_turn",
    },
    ...overrides,
  };
}

describe("costForTokens", () => {
  it("returns 0 when pricing is missing", () => {
    expect(costForTokens({ input: 1000, output: 500 }, undefined)).toBe(0);
  });

  it("computes input + output per 1M tokens", () => {
    // 1000 in * $3/M + 500 out * $15/M = 0.003 + 0.0075 = 0.0105
    const cost = costForTokens(
      { input: 1000, output: 500 },
      defaultPricing.anthropic["claude-sonnet-4-6"],
    );
    expect(cost).toBeCloseTo(0.0105, 10);
  });

  it("uses cacheReadPer1M and cacheWritePer1M when provided", () => {
    // 100 cache read * $0.3/M + 200 cache write * $3.75/M
    const cost = costForTokens(
      { input: 0, output: 0, cacheRead: 100, cacheWrite: 200 },
      defaultPricing.anthropic["claude-sonnet-4-6"],
    );
    expect(cost).toBeCloseTo((100 * 0.3 + 200 * 3.75) / 1_000_000, 10);
  });
});

describe("createLlmvantageBridge", () => {
  it("aggregates calls, retries, errors, and tokens", () => {
    const bridge = createLlmvantageBridge();
    bridge.callback(makeEntry());
    bridge.callback(
      makeEntry({ status: "retry", response: undefined, error: { message: "x", retryable: true } }),
    );
    bridge.callback(
      makeEntry({
        status: "error",
        response: undefined,
        error: { message: "x", retryable: false },
      }),
    );
    bridge.callback(
      makeEntry({
        response: { text: "ok", tokensUsed: { input: 200, output: 100 }, finishReason: "end_turn" },
      }),
    );

    const summary = bridge.summary();
    expect(summary.calls).toBe(2);
    expect(summary.retries).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.tokens.input).toBe(1200);
    expect(summary.tokens.output).toBe(600);
    expect(summary.cost.currency).toBe("USD");
    expect(summary.cost.total).toBeGreaterThan(0);
  });

  it("reports models with missing pricing", () => {
    const bridge = createLlmvantageBridge({
      pricing: {},
      ignoreDefaultPricing: true,
    });
    bridge.callback(makeEntry());
    const summary = bridge.summary();
    expect(summary.pricingMissing).toEqual(["anthropic:claude-sonnet-4-6"]);
    expect(summary.cost.total).toBe(0);
  });

  it("merges user pricing on top of defaults", () => {
    const bridge = createLlmvantageBridge({
      pricing: {
        anthropic: {
          "claude-sonnet-4-6": { inputPer1M: 10, outputPer1M: 20 },
        },
      },
    });
    bridge.callback(makeEntry()); // 1000 in, 500 out → (1000*10 + 500*20) / 1e6 = 0.02
    expect(bridge.summary().cost.total).toBeCloseTo(0.02, 10);
  });

  it("groups by provider and model", () => {
    const bridge = createLlmvantageBridge();
    bridge.callback(makeEntry());
    bridge.callback(
      makeEntry({ provider: "openai", request: { ...makeEntry().request, model: "gpt-5-mini" } }),
    );
    const s = bridge.summary();
    expect(s.byProvider.anthropic.calls).toBe(1);
    expect(s.byProvider.openai.calls).toBe(1);
    expect(s.byModel["anthropic:claude-sonnet-4-6"].calls).toBe(1);
    expect(s.byModel["openai:gpt-5-mini"].calls).toBe(1);
  });

  it("reset() clears accumulated state", () => {
    const bridge = createLlmvantageBridge();
    bridge.callback(makeEntry());
    bridge.reset();
    expect(bridge.summary().calls).toBe(0);
  });
});
