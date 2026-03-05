import { describe, it, expect, beforeEach } from "vitest";
import { scratchpadTool, clearScratchpad } from "../../src/scratchpad.js";

describe("scratchpad tool", () => {
  beforeEach(() => {
    clearScratchpad();
  });

  it("should write and read a value", async () => {
    await scratchpadTool.execute({ action: "write", key: "test", value: "hello" });
    const result = (await scratchpadTool.execute({ action: "read", key: "test" })) as {
      found: boolean;
      value: unknown;
    };

    expect(result.found).toBe(true);
    expect(result.value).toBe("hello");
  });

  it("should return found: false for missing key", async () => {
    const result = (await scratchpadTool.execute({ action: "read", key: "missing" })) as {
      found: boolean;
    };

    expect(result.found).toBe(false);
  });

  it("should overwrite existing key", async () => {
    await scratchpadTool.execute({ action: "write", key: "k", value: "v1" });
    await scratchpadTool.execute({ action: "write", key: "k", value: "v2" });

    const result = (await scratchpadTool.execute({ action: "read", key: "k" })) as {
      value: unknown;
    };
    expect(result.value).toBe("v2");
  });

  it("should throw on unknown action", async () => {
    await expect(
      scratchpadTool.execute({ action: "delete", key: "k" }),
    ).rejects.toThrow('Unknown action: delete');
  });
});
