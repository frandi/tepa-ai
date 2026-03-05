import { describe, it, expect, vi } from "vitest";
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
    const result = await fileWriteTool.execute({
      path: "/tmp/sub/dir/file.txt",
      content: "hello world",
    });

    expect(fs.mkdir).toHaveBeenCalledWith("/tmp/sub/dir", { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith("/tmp/sub/dir/file.txt", "hello world", "utf-8");
    expect(result).toEqual({ bytesWritten: 11 });
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
});
