import { describe, it, expect } from "vitest";
import { toOpenAIInput, toFinishReason, extractText } from "../../src/formatting.js";
import type { LLMMessage } from "@tepa/types";

describe("toOpenAIInput", () => {
  it("converts a single user message", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toOpenAIInput(messages);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("converts a multi-turn conversation", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ];
    const result = toOpenAIInput(messages);
    expect(result).toEqual([
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ]);
  });

  it("prepends system prompt when provided", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hi" }];
    const result = toOpenAIInput(messages, "You are helpful.");
    expect(result).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ]);
  });

  it("returns empty array for empty input without system prompt", () => {
    expect(toOpenAIInput([])).toEqual([]);
  });

  it("returns only system message for empty input with system prompt", () => {
    expect(toOpenAIInput([], "Be helpful")).toEqual([
      { role: "system", content: "Be helpful" },
    ]);
  });
});

describe("toFinishReason", () => {
  it("maps completed to end_turn", () => {
    expect(toFinishReason("completed")).toBe("end_turn");
  });

  it("maps incomplete to max_tokens", () => {
    expect(toFinishReason("incomplete")).toBe("max_tokens");
  });

  it("maps unknown values to end_turn", () => {
    expect(toFinishReason("failed")).toBe("end_turn");
  });

  it("maps null to end_turn", () => {
    expect(toFinishReason(null)).toBe("end_turn");
  });
});

describe("extractText", () => {
  it("extracts text from a single output message", () => {
    const output = [
      {
        type: "message" as const,
        content: [{ type: "output_text" as const, text: "Hello world" }],
      },
    ];
    expect(extractText(output)).toBe("Hello world");
  });

  it("concatenates multiple content blocks", () => {
    const output = [
      {
        type: "message" as const,
        content: [
          { type: "output_text" as const, text: "Hello " },
          { type: "output_text" as const, text: "world" },
        ],
      },
    ];
    expect(extractText(output)).toBe("Hello world");
  });

  it("ignores non-message output items", () => {
    const output = [
      { type: "other" },
      {
        type: "message" as const,
        content: [{ type: "output_text" as const, text: "Hello" }],
      },
    ];
    expect(extractText(output)).toBe("Hello");
  });

  it("returns empty string for empty output", () => {
    expect(extractText([])).toBe("");
  });
});
