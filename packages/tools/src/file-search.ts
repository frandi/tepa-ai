import { glob } from "glob";
import { defineTool } from "./define-tool.js";

export const fileSearchTool = defineTool({
  name: "file_search",
  description: "Search for files matching a glob pattern",
  parameters: {
    pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)", required: true },
    cwd: { type: "string", description: "Working directory for the search", default: "." },
  },
  execute: async (params) => {
    const pattern = params.pattern as string;
    const cwd = (params.cwd as string) ?? ".";
    const matches = await glob(pattern, { cwd, nodir: true });
    return matches;
  },
});
