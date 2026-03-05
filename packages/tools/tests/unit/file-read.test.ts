import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import { fileReadTool } from "../../src/file-read.js";

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

describe("file_read tool", () => {
  it("should read file with default encoding", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("file content");

    const result = await fileReadTool.execute({ path: "/tmp/test.txt" });

    expect(result).toBe("file content");
    expect(fs.readFile).toHaveBeenCalledWith("/tmp/test.txt", { encoding: "utf-8" });
  });

  it("should read file with custom encoding", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("ascii content");

    const result = await fileReadTool.execute({
      path: "/tmp/test.txt",
      encoding: "ascii",
    });

    expect(result).toBe("ascii content");
    expect(fs.readFile).toHaveBeenCalledWith("/tmp/test.txt", { encoding: "ascii" });
  });

  it("should propagate fs errors", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

    await expect(fileReadTool.execute({ path: "/nonexistent" })).rejects.toThrow("ENOENT");
  });
});
