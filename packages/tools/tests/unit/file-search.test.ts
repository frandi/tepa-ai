import { describe, it, expect, vi } from "vitest";
import path from "node:path";
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
    const callArgs = vi.mocked(glob).mock.calls.at(-1)!;
    const cwd = (callArgs[1] as { cwd: string }).cwd;
    expect(path.isAbsolute(cwd)).toBe(true);
  });

  it("should use custom cwd", async () => {
    vi.mocked(glob).mockResolvedValue(["file.txt"]);

    await fileSearchTool.execute({ pattern: "*.txt", cwd: "/tmp" });

    const callArgs = vi.mocked(glob).mock.calls.at(-1)!;
    expect(callArgs[0]).toBe("*.txt");
    expect((callArgs[1] as { cwd: string; nodir: boolean }).cwd).toBe(path.resolve("/tmp"));
    expect((callArgs[1] as { cwd: string; nodir: boolean }).nodir).toBe(true);
  });

  it("should return empty array for no matches", async () => {
    vi.mocked(glob).mockResolvedValue([]);

    const result = await fileSearchTool.execute({ pattern: "*.xyz" });

    expect(result).toEqual([]);
  });
});
