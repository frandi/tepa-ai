import { defineTool } from "./define-tool.js";

export const logObserveTool = defineTool({
  name: "log_observe",
  description: "Record an observation for logging purposes",
  parameters: {
    message: {
      type: "string",
      description: "Observation message to record",
      required: true,
    },
    level: {
      type: "string",
      description: "Log level: info, warn, or error (default: info)",
      default: "info",
    },
  },
  execute: async (params) => {
    const message = params.message as string;
    const level = (params.level as string) ?? "info";
    return { observation: message, level, timestamp: new Date().toISOString() };
  },
});
