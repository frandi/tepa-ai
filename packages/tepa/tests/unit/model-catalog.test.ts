import { describe, it, expect } from "vitest";
import type { ModelInfo, ModelConfig } from "@tepa/types";
import { resolveModelCatalog } from "../../src/config/model-catalog.js";
import { TepaConfigError } from "../../src/utils/errors.js";

const fullCatalog: ModelInfo[] = [
  { id: "model-fast", tier: "fast", description: "Fast model." },
  { id: "model-balanced", tier: "balanced", description: "Balanced model." },
  { id: "model-advanced", tier: "advanced", description: "Advanced model." },
];

const baseConfig: ModelConfig = {
  planner: "model-balanced",
  executor: "model-fast",
  evaluator: "model-balanced",
};

describe("resolveModelCatalog", () => {
  it("returns all models when allowedModels is undefined", () => {
    const result = resolveModelCatalog(fullCatalog, baseConfig);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["model-fast", "model-balanced", "model-advanced"]);
  });

  it("returns a copy, not the original array", () => {
    const result = resolveModelCatalog(fullCatalog, baseConfig);
    expect(result).not.toBe(fullCatalog);
    expect(result).toEqual(fullCatalog);
  });

  it("filters to allowedModels when set", () => {
    const config: ModelConfig = {
      ...baseConfig,
      allowedModels: ["model-fast", "model-balanced"],
    };
    const result = resolveModelCatalog(fullCatalog, config);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["model-fast", "model-balanced"]);
  });

  it("auto-includes executor even if not in allowedModels", () => {
    const config: ModelConfig = {
      ...baseConfig,
      allowedModels: ["model-balanced"],
    };
    const result = resolveModelCatalog(fullCatalog, config);
    expect(result.map((m) => m.id)).toContain("model-fast"); // executor
    expect(result.map((m) => m.id)).toContain("model-balanced");
    expect(result).toHaveLength(2);
  });

  it("throws TepaConfigError when allowedModels entry is not in catalog", () => {
    const config: ModelConfig = {
      ...baseConfig,
      allowedModels: ["model-fast", "nonexistent"],
    };
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow(
      'allowedModels entry "nonexistent" is not in the provider\'s model catalog',
    );
  });

  it("throws TepaConfigError when planner model is not in catalog", () => {
    const config: ModelConfig = {
      ...baseConfig,
      planner: "nonexistent-planner",
    };
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow(
      'model.planner "nonexistent-planner" is not in the provider\'s model catalog',
    );
  });

  it("throws TepaConfigError when executor model is not in catalog", () => {
    const config: ModelConfig = {
      ...baseConfig,
      executor: "nonexistent-executor",
    };
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow("model.executor");
  });

  it("throws TepaConfigError when evaluator model is not in catalog", () => {
    const config: ModelConfig = {
      ...baseConfig,
      evaluator: "nonexistent-evaluator",
    };
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow(TepaConfigError);
    expect(() => resolveModelCatalog(fullCatalog, config)).toThrow("model.evaluator");
  });

  it("preserves ModelInfo metadata in filtered results", () => {
    const catalog: ModelInfo[] = [
      {
        id: "model-a",
        tier: "fast",
        description: "A fast model.",
        capabilities: ["tool_use", "vision"],
      },
      { id: "model-b", tier: "advanced", description: "An advanced model." },
    ];
    const config: ModelConfig = {
      planner: "model-b",
      executor: "model-a",
      evaluator: "model-b",
      allowedModels: ["model-a"],
    };

    const result = resolveModelCatalog(catalog, config);
    expect(result[0]!.capabilities).toEqual(["tool_use", "vision"]);
    expect(result[0]!.description).toBe("A fast model.");
  });
});
