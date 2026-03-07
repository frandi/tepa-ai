import { describe, it, expect } from "vitest";
import { toGeminiContents, toFinishReason, extractText } from "../../src/formatting.js";
import type { LLMMessage } from "@tepa/types";

describe("toGeminiContents", () => {
  it("converts a single user message", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
    ]);
  });

  it("maps assistant role to model", () => {
    const messages: LLMMessage[] = [{ role: "assistant", content: "Hi there" }];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      { role: "model", parts: [{ text: "Hi there" }] },
    ]);
  });

  it("converts a multi-turn conversation", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      { role: "user", parts: [{ text: "What is 2+2?" }] },
      { role: "model", parts: [{ text: "4" }] },
      { role: "user", parts: [{ text: "And 3+3?" }] },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(toGeminiContents([])).toEqual([]);
  });
});

describe("toFinishReason", () => {
  it("maps STOP to end_turn", () => {
    expect(toFinishReason("STOP")).toBe("end_turn");
  });

  it("maps MAX_TOKENS to max_tokens", () => {
    expect(toFinishReason("MAX_TOKENS")).toBe("max_tokens");
  });

  it("maps SAFETY to end_turn", () => {
    expect(toFinishReason("SAFETY")).toBe("end_turn");
  });

  it("maps RECITATION to end_turn", () => {
    expect(toFinishReason("RECITATION")).toBe("end_turn");
  });

  it("maps null to end_turn", () => {
    expect(toFinishReason(null)).toBe("end_turn");
  });

  it("maps undefined to end_turn", () => {
    expect(toFinishReason(undefined)).toBe("end_turn");
  });

  it("maps unknown values to end_turn", () => {
    expect(toFinishReason("OTHER")).toBe("end_turn");
  });
});

describe("extractText", () => {
  it("extracts text when present", () => {
    expect(extractText({ text: "Hello world" })).toBe("Hello world");
  });

  it("returns empty string when text is undefined", () => {
    expect(extractText({})).toBe("");
  });

  it("returns empty string when text is empty", () => {
    expect(extractText({ text: "" })).toBe("");
  });
});
