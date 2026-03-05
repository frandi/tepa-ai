import { describe, it, expect } from "vitest";
import { defineTool } from "../../src/define-tool.js";

describe("defineTool", () => {
  it("should return a valid tool definition", () => {
    const tool = defineTool({
      name: "test_tool",
      description: "A test tool",
      parameters: {
        input: { type: "string", description: "Input text", required: true },
      },
      execute: async (params) => params.input,
    });

    expect(tool.name).toBe("test_tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.parameters.input).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });

  it("should reject empty name", () => {
    expect(() =>
      defineTool({
        name: "",
        description: "A tool",
        parameters: {},
        execute: async () => null,
      }),
    ).toThrow("Invalid tool definition");
  });

  it("should reject empty description", () => {
    expect(() =>
      defineTool({
        name: "tool",
        description: "",
        parameters: {},
        execute: async () => null,
      }),
    ).toThrow("Invalid tool definition");
  });

  it("should reject invalid parameter type", () => {
    expect(() =>
      defineTool({
        name: "tool",
        description: "A tool",
        parameters: {
          bad: { type: "invalid" as "string", description: "bad param" },
        },
        execute: async () => null,
      }),
    ).toThrow("Invalid tool definition");
  });

  it("should accept all valid parameter types", () => {
    const tool = defineTool({
      name: "tool",
      description: "A tool",
      parameters: {
        s: { type: "string", description: "string" },
        n: { type: "number", description: "number" },
        b: { type: "boolean", description: "boolean" },
        o: { type: "object", description: "object" },
        a: { type: "array", description: "array" },
      },
      execute: async () => null,
    });

    expect(Object.keys(tool.parameters)).toHaveLength(5);
  });

  it("should accept parameters with defaults", () => {
    const tool = defineTool({
      name: "tool",
      description: "A tool",
      parameters: {
        count: { type: "number", description: "count", default: 10 },
      },
      execute: async () => null,
    });

    expect(tool.parameters.count?.default).toBe(10);
  });
});
