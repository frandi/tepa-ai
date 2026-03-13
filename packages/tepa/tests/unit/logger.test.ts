import { describe, it, expect, vi } from "vitest";
import { Logger } from "../../src/utils/logger.js";

describe("Logger", () => {
  it("stores log entries with timestamps", () => {
    const logger = new Logger({ level: "minimal" });
    logger.log({ cycle: 1, message: "Test message" });

    const entries = logger.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("Test message");
    expect(entries[0]!.cycle).toBe(1);
    expect(entries[0]!.timestamp).toBeTypeOf("number");
  });

  it("does not console.log in minimal mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ level: "minimal" });
    logger.log({ cycle: 1, message: "Silent" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("console.logs in standard mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ level: "standard" });
    logger.log({ cycle: 1, message: "Visible" });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("console.logs with extra detail in verbose mode", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ level: "verbose" });
    logger.log({
      cycle: 1,
      step: "s1",
      tool: "file_read",
      message: "Reading file",
      durationMs: 42,
      tokensUsed: 100,
    });
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain("42ms");
    expect(output).toContain("100 tokens");
    spy.mockRestore();
  });

  it("returns a copy of entries", () => {
    const logger = new Logger({ level: "minimal" });
    logger.log({ cycle: 1, message: "A" });
    const entries = logger.getEntries();
    entries.push({ timestamp: 0, cycle: 0, message: "injected" });
    expect(logger.getEntries()).toHaveLength(1);
  });
});
