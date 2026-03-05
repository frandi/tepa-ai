import fs from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./define-tool.js";

interface DirEntry {
  name: string;
  type: "file" | "directory";
  children?: DirEntry[];
}

async function listDir(dirPath: string, depth: number, maxDepth: number): Promise<DirEntry[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result: DirEntry[] = [];

  for (const entry of entries) {
    const item: DirEntry = {
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    };

    if (entry.isDirectory() && depth < maxDepth) {
      item.children = await listDir(path.join(dirPath, entry.name), depth + 1, maxDepth);
    }

    result.push(item);
  }

  return result;
}

export const directoryListTool = defineTool({
  name: "directory_list",
  description: "List directory contents with optional recursive depth",
  parameters: {
    path: { type: "string", description: "Directory path to list", required: true },
    maxDepth: {
      type: "number",
      description: "Maximum recursion depth (default: 1)",
      default: 1,
    },
  },
  execute: async (params) => {
    const dirPath = params.path as string;
    const maxDepth = (params.maxDepth as number) ?? 1;
    return listDir(dirPath, 0, maxDepth);
  },
});
