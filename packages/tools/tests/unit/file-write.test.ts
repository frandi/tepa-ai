import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { fileWriteTool } from "../../src/file-write.js";

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("file_write tool", () => {
  it("should write content and create parent directories", async () => {
    const inputPath = "/tmp/sub/dir/file.txt";
    const resolved = path.resolve(inputPath);
    const resolvedDir = path.dirname(resolved);

    const result = await fileWriteTool.execute({
      path: inputPath,
      content: "hello world",
    });

    expect(fs.mkdir).toHaveBeenCalledWith(resolvedDir, { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(resolved, "hello world", "utf-8");
    expect(result).toEqual({ path: resolved, bytesWritten: 11 });
  });

  it("should return correct byte count for multi-byte content", async () => {
    const content = "Hello ";
    const result = await fileWriteTool.execute({
      path: "/tmp/test.txt",
      content,
    });

    expect((result as { bytesWritten: number }).bytesWritten).toBe(
      Buffer.byteLength(content, "utf-8"),
    );
  });

  it("should resolve relative paths to absolute", async () => {
    const result = await fileWriteTool.execute({
      path: "relative/file.txt",
      content: "test",
    });

    const resolved = (result as { path: string }).path;
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toContain("relative");
    expect(resolved).toContain("file.txt");
  });
});
