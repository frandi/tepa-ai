import { describe, it, expect } from "vitest";
import { validatePrompt } from "../../src/prompt/validator.js";
import { TepaPromptError } from "../../src/utils/errors.js";

describe("validatePrompt", () => {
  const validPrompt = {
    goal: "Generate an API client",
    context: { projectDir: "./my-project", language: "typescript" },
    expectedOutput: "A typed API client module",
  };

  it("accepts a valid prompt with string expectedOutput", () => {
    const result = validatePrompt(validPrompt);
    expect(result.goal).toBe("Generate an API client");
    expect(result.context).toEqual({ projectDir: "./my-project", language: "typescript" });
    expect(result.expectedOutput).toBe("A typed API client module");
  });

  it("accepts a valid prompt with array expectedOutput", () => {
    const prompt = {
      goal: "Analyze student data",
      context: { dataDir: "./class-5b" },
      expectedOutput: [
        { description: "Summary report", path: "./report.md" },
        { description: "Flagged students CSV", criteria: ["contains student IDs"] },
      ],
    };
    const result = validatePrompt(prompt);
    expect(result.expectedOutput).toHaveLength(2);
  });

  it("throws TepaPromptError when goal is missing", () => {
    expect(() =>
      validatePrompt({ context: {}, expectedOutput: "something" }),
    ).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when goal is empty", () => {
    expect(() =>
      validatePrompt({ goal: "", context: {}, expectedOutput: "something" }),
    ).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when context is missing", () => {
    expect(() =>
      validatePrompt({ goal: "do something", expectedOutput: "something" }),
    ).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when expectedOutput is missing", () => {
    expect(() => validatePrompt({ goal: "do something", context: {} })).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when expectedOutput is empty string", () => {
    expect(() =>
      validatePrompt({ goal: "do something", context: {}, expectedOutput: "" }),
    ).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when expectedOutput is empty array", () => {
    expect(() =>
      validatePrompt({ goal: "do something", context: {}, expectedOutput: [] }),
    ).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when input is not an object", () => {
    expect(() => validatePrompt("string")).toThrow(TepaPromptError);
    expect(() => validatePrompt(null)).toThrow(TepaPromptError);
    expect(() => validatePrompt([])).toThrow(TepaPromptError);
    expect(() => validatePrompt(42)).toThrow(TepaPromptError);
  });

  it("throws TepaPromptError when expectedOutput item has empty description", () => {
    expect(() =>
      validatePrompt({
        goal: "do something",
        context: {},
        expectedOutput: [{ description: "" }],
      }),
    ).toThrow(TepaPromptError);
  });
});
