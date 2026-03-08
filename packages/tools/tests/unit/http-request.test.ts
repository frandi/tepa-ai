import { describe, it, expect, vi, beforeEach } from "vitest";
import { httpRequestTool } from "../../src/http-request.js";

describe("http_request tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should make a GET request", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      text: vi.fn().mockResolvedValue("response body"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const result = (await httpRequestTool.execute({ url: "https://example.com" })) as {
      status: number;
      body: string;
    };

    expect(result.status).toBe(200);
    expect(result.body).toBe("response body");
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("should support POST with headers and body", async () => {
    const mockResponse = {
      status: 201,
      statusText: "Created",
      headers: new Headers(),
      text: vi.fn().mockResolvedValue("created"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await httpRequestTool.execute({
      url: "https://api.example.com",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"key":"value"}',
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"key":"value"}',
      }),
    );
  });

  it("should throw non-network errors immediately without retry", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Invalid URL"));

    await expect(
      httpRequestTool.execute({ url: "https://example.com" }),
    ).rejects.toThrow("Invalid URL");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should retry on network errors up to 3 times", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: vi.fn().mockResolvedValue("ok"),
    };
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(mockResponse as unknown as Response);

    const result = (await httpRequestTool.execute({ url: "https://example.com" })) as {
      status: number;
    };

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("should throw after exhausting retries on network errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    await expect(
      httpRequestTool.execute({ url: "https://example.com" }),
    ).rejects.toThrow("fetch failed");

    // 1 initial + 3 retries = 4 calls
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("should append query params to URL", async () => {
    const mockResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: vi.fn().mockResolvedValue("ok"),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    await httpRequestTool.execute({
      url: "https://api.example.com/data",
      queryParams: { page: "1", limit: "10" },
    });

    const calledUrl = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("limit=10");
  });
});
