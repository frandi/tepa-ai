import fs from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./define-tool.js";

export const fileReadTool = defineTool({
  name: "file_read",
  description: "Read the contents of a file at the given path",
  parameters: {
    path: { type: "string", description: "Absolute or relative file path", required: true },
    encoding: {
      type: "string",
      description: "File encoding (default: utf-8)",
      default: "utf-8",
    },
  },
  execute: async (params) => {
    const filePath = path.resolve(params.path as string);
    const encoding = (params.encoding as BufferEncoding) ?? "utf-8";
    const content = await fs.readFile(filePath, { encoding });
    return content;
  },
});
