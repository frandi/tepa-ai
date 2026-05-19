import { describe, it, expect } from "vitest";
import type { ModelInfo, ModelConfig } from "@tepa/types";
import { validateModelConfig } from "../../src/config/model-catalog.js";
import { TepaConfigError } from "../../src/utils/errors.js";

const fullCatalog: ModelInfo[] = [
  { id: "model-fast", tier: "fast", description: "Fast model." },
  { id: "model-balanced", tier: "balanced", description: "Balanced model." },
  { id: "model-advanced", tier: "advanced", description: "Advanced model." },
];

const baseConfig: ModelConfig = {
  planner: "model-balanced",
  evaluator: "model-balanced",
  executor: {
    low: "model-fast",
    high: "model-balanced",
  },
};

describe("validateModelConfig", () => {
  it("returns void (no throw) when all four model IDs exist in the catalog", () => {
    expect(() => validateModelConfig(fullCatalog, baseConfig)).not.toThrow();
  });

  it("throws TepaConfigError when planner model is not in catalog", () => {
    const config: ModelConfig = { ...baseConfig, planner: "nonexistent-planner" };
    expect(() => validateModelConfig(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => validateModelConfig(fullCatalog, config)).toThrow(
      'model.planner "nonexistent-planner" is not in the provider\'s model catalog',
    );
  });

  it("throws TepaConfigError when evaluator model is not in catalog", () => {
    const config: ModelConfig = { ...baseConfig, evaluator: "nonexistent-evaluator" };
    expect(() => validateModelConfig(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => validateModelConfig(fullCatalog, config)).toThrow("model.evaluator");
  });

  it("throws TepaConfigError when executor.low is not in catalog", () => {
    const config: ModelConfig = {
      ...baseConfig,
      executor: { low: "nonexistent-low", high: baseConfig.executor.high },
    };
    expect(() => validateModelConfig(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => validateModelConfig(fullCatalog, config)).toThrow("model.executor.low");
  });

  it("throws TepaConfigError when executor.high is not in catalog", () => {
    const config: ModelConfig = {
      ...baseConfig,
      executor: { low: baseConfig.executor.low, high: "nonexistent-high" },
    };
    expect(() => validateModelConfig(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => validateModelConfig(fullCatalog, config)).toThrow("model.executor.high");
  });

  it("includes the available IDs in the error message", () => {
    const config: ModelConfig = { ...baseConfig, planner: "nope" };
    expect(() => validateModelConfig(fullCatalog, config)).toThrow(
      /Available: model-fast, model-balanced, model-advanced/,
    );
  });
});
