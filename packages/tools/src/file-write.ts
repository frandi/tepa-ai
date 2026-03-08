import fs from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./define-tool.js";

export const fileWriteTool = defineTool({
  name: "file_write",
  description: "Write content to a file, creating parent directories if needed",
  parameters: {
    path: { type: "string", description: "Absolute or relative file path", required: true },
    content: { type: "string", description: "Content to write", required: true },
  },
  execute: async (params) => {
    const filePath = path.resolve(params.path as string);
    const content = params.content as string;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    return { path: filePath, bytesWritten: Buffer.byteLength(content, "utf-8") };
  },
});
