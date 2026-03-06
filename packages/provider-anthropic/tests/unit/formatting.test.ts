import { describe, it, expect } from "vitest";
import { toAnthropicMessages, toFinishReason, extractText } from "../../src/formatting.js";
import type { LLMMessage } from "@tepa/types";

describe("toAnthropicMessages", () => {
  it("converts a single user message", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("converts a multi-turn conversation", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(toAnthropicMessages([])).toEqual([]);
  });
});

describe("toFinishReason", () => {
  it("maps end_turn", () => {
    expect(toFinishReason("end_turn")).toBe("end_turn");
  });

  it("maps max_tokens", () => {
    expect(toFinishReason("max_tokens")).toBe("max_tokens");
  });

  it("maps stop_sequence", () => {
    expect(toFinishReason("stop_sequence")).toBe("stop_sequence");
  });

  it("maps null to end_turn", () => {
    expect(toFinishReason(null)).toBe("end_turn");
  });

  it("maps unknown values to end_turn", () => {
    expect(toFinishReason("tool_use")).toBe("end_turn");
  });
});

describe("extractText", () => {
  it("extracts text from a single text block", () => {
    const content = [{ type: "text" as const, text: "Hello world" }];
    expect(extractText(content)).toBe("Hello world");
  });

  it("concatenates multiple text blocks", () => {
    const content = [
      { type: "text" as const, text: "Hello " },
      { type: "text" as const, text: "world" },
    ];
    expect(extractText(content)).toBe("Hello world");
  });

  it("ignores non-text blocks", () => {
    const content = [
      { type: "text" as const, text: "Hello" },
      { type: "tool_use" as const, id: "1", name: "test", input: {} },
      { type: "text" as const, text: " world" },
    ] as any;
    expect(extractText(content)).toBe("Hello world");
  });

  it("returns empty string for empty content", () => {
    expect(extractText([])).toBe("");
  });
});
