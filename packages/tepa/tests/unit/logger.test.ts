import { describe, it, expect, vi } from "vitest";
import { createConsoleLogger, LogEntryCollector } from "../../src/utils/logger.js";

describe("createConsoleLogger", () => {
  describe("level filtering", () => {
    it("debug level passes all messages", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(spy).toHaveBeenCalledTimes(2); // debug + info
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("info level suppresses debug", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = createConsoleLogger("info");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(spy).toHaveBeenCalledTimes(1); // info only
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("warn level suppresses debug and info", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = createConsoleLogger("warn");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(spy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("error level suppresses everything except error", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = createConsoleLogger("error");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(spy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe("console method routing", () => {
    it("routes debug and info to console.log", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.debug("test debug");
      logger.info("test info");

      expect(spy).toHaveBeenCalledWith("test debug");
      expect(spy).toHaveBeenCalledWith("test info");
      spy.mockRestore();
    });

    it("routes warn to console.warn", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.warn("test warn");

      expect(spy).toHaveBeenCalledWith("test warn");
      spy.mockRestore();
    });

    it("routes error to console.error", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.error("test error");

      expect(spy).toHaveBeenCalledWith("test error");
      spy.mockRestore();
    });
  });

  describe("meta parameter", () => {
    it("passes non-internal meta alongside message", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.info("msg", { key: "value" });

      expect(spy).toHaveBeenCalledWith("msg", { key: "value" });
      spy.mockRestore();
    });

    it("does not pass undefined meta", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.info("msg");

      expect(spy).toHaveBeenCalledWith("msg");
      spy.mockRestore();
    });

    it("strips decorative flag from meta passed to console", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.info("separator", { decorative: true });

      // decorative is stripped — no meta object passed
      expect(spy).toHaveBeenCalledWith("separator");
      spy.mockRestore();
    });

    it("still logs the message when decorative is true", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.info("---", { decorative: true });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("---");
      spy.mockRestore();
    });

    it("preserves non-internal keys when decorative is also present", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = createConsoleLogger("debug");

      logger.info("msg", { decorative: true, extra: 42 });

      expect(spy).toHaveBeenCalledWith("msg", { extra: 42 });
      spy.mockRestore();
    });
  });
});

describe("LogEntryCollector", () => {
  it("stores entries with timestamps", () => {
    const collector = new LogEntryCollector();
    collector.add({ cycle: 1, message: "Test" });

    const entries = collector.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe("Test");
    expect(entries[0]!.cycle).toBe(1);
    expect(entries[0]!.timestamp).toBeTypeOf("number");
  });

  it("returns a defensive copy", () => {
    const collector = new LogEntryCollector();
    collector.add({ cycle: 1, message: "A" });

    const entries = collector.getEntries();
    entries.push({ timestamp: 0, cycle: 0, message: "injected" });
    expect(collector.getEntries()).toHaveLength(1);
  });

  it("stores optional fields", () => {
    const collector = new LogEntryCollector();
    collector.add({
      cycle: 1,
      step: "s1",
      tool: "file_read",
      message: "Read file",
      durationMs: 42,
      tokensUsed: 100,
    });

    const entry = collector.getEntries()[0]!;
    expect(entry.step).toBe("s1");
    expect(entry.tool).toBe("file_read");
    expect(entry.durationMs).toBe(42);
    expect(entry.tokensUsed).toBe(100);
  });
});
