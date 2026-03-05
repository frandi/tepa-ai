export interface ParameterDef {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  toSchema(): ToolSchema[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
}
