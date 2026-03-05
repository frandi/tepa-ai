import { defineTool } from "./define-tool.js";

const DEFAULT_TIMEOUT = 30_000;

export const httpRequestTool = defineTool({
  name: "http_request",
  description: "Make an HTTP request using fetch",
  parameters: {
    url: { type: "string", description: "URL to request", required: true },
    method: { type: "string", description: "HTTP method (default: GET)", default: "GET" },
    headers: { type: "object", description: "Request headers" },
    queryParams: { type: "object", description: "Query parameters to append to the URL" },
    body: { type: "string", description: "Request body" },
    timeout: {
      type: "number",
      description: "Timeout in milliseconds (default: 30000)",
      default: DEFAULT_TIMEOUT,
    },
  },
  execute: async (params) => {
    const method = (params.method as string) ?? "GET";
    const headers = params.headers as Record<string, string> | undefined;
    const queryParams = params.queryParams as Record<string, string> | undefined;
    const body = params.body as string | undefined;
    const timeout = (params.timeout as number) ?? DEFAULT_TIMEOUT;

    const urlObj = new URL(params.url as string);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        urlObj.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(urlObj.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: text,
      };
    } finally {
      clearTimeout(timer);
    }
  },
});
