import { defineTool } from "./define-tool.js";

const store = new Map<string, unknown>();

export const scratchpadTool = defineTool({
  name: "scratchpad",
  description: "In-memory key-value store for intermediate data",
  parameters: {
    action: {
      type: "string",
      description: "Action: read or write",
      required: true,
    },
    key: { type: "string", description: "Storage key", required: true },
    value: { type: "string", description: "Value to store (required for write)" },
  },
  execute: async (params) => {
    const action = params.action as string;
    const key = params.key as string;

    switch (action) {
      case "write":
        store.set(key, params.value);
        return { success: true, key };
      case "read": {
        if (!store.has(key)) {
          return { found: false, key };
        }
        return { found: true, key, value: store.get(key) };
      }
      default:
        throw new Error(`Unknown action: ${action}. Use "read" or "write".`);
    }
  },
});

/** Clears all scratchpad data. Useful for testing. */
export function clearScratchpad(): void {
  store.clear();
}
