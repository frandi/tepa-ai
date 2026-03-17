import { describe, it, expect, vi } from "vitest";
import { Logger } from "../../src/utils/logger.js";

describe("Logger", () => {
  describe("log (legacy method)", () => {
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

  describe("banner", () => {
    it("prints start banner in standard mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.banner("start", {
        goal: "List files and write summary",
        maxCycles: 5,
        maxTokens: 64000,
        toolCount: 4,
      });

      expect(spy).toHaveBeenCalledTimes(3); // goal line, limits line, separator
      const allOutput = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("Pipeline started");
      expect(allOutput).toContain("List files and write summary");
      expect(allOutput).toContain("Tools: 4");
      expect(allOutput).toContain("5 cycles");
      spy.mockRestore();
    });

    it("prints end banner with status in standard mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.banner("end", {
        status: "pass",
        cycles: 1,
        tokensUsed: 5203,
        durationMs: 3800,
      });

      const allOutput = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("Pipeline completed");
      expect(allOutput).toContain("pass");
      expect(allOutput).toContain("1 cycle");
      expect(allOutput).toContain("5203 tokens");
      expect(allOutput).toContain("3.8s");
      spy.mockRestore();
    });

    it("end banner in verbose mode shows token budget percentage", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "verbose" });

      logger.banner("end", {
        status: "pass",
        cycles: 1,
        tokensUsed: 5203,
        maxTokens: 64000,
        durationMs: 3800,
      });

      const allOutput = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("5203/64000");
      expect(allOutput).toContain("%");
      spy.mockRestore();
    });

    it("does not print in minimal mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "minimal" });

      logger.banner("start", { goal: "test" });
      logger.banner("end", { status: "pass" });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("end banner in standard mode shows model names", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.banner("end", {
        status: "pass",
        cycles: 1,
        tokensUsed: 5203,
        durationMs: 3800,
        models: ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-sonnet-4-6"],
      });

      const allOutput = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("Models: claude-sonnet-4-6, claude-haiku-4-5");
      // Should deduplicate
      expect(allOutput).not.toContain("claude-sonnet-4-6, claude-haiku-4-5, claude-sonnet-4-6");
      spy.mockRestore();
    });

    it("end banner in verbose mode shows per-model token breakdown", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "verbose" });

      const tokensByModel = new Map([
        ["claude-sonnet-4-6", 3500],
        ["claude-haiku-4-5", 1703],
      ]);

      logger.banner("end", {
        status: "pass",
        cycles: 1,
        tokensUsed: 5203,
        maxTokens: 64000,
        durationMs: 3800,
        models: ["claude-sonnet-4-6", "claude-haiku-4-5"],
        tokensByModel,
      });

      const allOutput = spy.mock.calls.map((c) => c[0] as string).join("\n");
      expect(allOutput).toContain("claude-sonnet-4-6: 3500");
      expect(allOutput).toContain("claude-haiku-4-5: 1703");
      spy.mockRestore();
    });

    it("truncates long goals", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      const longGoal = "A".repeat(100);
      logger.banner("start", { goal: longGoal });

      const firstLine = spy.mock.calls[0]![0] as string;
      expect(firstLine).toContain("...");
      expect(firstLine.length).toBeLessThan(100);
      spy.mockRestore();
    });
  });

  describe("stage", () => {
    it("prints stage info in standard mode with duration", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.stage({
        cycle: 1,
        stage: "planning",
        message: "3 steps",
        durationMs: 1100,
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("[cycle 1]");
      expect(output).toContain("Planning");
      expect(output).toContain("3 steps");
      expect(output).toContain("1.1s");
      spy.mockRestore();
    });

    it("verbose mode includes token count", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "verbose" });

      logger.stage({
        cycle: 1,
        stage: "planning",
        message: "3 steps",
        tokensUsed: 1285,
        durationMs: 1100,
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("1285 tokens");
      expect(output).toContain("1.1s");
      spy.mockRestore();
    });

    it("standard mode omits token count", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.stage({
        cycle: 1,
        stage: "execution",
        message: "3/3 succeeded",
        tokensUsed: 2661,
        durationMs: 1600,
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).not.toContain("2661");
      spy.mockRestore();
    });

    it("stores entry in log entries", () => {
      const logger = new Logger({ level: "minimal" });
      logger.stage({ cycle: 1, stage: "planning", message: "3 steps" });
      expect(logger.getEntries()).toHaveLength(1);
      expect(logger.getEntries()[0]!.message).toContain("planning");
    });

    it("does not print in minimal mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "minimal" });

      logger.stage({ cycle: 1, stage: "planning", message: "3 steps" });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("step", () => {
    it("prints step result in standard mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.step({
        cycle: 1,
        stepId: "step_1",
        stepIndex: 1,
        totalSteps: 3,
        tool: "directory_list",
        status: "success",
        durationMs: 800,
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("[cycle 1]");
      expect(output).toContain("step 1/3");
      expect(output).toContain("directory_list");
      expect(output).toContain("\u2713"); // checkmark
      expect(output).toContain("800ms");
      spy.mockRestore();
    });

    it("standard mode omits token count and output preview", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.step({
        cycle: 1,
        stepId: "step_1",
        stepIndex: 1,
        totalSteps: 3,
        tool: "file_read",
        status: "success",
        durationMs: 600,
        tokensUsed: 1064,
        output: "file contents here",
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).not.toContain("1064");
      expect(output).not.toContain("file contents");
      spy.mockRestore();
    });

    it("verbose mode includes token count and output preview", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "verbose" });

      logger.step({
        cycle: 1,
        stepId: "step_1",
        stepIndex: 1,
        totalSteps: 3,
        tool: "file_read",
        status: "success",
        durationMs: 600,
        tokensUsed: 1064,
        output: "file contents here",
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("1064 tokens");
      expect(output).toContain("file contents here");
      spy.mockRestore();
    });

    it("shows failure icon for failed steps", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.step({
        cycle: 1,
        stepId: "step_2",
        stepIndex: 2,
        totalSteps: 3,
        tool: "file_write",
        status: "failure",
        durationMs: 100,
      });

      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("\u2717"); // cross mark
      spy.mockRestore();
    });

    it("stores entry in log entries", () => {
      const logger = new Logger({ level: "minimal" });
      logger.step({
        cycle: 1,
        stepId: "step_1",
        stepIndex: 1,
        totalSteps: 3,
        status: "success",
      });
      expect(logger.getEntries()).toHaveLength(1);
    });

    it("does not print in minimal mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "minimal" });

      logger.step({
        cycle: 1,
        stepId: "step_1",
        stepIndex: 1,
        totalSteps: 3,
        status: "success",
      });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("budget", () => {
    it("prints budget info in verbose mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "verbose" });

      logger.budget(5203, 64000);

      const output = spy.mock.calls[0]![0] as string;
      expect(output).toContain("5203/64000");
      expect(output).toContain("8.1%");
      spy.mockRestore();
    });

    it("does not print in standard mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "standard" });

      logger.budget(5203, 64000);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("does not print in minimal mode", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger({ level: "minimal" });

      logger.budget(5203, 64000);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
