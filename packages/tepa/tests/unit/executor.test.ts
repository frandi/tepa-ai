import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  LLMRequestOptions,
  ToolRegistry,
  ToolDefinition,
  ToolSchema,
  Plan,
  TepaPrompt,
} from "@tepa/types";
import type { CycleMetadata } from "@tepa/types";
import {
  Executor,
  type ExecutionContext,
  _topoSort,
  _filterOutputsByDependencies,
} from "../../src/core/executor.js";
import { Scratchpad } from "../../src/core/scratchpad.js";
import { EventBus } from "../../src/events/event-bus.js";
import { TepaCycleError } from "../../src/utils/errors.js";

// --- Helpers ---

function createMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    complete: vi.fn(async (_messages: LLMMessage[], _options: LLMRequestOptions) => {
      const response = responses[callIndex];
      if (!response) {
        throw new Error(`No mock response for call index ${callIndex}`);
      }
      callIndex++;
      return response;
    }),
  };
}

function makeResponse(text: string, inputTokens = 20, outputTokens = 30): LLMResponse {
  return {
    text,
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "end_turn",
  };
}

/**
 * Create a response with native tool_use blocks.
 */
function makeToolUseResponse(
  toolName: string,
  input: Record<string, unknown>,
  inputTokens = 20,
  outputTokens = 30,
): LLMResponse {
  return {
    text: "",
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "tool_use",
    toolUse: [
      {
        id: `call_${toolName}_1`,
        name: toolName,
        input,
      },
    ],
  };
}

function createMockTool(name: string, result: unknown): ToolDefinition {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: {
      path: { type: "string", description: "File path", required: true },
    },
    execute: vi.fn(async () => result),
  };
}

function createMockRegistry(tools: ToolDefinition[]): ToolRegistry {
  const toolMap = new Map<string, ToolDefinition>();
  for (const t of tools) {
    toolMap.set(t.name, t);
  }

  return {
    register: vi.fn(),
    get: vi.fn((name: string) => toolMap.get(name)),
    list: vi.fn(() => [...toolMap.values()]),
    toSchema: vi.fn(() =>
      tools.map(
        (t): ToolSchema => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }),
      ),
    ),
  };
}

const samplePrompt: TepaPrompt = {
  goal: "Create a hello world file",
  context: { projectDir: "/tmp/project" },
  expectedOutput: "A file at /tmp/project/hello.ts",
};

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    prompt: samplePrompt,
    cycle: 1,
    scratchpad: new Scratchpad(),
    ...overrides,
  };
}

// --- Tests ---

describe("Scratchpad", () => {
  it("reads and writes values", () => {
    const pad = new Scratchpad();
    pad.write("key1", "value1");
    expect(pad.read("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    const pad = new Scratchpad();
    expect(pad.read("missing")).toBeUndefined();
  });

  it("reports has correctly", () => {
    const pad = new Scratchpad();
    expect(pad.has("key")).toBe(false);
    pad.write("key", "val");
    expect(pad.has("key")).toBe(true);
  });

  it("returns all entries", () => {
    const pad = new Scratchpad();
    pad.write("a", 1);
    pad.write("b", 2);
    expect(pad.entries()).toEqual({ a: 1, b: 2 });
  });

  it("clears all data", () => {
    const pad = new Scratchpad();
    pad.write("key", "val");
    pad.clear();
    expect(pad.has("key")).toBe(false);
    expect(pad.entries()).toEqual({});
  });
});

describe("Executor", () => {
  let fileReadTool: ToolDefinition;
  let fileWriteTool: ToolDefinition;
  let registry: ToolRegistry;

  beforeEach(() => {
    fileReadTool = createMockTool("file_read", { content: "hello world" });
    fileWriteTool = createMockTool("file_write", { bytesWritten: 11 });
    registry = createMockRegistry([fileReadTool, fileWriteTool]);
  });

  describe("execute — multi-step plan with tools", () => {
    it("executes a multi-step plan and produces correct results", async () => {
      const plan: Plan = {
        reasoning: "Write then read",
        estimatedTokens: 500,
        steps: [
          {
            id: "step_1",
            description: "Write hello.ts",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Read hello.ts to verify",
            tools: ["file_read"],
            expectedOutcome: "File contents returned",
            dependencies: ["step_1"],
          },
        ],
      };

      // Two LLM calls: one for each step's native tool_use
      const provider = createMockProvider([
        makeToolUseResponse("file_write", { path: "/tmp/hello.ts", content: "hello" }),
        makeToolUseResponse("file_read", { path: "/tmp/hello.ts" }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { results, logs, tokensUsed } = await executor.execute(plan, makeContext());

      expect(results).toHaveLength(2);
      expect(results[0]!.stepId).toBe("step_1");
      expect(results[0]!.status).toBe("success");
      expect(results[0]!.output).toEqual({ bytesWritten: 11 });
      expect(results[1]!.stepId).toBe("step_2");
      expect(results[1]!.status).toBe("success");
      expect(results[1]!.output).toEqual({ content: "hello world" });
      expect(tokensUsed).toBe(100); // 2 * (20 + 30)
      expect(logs).toHaveLength(2);
    });

    it("invokes tools with LLM-constructed parameters", async () => {
      const plan: Plan = {
        reasoning: "Write a file",
        estimatedTokens: 200,
        steps: [
          {
            id: "step_1",
            description: "Write hello.ts",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([
        makeToolUseResponse("file_write", { path: "/tmp/hello.ts", content: 'console.log("hi")' }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext());

      expect(fileWriteTool.execute).toHaveBeenCalledWith({
        path: "/tmp/hello.ts",
        content: 'console.log("hi")',
      });
    });
  });

  describe("execute — error handling", () => {
    it("captures tool failure as step result, does not throw", async () => {
      const failingTool: ToolDefinition = {
        name: "failing_tool",
        description: "A tool that fails",
        parameters: {},
        execute: vi.fn(async () => {
          throw new Error("Disk full");
        }),
      };
      const failRegistry = createMockRegistry([failingTool]);

      const plan: Plan = {
        reasoning: "Use failing tool",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Try something",
            tools: ["failing_tool"],
            expectedOutcome: "Should fail gracefully",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([makeToolUseResponse("failing_tool", {})]);

      const executor = new Executor(failRegistry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("failure");
      expect(results[0]!.error).toBe("Disk full");
    });

    it("captures missing tool_use block as failure", async () => {
      const plan: Plan = {
        reasoning: "Test",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Do something",
            tools: ["file_read"],
            expectedOutcome: "Result",
            dependencies: [],
          },
        ],
      };

      // LLM returns a text response with no tool_use blocks
      const provider = createMockProvider([makeResponse("I cannot call the tool")]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results[0]!.status).toBe("failure");
      expect(results[0]!.error).toContain("no tool_use block");
    });

    it("returns failure when tool is not found in registry", async () => {
      const plan: Plan = {
        reasoning: "Test missing tool",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Use nonexistent tool",
            tools: ["nonexistent_tool"],
            expectedOutcome: "Should fail",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([]);
      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results[0]!.status).toBe("failure");
      expect(results[0]!.error).toContain("not found in registry");
    });
  });

  describe("execute — LLM reasoning steps", () => {
    it("handles steps with no tools by delegating to LLM", async () => {
      const plan: Plan = {
        reasoning: "Analyze then write",
        estimatedTokens: 300,
        steps: [
          {
            id: "step_1",
            description: "Analyze the project structure",
            tools: [],
            expectedOutcome: "Understanding of project layout",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Write the file based on analysis",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: ["step_1"],
          },
        ],
      };

      const provider = createMockProvider([
        makeResponse("The project has a src/ directory with utils/ subfolder."),
        makeToolUseResponse("file_write", { path: "/tmp/hello.ts", content: "hello" }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results).toHaveLength(2);
      expect(results[0]!.status).toBe("success");
      expect(results[0]!.output).toBe("The project has a src/ directory with utils/ subfolder.");
      expect(results[1]!.status).toBe("success");
    });

    it("passes context from reasoning step to subsequent tool steps", async () => {
      const plan: Plan = {
        reasoning: "Reason then act",
        estimatedTokens: 200,
        steps: [
          {
            id: "step_1",
            description: "Decide what to write",
            tools: [],
            expectedOutcome: "Decision made",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Write based on decision",
            tools: ["file_write"],
            expectedOutcome: "File written",
            dependencies: ["step_1"],
          },
        ],
      };

      const provider = createMockProvider([
        makeResponse("Write a greeting function"),
        makeToolUseResponse("file_write", {
          path: "/tmp/greet.ts",
          content: "export function greet() {}",
        }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext());

      // The second LLM call (tool_use) should include step_1's output
      const secondCall = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[1]!;
      const userMessage = (secondCall[0] as LLMMessage[])[0]!.content;
      expect(userMessage).toContain("Write a greeting function");
      expect(userMessage).toContain("step_1");
    });
  });

  describe("execute — scratchpad integration", () => {
    it("makes scratchpad available in LLM context", async () => {
      const plan: Plan = {
        reasoning: "Test scratchpad",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Read using scratchpad data",
            tools: ["file_read"],
            expectedOutcome: "File read",
            dependencies: [],
          },
        ],
      };

      const scratchpad = new Scratchpad();
      scratchpad.write("target_file", "/tmp/important.ts");

      const provider = createMockProvider([
        makeToolUseResponse("file_read", { path: "/tmp/important.ts" }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext({ scratchpad }));

      // The LLM should have received scratchpad context
      const firstCall = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const userMessage = (firstCall[0] as LLMMessage[])[0]!.content;
      expect(userMessage).toContain("target_file");
      expect(userMessage).toContain("/tmp/important.ts");
    });

    it("scratchpad state persists across steps", async () => {
      // A tool that writes to scratchpad via its output
      const scratchpadWriterTool: ToolDefinition = {
        name: "scratchpad_writer",
        description: "Writes to scratchpad",
        parameters: {},
        execute: vi.fn(async () => ({ savedKey: "result_data", savedValue: "important" })),
      };
      const scratchpadRegistry = createMockRegistry([scratchpadWriterTool, fileReadTool]);

      const plan: Plan = {
        reasoning: "Two steps sharing scratchpad",
        estimatedTokens: 200,
        steps: [
          {
            id: "step_1",
            description: "Write data",
            tools: ["scratchpad_writer"],
            expectedOutcome: "Data saved",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Read using saved data",
            tools: ["file_read"],
            expectedOutcome: "File read",
            dependencies: ["step_1"],
          },
        ],
      };

      const scratchpad = new Scratchpad();
      scratchpad.write("shared_key", "shared_value");

      const provider = createMockProvider([
        makeToolUseResponse("scratchpad_writer", {}),
        makeToolUseResponse("file_read", { path: "/tmp/file.ts" }),
      ]);

      const executor = new Executor(scratchpadRegistry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext({ scratchpad }));

      // Both steps succeed
      expect(results[0]!.status).toBe("success");
      expect(results[1]!.status).toBe("success");

      // Scratchpad still has original data
      expect(scratchpad.read("shared_key")).toBe("shared_value");
    });
  });

  describe("topoSort", () => {
    it("sorts steps so dependencies execute first regardless of array order", () => {
      const steps = [
        {
          id: "step_2",
          description: "B",
          tools: [],
          expectedOutcome: "",
          dependencies: ["step_1"],
        },
        { id: "step_1", description: "A", tools: [], expectedOutcome: "", dependencies: [] },
        {
          id: "step_3",
          description: "C",
          tools: [],
          expectedOutcome: "",
          dependencies: ["step_2"],
        },
      ];

      const sorted = _topoSort(steps);
      const ids = sorted.map((s) => s.id);
      expect(ids.indexOf("step_1")).toBeLessThan(ids.indexOf("step_2"));
      expect(ids.indexOf("step_2")).toBeLessThan(ids.indexOf("step_3"));
    });

    it("throws TepaCycleError for circular dependencies", () => {
      const steps = [
        {
          id: "step_1",
          description: "A",
          tools: [],
          expectedOutcome: "",
          dependencies: ["step_2"],
        },
        {
          id: "step_2",
          description: "B",
          tools: [],
          expectedOutcome: "",
          dependencies: ["step_1"],
        },
      ];

      expect(() => _topoSort(steps)).toThrow(TepaCycleError);
    });

    it("detects self-dependency as a cycle", () => {
      const steps = [
        {
          id: "step_1",
          description: "A",
          tools: [],
          expectedOutcome: "",
          dependencies: ["step_1"],
        },
      ];

      expect(() => _topoSort(steps)).toThrow(TepaCycleError);
    });
  });

  describe("filterOutputsByDependencies", () => {
    it("returns only outputs for declared dependencies", () => {
      const allOutputs = new Map<string, unknown>([
        ["step_1", "output1"],
        ["step_2", "output2"],
        ["step_3", "output3"],
      ]);
      const step = {
        id: "step_4",
        description: "",
        tools: [],
        expectedOutcome: "",
        dependencies: ["step_2"],
      };

      const scoped = _filterOutputsByDependencies(step, allOutputs);
      expect(scoped.size).toBe(1);
      expect(scoped.get("step_2")).toBe("output2");
      expect(scoped.has("step_1")).toBe(false);
    });

    it("returns empty map for steps with no dependencies", () => {
      const allOutputs = new Map<string, unknown>([["step_1", "output1"]]);
      const step = {
        id: "step_2",
        description: "",
        tools: [],
        expectedOutcome: "",
        dependencies: [],
      };

      const scoped = _filterOutputsByDependencies(step, allOutputs);
      expect(scoped.size).toBe(0);
    });
  });

  describe("execute — dependency-scoped context", () => {
    it("only passes declared dependency outputs to step LLM prompt", async () => {
      const plan: Plan = {
        reasoning: "Three steps, step_3 only depends on step_2",
        estimatedTokens: 300,
        steps: [
          {
            id: "step_1",
            description: "First",
            tools: [],
            expectedOutcome: "Result 1",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Second",
            tools: [],
            expectedOutcome: "Result 2",
            dependencies: ["step_1"],
          },
          {
            id: "step_3",
            description: "Third",
            tools: [],
            expectedOutcome: "Result 3",
            dependencies: ["step_2"],
          },
        ],
      };

      const provider = createMockProvider([
        makeResponse("output_from_step_1"),
        makeResponse("output_from_step_2"),
        makeResponse("output_from_step_3"),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext());

      // step_3's LLM call should contain step_2's output but NOT step_1's
      const thirdCall = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[2]!;
      const userMessage = (thirdCall[0] as LLMMessage[])[0]!.content;
      expect(userMessage).toContain("step_2");
      expect(userMessage).toContain("output_from_step_2");
      expect(userMessage).not.toContain("output_from_step_1");
    });

    it("passes no prior outputs for steps with empty dependencies", async () => {
      const plan: Plan = {
        reasoning: "Independent step",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "First",
            tools: [],
            expectedOutcome: "R1",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Second",
            tools: [],
            expectedOutcome: "R2",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([makeResponse("output1"), makeResponse("output2")]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext());

      const secondCall = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[1]!;
      const userMessage = (secondCall[0] as LLMMessage[])[0]!.content;
      expect(userMessage).not.toContain("Previous step outputs");
    });
  });

  describe("execute — failed dependency skip", () => {
    it("skips step when a dependency failed, zero tokens used", async () => {
      const failingTool: ToolDefinition = {
        name: "fail_tool",
        description: "Fails",
        parameters: {},
        execute: vi.fn(async () => {
          throw new Error("Boom");
        }),
      };
      const failRegistry = createMockRegistry([failingTool, fileWriteTool]);

      const plan: Plan = {
        reasoning: "step_2 depends on failing step_1",
        estimatedTokens: 200,
        steps: [
          {
            id: "step_1",
            description: "Will fail",
            tools: ["fail_tool"],
            expectedOutcome: "N/A",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Depends on step_1",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: ["step_1"],
          },
        ],
      };

      const provider = createMockProvider([makeToolUseResponse("fail_tool", {})]);
      const executor = new Executor(failRegistry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results).toHaveLength(2);
      expect(results[1]!.status).toBe("failure");
      expect(results[1]!.error).toContain('Skipped: dependency "step_1" failed');
      expect(results[1]!.tokensUsed).toBe(0);

      // Only 1 LLM call (for step_1's tool_use), step_2 was skipped
      expect(provider.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute — preStep/postStep events", () => {
    it("emits preStep and postStep events with correct payloads", async () => {
      const plan: Plan = {
        reasoning: "Single step",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Write file",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: [],
          },
        ],
      };

      const preStepHandler = vi.fn();
      const postStepHandler = vi.fn();
      const eventBus = new EventBus({
        preStep: [preStepHandler],
        postStep: [postStepHandler],
      });
      const cycleMeta: CycleMetadata = { cycleNumber: 1, totalCyclesUsed: 0, tokensUsed: 0 };

      const provider = createMockProvider([
        makeToolUseResponse("file_write", { path: "/tmp/f.ts", content: "x" }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext(), eventBus, cycleMeta);

      expect(preStepHandler).toHaveBeenCalledTimes(1);
      expect(preStepHandler.mock.calls[0]![0]).toMatchObject({
        step: expect.objectContaining({ id: "step_1" }),
        cycle: 1,
      });

      expect(postStepHandler).toHaveBeenCalledTimes(1);
      expect(postStepHandler.mock.calls[0]![0]).toMatchObject({
        step: expect.objectContaining({ id: "step_1" }),
        result: expect.objectContaining({ stepId: "step_1", status: "success" }),
        cycle: 1,
      });
    });

    it("works without eventBus (backward compatible)", async () => {
      const plan: Plan = {
        reasoning: "No events",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Write",
            tools: ["file_write"],
            expectedOutcome: "Done",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([
        makeToolUseResponse("file_write", { path: "/tmp/f.ts", content: "x" }),
      ]);
      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("success");
    });
  });

  describe("execute — execution log", () => {
    it("produces complete log entries for each step", async () => {
      const plan: Plan = {
        reasoning: "Simple plan",
        estimatedTokens: 200,
        steps: [
          {
            id: "step_1",
            description: "Write file",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Analyze results",
            tools: [],
            expectedOutcome: "Analysis complete",
            dependencies: ["step_1"],
          },
        ],
      };

      const provider = createMockProvider([
        makeToolUseResponse("file_write", { path: "/tmp/f.ts", content: "x" }),
        makeResponse("Analysis: everything looks good"),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { logs } = await executor.execute(plan, makeContext());

      expect(logs).toHaveLength(2);

      // First log: tool step
      expect(logs[0]!.step).toBe("step_1");
      expect(logs[0]!.tool).toBe("file_write");
      expect(logs[0]!.cycle).toBe(1);
      expect(logs[0]!.timestamp).toBeTypeOf("number");
      expect(logs[0]!.durationMs).toBeTypeOf("number");
      expect(logs[0]!.durationMs).toBeGreaterThanOrEqual(0);
      expect(logs[0]!.tokensUsed).toBe(50);
      expect(logs[0]!.message).toContain("step_1");
      expect(logs[0]!.message).toContain("completed");

      // Second log: reasoning step (no tool)
      expect(logs[1]!.step).toBe("step_2");
      expect(logs[1]!.tool).toBeUndefined();
      expect(logs[1]!.message).toContain("step_2");
    });

    it("logs failure messages for failed steps", async () => {
      const failingTool: ToolDefinition = {
        name: "fail_tool",
        description: "Fails",
        parameters: {},
        execute: vi.fn(async () => {
          throw new Error("Something broke");
        }),
      };
      const failRegistry = createMockRegistry([failingTool]);

      const plan: Plan = {
        reasoning: "Test",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Fail",
            tools: ["fail_tool"],
            expectedOutcome: "N/A",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([makeToolUseResponse("fail_tool", {})]);
      const executor = new Executor(failRegistry, provider, "claude-sonnet-4-20250514");
      const { logs } = await executor.execute(plan, makeContext());

      expect(logs[0]!.message).toContain("failed");
      expect(logs[0]!.message).toContain("Something broke");
    });
  });

  describe("execute — native tool_use", () => {
    it("passes tool schemas to provider via options.tools", async () => {
      const plan: Plan = {
        reasoning: "Test tool schema passing",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Write file",
            tools: ["file_write"],
            expectedOutcome: "Done",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([
        makeToolUseResponse("file_write", { path: "/tmp/f.ts", content: "x" }),
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      await executor.execute(plan, makeContext());

      // Verify that tools were passed to the provider
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = call[1] as LLMRequestOptions;
      expect(options.tools).toBeDefined();
      expect(options.tools).toHaveLength(1);
      expect(options.tools![0]!.name).toBe("file_write");
    });

    it("fails gracefully when LLM returns wrong tool name", async () => {
      const plan: Plan = {
        reasoning: "Test wrong tool name",
        estimatedTokens: 100,
        steps: [
          {
            id: "step_1",
            description: "Write file",
            tools: ["file_write"],
            expectedOutcome: "Done",
            dependencies: [],
          },
        ],
      };

      const provider = createMockProvider([
        {
          text: "",
          tokensUsed: { input: 20, output: 30 },
          finishReason: "tool_use" as const,
          toolUse: [{ id: "call_1", name: "wrong_tool", input: {} }],
        },
      ]);

      const executor = new Executor(registry, provider, "claude-sonnet-4-20250514");
      const { results } = await executor.execute(plan, makeContext());

      expect(results[0]!.status).toBe("failure");
      expect(results[0]!.error).toContain("no tool_use block");
    });
  });
});
