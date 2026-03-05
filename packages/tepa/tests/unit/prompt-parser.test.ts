import { describe, it, expect, vi, beforeEach } from "vitest";
import { parsePromptFile } from "../../src/prompt/parser.js";
import { TepaPromptError } from "../../src/utils/errors.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parsePromptFile", () => {
  const yamlContent = `
goal: Generate API client
context:
  projectDir: ./my-project
expectedOutput: A typed API client
`;

  const jsonContent = JSON.stringify({
    goal: "Generate API client",
    context: { projectDir: "./my-project" },
    expectedOutput: "A typed API client",
  });

  it("parses a YAML prompt file", async () => {
    mockReadFile.mockResolvedValue(yamlContent);
    const prompt = await parsePromptFile("/path/to/task.yaml");
    expect(prompt.goal).toBe("Generate API client");
  });

  it("parses a JSON prompt file", async () => {
    mockReadFile.mockResolvedValue(jsonContent);
    const prompt = await parsePromptFile("/path/to/task.json");
    expect(prompt.goal).toBe("Generate API client");
  });

  it("throws TepaPromptError for unreadable file", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(parsePromptFile("/no/file.yaml")).rejects.toThrow(TepaPromptError);
  });

  it("throws TepaPromptError for unsupported format", async () => {
    mockReadFile.mockResolvedValue("content");
    await expect(parsePromptFile("/path/to/task.toml")).rejects.toThrow(TepaPromptError);
  });

  it("throws TepaPromptError for invalid YAML content", async () => {
    mockReadFile.mockResolvedValue("goal: test\n  bad indent");
    await expect(parsePromptFile("/path/to/task.yaml")).rejects.toThrow(TepaPromptError);
  });

  it("throws TepaPromptError for valid YAML missing required fields", async () => {
    mockReadFile.mockResolvedValue("goal: test\n");
    await expect(parsePromptFile("/path/to/task.yaml")).rejects.toThrow(TepaPromptError);
  });
});
