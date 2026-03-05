import { describe, it, expect, vi } from "vitest";
import { shellExecuteTool } from "../../src/shell-execute.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import { exec } from "node:child_process";

describe("shell_execute tool", () => {
  it("should capture stdout and stderr on success", async () => {
    vi.mocked(exec).mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, "output", "");
      return {} as ReturnType<typeof exec>;
    });

    const result = (await shellExecuteTool.execute({ command: "echo hello" })) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };

    expect(result.stdout).toBe("output");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should capture exit code on failure", async () => {
    vi.mocked(exec).mockImplementation((_cmd, _opts, callback) => {
      const error = Object.assign(new Error("failed"), { code: 1 });
      (callback as Function)(error, "", "error output");
      return {} as ReturnType<typeof exec>;
    });

    const result = (await shellExecuteTool.execute({ command: "false" })) as {
      stdout: string;
      stderr: string;
      exitCode: number;
    };

    expect(result.stderr).toBe("error output");
    expect(result.exitCode).toBe(1);
  });

  it("should pass timeout option", async () => {
    vi.mocked(exec).mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, "", "");
      return {} as ReturnType<typeof exec>;
    });

    await shellExecuteTool.execute({ command: "sleep 1", timeout: 5000 });

    expect(exec).toHaveBeenCalledWith(
      "sleep 1",
      { timeout: 5000, cwd: undefined },
      expect.any(Function),
    );
  });

  it("should pass cwd option", async () => {
    vi.mocked(exec).mockImplementation((_cmd, _opts, callback) => {
      (callback as Function)(null, "", "");
      return {} as ReturnType<typeof exec>;
    });

    await shellExecuteTool.execute({ command: "ls", cwd: "/tmp" });

    expect(exec).toHaveBeenCalledWith(
      "ls",
      { timeout: 30000, cwd: "/tmp" },
      expect.any(Function),
    );
  });
});
