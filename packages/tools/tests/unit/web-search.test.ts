import { describe, it, expect, vi, beforeEach } from "vitest";
import { webSearchTool } from "../../src/web-search.js";

describe("web_search tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should search with query and endpoint", async () => {
    const mockResults = { results: [{ title: "Result 1" }] };
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue(mockResults),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const result = await webSearchTool.execute({
      query: "test query",
      endpoint: "https://search.api/search",
    });

    expect(result).toEqual(mockResults);
    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("q=test+query");
    expect(calledUrl).toContain("count=5");
  });

  it("should use custom count", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [] }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await webSearchTool.execute({
      query: "test",
      endpoint: "https://search.api/search",
      count: 10,
    });

    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("count=10");
  });

  it("should throw on non-ok response", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await expect(
      webSearchTool.execute({
        query: "test",
        endpoint: "https://search.api/search",
      }),
    ).rejects.toThrow("Search API returned 500");
  });
});
