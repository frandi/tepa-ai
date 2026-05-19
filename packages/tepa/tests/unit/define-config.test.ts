import { describe, it, expect } from "vitest";
import { defineConfig } from "../../src/config/define-config.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { TepaConfigError } from "../../src/utils/errors.js";

describe("defineConfig", () => {
  it("returns defaults when called with no arguments", () => {
    const config = defineConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when called with empty object", () => {
    const config = defineConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial top-level overrides", () => {
    const config = defineConfig({
      tools: ["file_read", "file_write"],
    });
    expect(config.tools).toEqual(["file_read", "file_write"]);
    expect(config.limits).toEqual(DEFAULT_CONFIG.limits);
    expect(config.model).toEqual(DEFAULT_CONFIG.model);
  });

  it("deep-merges nested config", () => {
    const config = defineConfig({
      limits: { maxCycles: 10 },
    });
    expect(config.limits.maxCycles).toBe(10);
    expect(config.limits.maxTokens).toBe(DEFAULT_CONFIG.limits.maxTokens);
    expect(config.limits.toolTimeout).toBe(DEFAULT_CONFIG.limits.toolTimeout);
  });

  it("deep-merges model config", () => {
    const config = defineConfig({
      model: { planner: "claude-opus-4-20250514" },
    });
    expect(config.model.planner).toBe("claude-opus-4-20250514");
    expect(config.model.executor).toEqual(DEFAULT_CONFIG.model.executor);
  });

  it("deep-merges executor tier overrides", () => {
    const config = defineConfig({
      model: { executor: { high: "claude-opus-4-7" } },
    });
    expect(config.model.executor.high).toBe("claude-opus-4-7");
    expect(config.model.executor.low).toBe(DEFAULT_CONFIG.model.executor.low);
  });

  it("overrides logging level", () => {
    const config = defineConfig({
      logging: { level: "debug" },
    });
    expect(config.logging.level).toBe("debug");
  });

  it("throws TepaConfigError for invalid maxCycles", () => {
    expect(() => defineConfig({ limits: { maxCycles: -1 } })).toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for invalid maxTokens", () => {
    expect(() => defineConfig({ limits: { maxTokens: 0 } })).toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for invalid logging level", () => {
    expect(() => defineConfig({ logging: { level: "verbose" as "info" } })).toThrow(
      TepaConfigError,
    );
  });

  it("throws TepaConfigError for empty model name", () => {
    expect(() => defineConfig({ model: { planner: "" } })).toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for empty executor.low", () => {
    expect(() => defineConfig({ model: { executor: { low: "" } } })).toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for empty executor.high", () => {
    expect(() => defineConfig({ model: { executor: { high: "" } } })).toThrow(TepaConfigError);
  });
});
