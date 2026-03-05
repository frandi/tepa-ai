import { describe, it, expect } from "vitest";
import { logObserveTool } from "../../src/log-observe.js";

describe("log_observe tool", () => {
  it("should return observation with default level", async () => {
    const result = (await logObserveTool.execute({ message: "Something happened" })) as {
      observation: string;
      level: string;
      timestamp: string;
    };

    expect(result.observation).toBe("Something happened");
    expect(result.level).toBe("info");
    expect(result.timestamp).toBeTruthy();
  });

  it("should use custom log level", async () => {
    const result = (await logObserveTool.execute({
      message: "Warning!",
      level: "warn",
    })) as { level: string };

    expect(result.level).toBe("warn");
  });

  it("should include ISO timestamp", async () => {
    const result = (await logObserveTool.execute({ message: "test" })) as {
      timestamp: string;
    };

    expect(() => new Date(result.timestamp)).not.toThrow();
  });
});
