import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  LLMRequestOptions,
  ToolRegistry,
  ToolSchema,
  ToolDefinition,
  TepaPrompt,
  Plan,
} from "@tepa/types";
import type { ModelInfo } from "@tepa/types";
import { Planner, _extractJson, _validatePlanStructure } from "../../src/core/planner.js";
import { Scratchpad } from "../../src/core/scratchpad.js";
import { TepaCycleError } from "../../src/utils/errors.js";

const defaultModelCatalog: ModelInfo[] = [
  { id: "claude-haiku-4-5", tier: "fast", description: "Fast model for simple tasks." },
  {
    id: "claude-sonnet-4-20250514",
    tier: "balanced",
    description: "Balanced model for planning and analysis.",
  },
];

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
    getModels: vi.fn(() => defaultModelCatalog),
  };
}

function makeResponse(text: string, inputTokens = 50, outputTokens = 100): LLMResponse {
  return {
    text,
    tokensUsed: { input: inputTokens, output: outputTokens },
    finishReason: "end_turn",
  };
}

function createMockRegistry(tools: ToolSchema[]): ToolRegistry {
  const toolMap = new Map<string, ToolDefinition>();
  for (const t of tools) {
    toolMap.set(t.name, {
      ...t,
      execute: vi.fn(async () => ({})),
    });
  }

  return {
    register: vi.fn(),
    get: vi.fn((name: string) => toolMap.get(name)),
    list: vi.fn(() => [...toolMap.values()]),
    toSchema: vi.fn(() => tools),
  };
}

const sampleTools: ToolSchema[] = [
  {
    name: "file_read",
    description: "Read file contents",
    parameters: {
      path: { type: "string", description: "File path", required: true },
    },
  },
  {
    name: "file_write",
    description: "Write content to a file",
    parameters: {
      path: { type: "string", description: "File path", required: true },
      content: { type: "string", description: "File content", required: true },
    },
  },
  {
    name: "shell_execute",
    description: "Run a shell command",
    parameters: {
      command: { type: "string", description: "Command to run", required: true },
    },
  },
];

const samplePrompt: TepaPrompt = {
  goal: "Create a hello world TypeScript file",
  context: { projectDir: "/tmp/project" },
  expectedOutput: "A file at /tmp/project/hello.ts that prints 'Hello World'",
};

function makeValidPlanJson(overrides?: Partial<Plan>): string {
  const plan: Plan = {
    reasoning: "We need to create a TypeScript file that prints Hello World",
    estimatedTokens: 500,
    steps: [
      {
        id: "step_1",
        description: "Write the hello.ts file",
        tools: ["file_write"],
        expectedOutcome: "File created at /tmp/project/hello.ts",
        dependencies: [],
      },
      {
        id: "step_2",
        description: "Verify the file was written",
        tools: ["file_read"],
        expectedOutcome: "File contents match expected output",
        dependencies: ["step_1"],
      },
    ],
    ...overrides,
  };
  return JSON.stringify(plan);
}

// --- Tests ---

describe("extractJson", () => {
  it("extracts raw JSON", () => {
    const json = '{"reasoning": "test", "estimatedTokens": 100, "steps": []}';
    expect(_extractJson(json)).toBe(json);
  });

  it("extracts JSON from markdown code fences", () => {
    const text = '```json\n{"reasoning": "test"}\n```';
    expect(_extractJson(text)).toBe('{"reasoning": "test"}');
  });

  it("extracts JSON from fences without language tag", () => {
    const text = '```\n{"reasoning": "test"}\n```';
    expect(_extractJson(text)).toBe('{"reasoning": "test"}');
  });

  it("extracts JSON object from surrounding text", () => {
    const text = 'Here is the plan:\n{"reasoning": "test"}\nDone.';
    expect(_extractJson(text)).toBe('{"reasoning": "test"}');
  });

  it("handles whitespace around JSON", () => {
    const text = '  \n  {"reasoning": "test"}  \n  ';
    expect(_extractJson(text)).toBe('{"reasoning": "test"}');
  });
});

describe("validatePlanStructure", () => {
  it("validates a correct plan", () => {
    const data = JSON.parse(makeValidPlanJson());
    const plan = _validatePlanStructure(data);
    expect(plan.steps).toHaveLength(2);
    expect(plan.reasoning).toBe("We need to create a TypeScript file that prints Hello World");
    expect(plan.estimatedTokens).toBe(500);
  });

  it("rejects non-object input", () => {
    expect(() => _validatePlanStructure("string")).toThrow("Plan must be a JSON object");
    expect(() => _validatePlanStructure(null)).toThrow("Plan must be a JSON object");
  });

  it("rejects missing reasoning", () => {
    expect(() =>
      _validatePlanStructure({
        estimatedTokens: 100,
        steps: [{ id: "1", description: "d", tools: [], expectedOutcome: "e", dependencies: [] }],
      }),
    ).toThrow('"reasoning" string');
  });

  it("rejects negative estimatedTokens", () => {
    expect(() =>
      _validatePlanStructure({
        reasoning: "ok",
        estimatedTokens: -1,
        steps: [{ id: "1", description: "d", tools: [], expectedOutcome: "e", dependencies: [] }],
      }),
    ).toThrow('"estimatedTokens"');
  });

  it("rejects empty steps array", () => {
    expect(() =>
      _validatePlanStructure({ reasoning: "ok", estimatedTokens: 100, steps: [] }),
    ).toThrow("non-empty");
  });

  it("rejects duplicate step IDs", () => {
    const data = {
      reasoning: "ok",
      estimatedTokens: 100,
      steps: [
        { id: "step_1", description: "a", tools: [], expectedOutcome: "a", dependencies: [] },
        { id: "step_1", description: "b", tools: [], expectedOutcome: "b", dependencies: [] },
      ],
    };
    expect(() => _validatePlanStructure(data)).toThrow("Duplicate step ID");
  });

  it("rejects step with missing description", () => {
    const data = {
      reasoning: "ok",
      estimatedTokens: 100,
      steps: [{ id: "step_1", description: "", tools: [], expectedOutcome: "a", dependencies: [] }],
    };
    expect(() => _validatePlanStructure(data)).toThrow('non-empty "description"');
  });

  it("rejects step referencing unknown dependency", () => {
    const data = {
      reasoning: "ok",
      estimatedTokens: 100,
      steps: [
        {
          id: "step_1",
          description: "a",
          tools: [],
          expectedOutcome: "a",
          dependencies: ["step_99"],
        },
      ],
    };
    expect(() => _validatePlanStructure(data)).toThrow('unknown dependency "step_99"');
  });

  it("accepts step model that is in the allowed set", () => {
    const allowed = new Set(["model-a", "model-b"]);
    const data = {
      reasoning: "ok",
      estimatedTokens: 100,
      steps: [
        {
          id: "step_1",
          description: "d",
          tools: [],
          expectedOutcome: "e",
          dependencies: [],
          model: "model-a",
        },
      ],
    };
    expect(() => _validatePlanStructure(data, allowed)).not.toThrow();
  });

  it("rejects step model not in the allowed set", () => {
    const allowed = new Set(["model-a", "model-b"]);
    const data = {
      reasoning: "ok",
      estimatedTokens: 100,
      steps: [
        {
          id: "step_1",
          description: "d",
          tools: [],
          expectedOutcome: "e",
          dependencies: [],
          model: "model-z",
        },
      ],
    };
    expect(() => _validatePlanStructure(data, allowed)).toThrow("not in the allowed model catalog");
  });

  it("skips model validation when allowedModelIds is not provided", () => {
    const data = {
      reasoning: "ok",
      estimatedTokens: 100,
      steps: [
        {
          id: "step_1",
          description: "d",
          tools: [],
          expectedOutcome: "e",
          dependencies: [],
          model: "any-model",
        },
      ],
    };
    expect(() => _validatePlanStructure(data)).not.toThrow();
  });
});

describe("Planner", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createMockRegistry(sampleTools);
  });

  describe("plan — initial planning (no feedback)", () => {
    it("produces a valid plan from well-formed LLM response", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan, tokensUsed } = await planner.plan(samplePrompt);

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]!.id).toBe("step_1");
      expect(plan.steps[0]!.tools).toEqual(["file_write"]);
      expect(plan.steps[1]!.dependencies).toEqual(["step_1"]);
      expect(plan.reasoning).toContain("TypeScript");
      expect(plan.estimatedTokens).toBe(500);
      expect(tokensUsed).toBe(150); // 50 input + 100 output
    });

    it("sends tool schemas in the system prompt", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = callArgs[1] as LLMRequestOptions;
      expect(options.systemPrompt).toContain("file_read");
      expect(options.systemPrompt).toContain("file_write");
      expect(options.systemPrompt).toContain("shell_execute");
    });

    it("sends goal, context, and expectedOutput in the user message", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const messages = callArgs[0] as LLMMessage[];
      expect(messages[0]!.content).toContain("Create a hello world TypeScript file");
      expect(messages[0]!.content).toContain("projectDir");
      expect(messages[0]!.content).toContain("Hello World");
    });

    it("uses the specified model", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-haiku-3",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = callArgs[1] as LLMRequestOptions;
      expect(options.model).toBe("claude-haiku-3");
    });

    it("handles expectedOutput as array of ExpectedOutput", async () => {
      const promptWithArray: TepaPrompt = {
        goal: "Generate report",
        context: {},
        expectedOutput: [
          { path: "/tmp/report.md", description: "Markdown report" },
          { description: "Summary data", criteria: ["Has at least 3 sections"] },
        ],
      };
      const planJson = makeValidPlanJson();
      const provider = createMockProvider([makeResponse(planJson)]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(promptWithArray);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const messages = callArgs[0] as LLMMessage[];
      expect(messages[0]!.content).toContain("report.md");
      expect(messages[0]!.content).toContain("Summary data");
    });
  });

  describe("plan — revised planning (with feedback)", () => {
    it("produces a revised plan when feedback is provided", async () => {
      const revisedPlan = makeValidPlanJson({
        reasoning: "Added a test step based on feedback",
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
            description: "Run tests to verify",
            tools: ["shell_execute"],
            expectedOutcome: "Tests pass",
            dependencies: ["step_1"],
          },
        ],
      });
      const provider = createMockProvider([makeResponse(revisedPlan)]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan } = await planner.plan(
        samplePrompt,
        "The file was created but tests were not run to verify correctness.",
      );

      expect(plan.reasoning).toContain("feedback");
      expect(plan.steps[1]!.tools).toEqual(["shell_execute"]);
    });

    it("includes feedback in the user message", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt, "Missing test execution step");

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const messages = callArgs[0] as LLMMessage[];
      expect(messages[0]!.content).toContain("Missing test execution step");
      expect(messages[0]!.content).toContain("Evaluator Feedback");
    });

    it("includes scratchpad state in revised plan user message", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );
      const scratchpad = new Scratchpad();
      scratchpad.write("_execution_summary", [
        { stepId: "step_1", status: "success", output: "file written" },
        { stepId: "step_2", status: "failure", output: "null", error: "File not found" },
      ]);

      await planner.plan(samplePrompt, "Step 2 failed", scratchpad);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const messages = callArgs[0] as LLMMessage[];
      const content = messages[0]!.content;
      expect(content).toContain("_execution_summary");
      expect(content).toContain("step_1");
      expect(content).toContain("success");
      expect(content).toContain("step_2");
      expect(content).toContain("failure");
      expect(content).toContain("Evaluator Feedback");
    });

    it("works with undefined scratchpad (backward compat)", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan } = await planner.plan(samplePrompt, "Some feedback");

      expect(plan.steps).toHaveLength(2);
    });

    it("uses revised system prompt when feedback is provided", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt, "Some feedback");

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = callArgs[1] as LLMRequestOptions;
      expect(options.systemPrompt).toContain("revising a previously failed plan");
      expect(options.systemPrompt).toContain("MINIMAL revised plan");
    });
  });

  describe("plan — malformed LLM output and retry", () => {
    it("retries once on unparseable JSON, succeeds on second attempt", async () => {
      const provider = createMockProvider([
        makeResponse("This is not JSON at all"),
        makeResponse(makeValidPlanJson()),
      ]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan, tokensUsed } = await planner.plan(samplePrompt);

      expect(plan.steps).toHaveLength(2);
      expect(tokensUsed).toBe(300); // 150 first + 150 retry
      expect(provider.complete).toHaveBeenCalledTimes(2);
    });

    it("includes original response in retry conversation", async () => {
      const badResponse = "I cannot produce a plan right now.";
      const provider = createMockProvider([
        makeResponse(badResponse),
        makeResponse(makeValidPlanJson()),
      ]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt);

      const retryCallArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[1]!;
      const retryMessages = retryCallArgs[0] as LLMMessage[];
      // Should have: original user message, bad assistant response, retry user message
      expect(retryMessages).toHaveLength(3);
      expect(retryMessages[0]!.role).toBe("user");
      expect(retryMessages[1]!.role).toBe("assistant");
      expect(retryMessages[1]!.content).toBe(badResponse);
      expect(retryMessages[2]!.role).toBe("user");
      expect(retryMessages[2]!.content).toContain("could not be parsed");
    });

    it("throws TepaCycleError after both attempts fail", async () => {
      const provider = createMockProvider([
        makeResponse("not json"),
        makeResponse("still not json"),
      ]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await expect(planner.plan(samplePrompt)).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof TepaCycleError && (err as Error).message.includes("Failed to parse plan")
        );
      });
    });

    it("handles JSON wrapped in markdown code fences", async () => {
      const wrappedJson = "```json\n" + makeValidPlanJson() + "\n```";
      const provider = createMockProvider([makeResponse(wrappedJson)]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan } = await planner.plan(samplePrompt);

      expect(plan.steps).toHaveLength(2);
      expect(provider.complete).toHaveBeenCalledTimes(1); // No retry needed
    });

    it("handles JSON with surrounding text", async () => {
      const textWithJson = "Here is my plan:\n" + makeValidPlanJson() + "\nI hope this helps!";
      const provider = createMockProvider([makeResponse(textWithJson)]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan } = await planner.plan(samplePrompt);

      expect(plan.steps).toHaveLength(2);
    });
  });

  describe("plan — tool reference validation", () => {
    it("succeeds when all tools exist in registry", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan } = await planner.plan(samplePrompt);
      expect(plan.steps[0]!.tools).toEqual(["file_write"]);
    });

    it("throws TepaCycleError for unknown tool references", async () => {
      const planWithBadTool = makeValidPlanJson({
        steps: [
          {
            id: "step_1",
            description: "Use a nonexistent tool",
            tools: ["nonexistent_tool"],
            expectedOutcome: "Something",
            dependencies: [],
          },
        ],
      });
      // Provide two bad responses so both attempts fail with tool validation
      const provider = createMockProvider([
        makeResponse(planWithBadTool),
        makeResponse(planWithBadTool),
      ]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await expect(planner.plan(samplePrompt)).rejects.toThrow(TepaCycleError);
    });

    it("allows steps with empty tools array (LLM reasoning steps)", async () => {
      const planWithReasoningStep = makeValidPlanJson({
        steps: [
          {
            id: "step_1",
            description: "Analyze the requirements",
            tools: [],
            expectedOutcome: "Requirements understood",
            dependencies: [],
          },
          {
            id: "step_2",
            description: "Write the file",
            tools: ["file_write"],
            expectedOutcome: "File created",
            dependencies: ["step_1"],
          },
        ],
      });
      const provider = createMockProvider([makeResponse(planWithReasoningStep)]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      const { plan } = await planner.plan(samplePrompt);

      expect(plan.steps[0]!.tools).toEqual([]);
      expect(plan.steps).toHaveLength(2);
    });
  });

  describe("plan — model catalog in system prompt", () => {
    it("includes all catalog model descriptions in the system prompt", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = callArgs[1] as LLMRequestOptions;
      expect(options.systemPrompt).toContain("claude-haiku-4-5");
      expect(options.systemPrompt).toContain("claude-sonnet-4-20250514");
      expect(options.systemPrompt).toContain("[fast]");
      expect(options.systemPrompt).toContain("[balanced]");
      expect(options.systemPrompt).toContain("(DEFAULT)");
    });

    it("marks the default model with (DEFAULT)", async () => {
      const provider = createMockProvider([makeResponse(makeValidPlanJson())]);
      const planner = new Planner(
        provider,
        registry,
        "claude-sonnet-4-20250514",
        defaultModelCatalog,
        "claude-haiku-4-5",
      );

      await planner.plan(samplePrompt);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const options = callArgs[1] as LLMRequestOptions;
      // DEFAULT should be next to the default model, not the other one
      expect(options.systemPrompt).toMatch(/claude-haiku-4-5.*\(DEFAULT\)/);
      expect(options.systemPrompt).not.toMatch(/claude-sonnet-4-20250514.*\(DEFAULT\)/);
    });
  });
});
