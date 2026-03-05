import fs from "node:fs/promises";
import { defineTool } from "./define-tool.js";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

export const dataParseTool = defineTool({
  name: "data_parse",
  description: "Parse JSON, CSV, or YAML data from a string or file",
  parameters: {
    input: { type: "string", description: "Data string or file path to parse", required: true },
    format: {
      type: "string",
      description: "Data format: json, csv, or yaml",
      required: true,
    },
    fromFile: {
      type: "boolean",
      description: "If true, treat input as a file path (default: false)",
      default: false,
    },
    preview: {
      type: "number",
      description: "Limit output to first N rows (for CSV) or entries (for arrays)",
    },
  },
  execute: async (params) => {
    const fromFile = (params.fromFile as boolean) ?? false;
    const format = params.format as string;
    const preview = params.preview as number | undefined;

    let input: string;
    if (fromFile) {
      input = await fs.readFile(params.input as string, "utf-8");
    } else {
      input = params.input as string;
    }

    let data: unknown;

    switch (format) {
      case "json":
        data = JSON.parse(input);
        break;
      case "csv":
        data = parseCSV(input);
        break;
      case "yaml": {
        // Dynamic import to keep yaml optional
        const { parse } = await import("yaml");
        data = parse(input);
        break;
      }
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    if (preview !== undefined && Array.isArray(data)) {
      data = data.slice(0, preview);
    }

    return data;
  },
});
