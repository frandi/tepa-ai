import { defineTool } from "./define-tool.js";

export const webSearchTool = defineTool({
  name: "web_search",
  description: "Search the web using a configurable search API endpoint",
  parameters: {
    query: { type: "string", description: "Search query", required: true },
    endpoint: {
      type: "string",
      description: "Search API endpoint URL",
      required: true,
    },
    count: { type: "number", description: "Number of results (default: 5)", default: 5 },
  },
  execute: async (params) => {
    const query = params.query as string;
    const endpoint = params.endpoint as string;
    const count = (params.count as number) ?? 5;

    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}: ${response.statusText}`);
    }

    return response.json();
  },
});
