import { describe, it, expect } from "vitest";
import { validateParams } from "../../src/validate-params.js";
import type { ParameterDef } from "@tepa/types";

describe("validateParams", () => {
  it("should pass valid params", () => {
    const schema: Record<string, ParameterDef> = {
      name: { type: "string", description: "Name", required: true },
    };
    const result = validateParams({ name: "hello" }, schema);
    expect(result.name).toBe("hello");
  });

  it("should reject missing required param", () => {
    const schema: Record<string, ParameterDef> = {
      name: { type: "string", description: "Name", required: true },
    };
    expect(() => validateParams({}, schema)).toThrow("Parameter validation failed");
  });

  it("should reject wrong type", () => {
    const schema: Record<string, ParameterDef> = {
      count: { type: "number", description: "Count", required: true },
    };
    expect(() => validateParams({ count: "not a number" }, schema)).toThrow(
      "Parameter validation failed",
    );
  });

  it("should apply default values", () => {
    const schema: Record<string, ParameterDef> = {
      encoding: { type: "string", description: "Encoding", default: "utf-8" },
    };
    const result = validateParams({}, schema);
    expect(result.encoding).toBe("utf-8");
  });

  it("should allow optional params to be missing", () => {
    const schema: Record<string, ParameterDef> = {
      optional: { type: "string", description: "Optional field" },
    };
    const result = validateParams({}, schema);
    expect(result.optional).toBeUndefined();
  });

  it("should validate boolean type", () => {
    const schema: Record<string, ParameterDef> = {
      flag: { type: "boolean", description: "Flag", required: true },
    };
    expect(() => validateParams({ flag: "true" }, schema)).toThrow(
      "Parameter validation failed",
    );
    const result = validateParams({ flag: true }, schema);
    expect(result.flag).toBe(true);
  });

  it("should validate object type", () => {
    const schema: Record<string, ParameterDef> = {
      data: { type: "object", description: "Data", required: true },
    };
    const result = validateParams({ data: { key: "value" } }, schema);
    expect(result.data).toEqual({ key: "value" });
  });

  it("should validate array type", () => {
    const schema: Record<string, ParameterDef> = {
      items: { type: "array", description: "Items", required: true },
    };
    const result = validateParams({ items: [1, 2, 3] }, schema);
    expect(result.items).toEqual([1, 2, 3]);
  });
});
