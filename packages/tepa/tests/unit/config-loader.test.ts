import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../../src/config/loader.js";
import { TepaConfigError } from "../../src/utils/errors.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadConfig", () => {
  it("loads and parses a JSON config file", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ limits: { maxCycles: 3 } }));
    const config = await loadConfig("/path/to/config.json");
    expect(config.limits.maxCycles).toBe(3);
    expect(config.limits.maxTokens).toBe(DEFAULT_CONFIG.limits.maxTokens);
  });

  it("loads and parses a YAML config file", async () => {
    mockReadFile.mockResolvedValue("limits:\n  maxCycles: 7\n");
    const config = await loadConfig("/path/to/config.yaml");
    expect(config.limits.maxCycles).toBe(7);
  });

  it("loads .yml extension", async () => {
    mockReadFile.mockResolvedValue("logging:\n  level: debug\n");
    const config = await loadConfig("/path/to/config.yml");
    expect(config.logging.level).toBe("debug");
  });

  it("throws TepaConfigError for unreadable file", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(loadConfig("/no/such/file.json")).rejects.toThrow(TepaConfigError);
  });

  it("throws TepaConfigError for unsupported extension", async () => {
    mockReadFile.mockResolvedValue("some content");
    await expect(loadConfig("/path/to/config.toml")).rejects.toThrow(TepaConfigError);
    await expect(loadConfig("/path/to/config.toml")).rejects.toThrow(
      "Unsupported config file format",
    );
  });

  it("throws TepaConfigError for invalid JSON", async () => {
    mockReadFile.mockResolvedValue("not valid json {{{");
    await expect(loadConfig("/path/to/config.json")).rejects.toThrow(TepaConfigError);
  });

  it("throws TepaConfigError when file contains an array", async () => {
    mockReadFile.mockResolvedValue("[]");
    await expect(loadConfig("/path/to/config.json")).rejects.toThrow(TepaConfigError);
  });
});
