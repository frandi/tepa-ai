import type { ToolDefinition, ToolRegistry, ToolSchema } from "@tepa/types";

export class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  toSchema(): ToolSchema[] {
    return this.list().map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }
}
