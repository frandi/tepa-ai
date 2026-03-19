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
    expect(config.model.executor).toBe(DEFAULT_CONFIG.model.executor);
  });

  it("overrides logging level", () => {
    const config = defineConfig({
      logging: { level: "verbose" },
    });
    expect(config.logging.level).toBe("verbose");
  });

  it("throws TepaConfigError for invalid maxCycles", () => {
    expect(() => defineConfig({ limits: { maxCycles: -1 } })).toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for invalid maxTokens", () => {
    expect(() => defineConfig({ limits: { maxTokens: 0 } })).toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for invalid logging level", () => {
    expect(() => defineConfig({ logging: { level: "debug" as "standard" } })).toThrow(
      TepaConfigError,
    );
  });

  it("throws TepaConfigError for empty model name", () => {
    expect(() => defineConfig({ model: { planner: "" } })).toThrow(TepaConfigError);
  });

  it("accepts allowedModels as an array of strings", () => {
    const config = defineConfig({
      model: { allowedModels: ["claude-haiku-4-5", "claude-sonnet-4-6"] },
    });
    expect(config.model.allowedModels).toEqual(["claude-haiku-4-5", "claude-sonnet-4-6"]);
  });

  it("allows omitting allowedModels (undefined by default)", () => {
    const config = defineConfig();
    expect(config.model.allowedModels).toBeUndefined();
  });

  it("throws TepaConfigError for empty-string entries in allowedModels", () => {
    expect(() => defineConfig({ model: { allowedModels: ["valid", ""] } })).toThrow(
      TepaConfigError,
    );
  });
});
