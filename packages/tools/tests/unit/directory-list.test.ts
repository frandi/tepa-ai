import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { directoryListTool } from "../../src/directory-list.js";
import type { Dirent } from "node:fs";

vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
  },
}));

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as Dirent;
}

describe("directory_list tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should list directory contents", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      makeDirent("file.txt", false),
      makeDirent("subdir", true),
    ] as unknown as Dirent[]);

    const result = await directoryListTool.execute({ path: "/tmp", maxDepth: 0 });

    expect(result).toEqual([
      { name: "file.txt", type: "file" },
      { name: "subdir", type: "directory" },
    ]);
  });

  it("should recurse into subdirectories up to maxDepth", async () => {
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([makeDirent("subdir", true)] as unknown as Dirent[])
      .mockResolvedValueOnce([makeDirent("nested.txt", false)] as unknown as Dirent[]);

    const result = (await directoryListTool.execute({ path: "/tmp", maxDepth: 2 })) as Array<{
      name: string;
      type: string;
      children?: Array<{ name: string; type: string }>;
    }>;

    expect(result).toHaveLength(1);
    expect(result[0]!.children).toEqual([{ name: "nested.txt", type: "file" }]);
  });

  it("should not recurse when depth equals maxDepth", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      makeDirent("subdir", true),
    ] as unknown as Dirent[]);

    const result = (await directoryListTool.execute({ path: "/tmp", maxDepth: 0 })) as Array<{
      name: string;
      type: string;
      children?: unknown[];
    }>;

    expect(result[0]!.children).toBeUndefined();
    expect(fs.readdir).toHaveBeenCalledTimes(1);
  });
});
