import { describe, it, expect, vi } from "vitest";
import { fileSearchTool } from "../../src/file-search.js";

vi.mock("glob", () => ({
  glob: vi.fn(),
}));

import { glob } from "glob";

describe("file_search tool", () => {
  it("should search for files matching pattern", async () => {
    vi.mocked(glob).mockResolvedValue(["src/index.ts", "src/utils.ts"]);

    const result = await fileSearchTool.execute({ pattern: "**/*.ts" });

    expect(result).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(glob).toHaveBeenCalledWith("**/*.ts", { cwd: ".", nodir: true });
  });

  it("should use custom cwd", async () => {
    vi.mocked(glob).mockResolvedValue(["file.txt"]);

    await fileSearchTool.execute({ pattern: "*.txt", cwd: "/tmp" });

    expect(glob).toHaveBeenCalledWith("*.txt", { cwd: "/tmp", nodir: true });
  });

  it("should return empty array for no matches", async () => {
    vi.mocked(glob).mockResolvedValue([]);

    const result = await fileSearchTool.execute({ pattern: "*.xyz" });

    expect(result).toEqual([]);
  });
});
