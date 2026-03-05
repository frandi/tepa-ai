import { describe, it, expect } from "vitest";
import { ToolRegistryImpl } from "../../src/registry.js";
import { defineTool } from "../../src/define-tool.js";

function makeTool(name: string) {
  return defineTool({
    name,
    description: `Tool ${name}`,
    parameters: {},
    execute: async () => null,
  });
}

describe("ToolRegistryImpl", () => {
  it("should register and retrieve a tool", () => {
    const registry = new ToolRegistryImpl();
    const tool = makeTool("my_tool");
    registry.register(tool);

    expect(registry.get("my_tool")).toBe(tool);
  });

  it("should return undefined for unregistered tool", () => {
    const registry = new ToolRegistryImpl();
    expect(registry.get("nope")).toBeUndefined();
  });

  it("should list all registered tools", () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));

    expect(registry.list()).toHaveLength(2);
  });

  it("should throw on duplicate registration", () => {
    const registry = new ToolRegistryImpl();
    registry.register(makeTool("dup"));

    expect(() => registry.register(makeTool("dup"))).toThrow(
      'Tool "dup" is already registered',
    );
  });

  it("should produce schema without execute function", () => {
    const registry = new ToolRegistryImpl();
    registry.register(
      defineTool({
        name: "schema_test",
        description: "desc",
        parameters: {
          x: { type: "string", description: "x param", required: true },
        },
        execute: async () => null,
      }),
    );

    const schemas = registry.toSchema();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]!.name).toBe("schema_test");
    expect(schemas[0]!.description).toBe("desc");
    expect(schemas[0]!.parameters.x).toBeDefined();
    expect("execute" in schemas[0]!).toBe(false);
  });
});
