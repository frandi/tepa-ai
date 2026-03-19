import { describe, it, expect } from "vitest";
import {
  toGeminiContents,
  toGeminiTools,
  toGeminiToolConfig,
  toFinishReason,
  extractText,
} from "../../src/formatting.js";
import type { LLMMessage, ToolChoice, ToolSchema } from "@tepa/types";

describe("toGeminiContents", () => {
  it("converts a single user message", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toGeminiContents(messages);
    expect(result).toEqual([{ role: "user", parts: [{ text: "Hello" }] }]);
  });

  it("maps assistant role to model", () => {
    const messages: LLMMessage[] = [{ role: "assistant", content: "Hi there" }];
    const result = toGeminiContents(messages);
    expect(result).toEqual([{ role: "model", parts: [{ text: "Hi there" }] }]);
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

  it("converts assistant message with toolUse to functionCall parts", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: "",
        toolUse: [{ id: "gemini-call-0", name: "get_weather", input: { city: "Tokyo" } }],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      {
        role: "model",
        parts: [{ functionCall: { name: "get_weather", args: { city: "Tokyo" } } }],
      },
    ]);
  });

  it("includes text part when assistant message has both content and toolUse", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: "Let me check the weather.",
        toolUse: [{ id: "gemini-call-0", name: "get_weather", input: { city: "Tokyo" } }],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      {
        role: "model",
        parts: [
          { text: "Let me check the weather." },
          { functionCall: { name: "get_weather", args: { city: "Tokyo" } } },
        ],
      },
    ]);
  });

  it("converts user message with toolResult to functionResponse parts", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: "",
        toolResult: [
          {
            toolUseId: "gemini-call-0",
            name: "get_weather",
            result: '{"city":"Tokyo","temperature":22}',
          },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "get_weather",
              response: { city: "Tokyo", temperature: 22 },
            },
          },
        ],
      },
    ]);
  });

  it("wraps non-JSON tool result in { result: ... }", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: "",
        toolResult: [
          {
            toolUseId: "gemini-call-0",
            name: "search",
            result: "plain text result",
          },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "search",
              response: { result: "plain text result" },
            },
          },
        ],
      },
    ]);
  });

  it("handles a full tool-use conversation round-trip", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "What's the weather in Tokyo?" },
      {
        role: "assistant",
        content: "",
        toolUse: [{ id: "gemini-call-0", name: "get_weather", input: { city: "Tokyo" } }],
      },
      {
        role: "user",
        content: "",
        toolResult: [
          {
            toolUseId: "gemini-call-0",
            name: "get_weather",
            result: '{"temperature":22}',
          },
        ],
      },
    ];
    const result = toGeminiContents(messages);
    expect(result).toEqual([
      { role: "user", parts: [{ text: "What's the weather in Tokyo?" }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "get_weather", args: { city: "Tokyo" } } }],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "get_weather", response: { temperature: 22 } } }],
      },
    ]);
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

describe("toGeminiTools", () => {
  it("includes enum values when present", () => {
    const tools: ToolSchema[] = [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: {
          city: { type: "string", description: "City name" },
          unit: { type: "string", description: "Unit", enum: ["celsius", "fahrenheit"] },
        },
      },
    ];
    const result = toGeminiTools(tools);
    const decl = (result[0] as any).functionDeclarations[0];
    expect(decl.parameters.properties.unit).toEqual({
      type: "STRING",
      description: "Unit",
      enum: ["celsius", "fahrenheit"],
    });
  });

  it("omits enum when not present", () => {
    const tools: ToolSchema[] = [
      {
        name: "search",
        description: "Search",
        parameters: {
          query: { type: "string", description: "Query" },
        },
      },
    ];
    const result = toGeminiTools(tools);
    const decl = (result[0] as any).functionDeclarations[0];
    expect(decl.parameters.properties.query).toEqual({
      type: "STRING",
      description: "Query",
    });
    expect(decl.parameters.properties.query.enum).toBeUndefined();
  });
});

describe("toGeminiToolConfig", () => {
  it("returns undefined for undefined (default AUTO)", () => {
    expect(toGeminiToolConfig(undefined)).toBeUndefined();
  });

  it("returns undefined for 'auto'", () => {
    expect(toGeminiToolConfig("auto")).toBeUndefined();
  });

  it("returns mode ANY for 'any'", () => {
    expect(toGeminiToolConfig("any")).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
  });

  it("returns mode NONE for 'none'", () => {
    expect(toGeminiToolConfig("none")).toEqual({
      functionCallingConfig: { mode: "NONE" },
    });
  });

  it("returns mode ANY with allowedFunctionNames for { name }", () => {
    expect(toGeminiToolConfig({ name: "get_weather" })).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["get_weather"],
      },
    });
  });
});

describe("extractText", () => {
  it("extracts text from candidates parts", () => {
    const response = {
      candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
    };
    expect(extractText(response)).toBe("Hello world");
  });

  it("returns empty string when no candidates", () => {
    expect(extractText({})).toBe("");
  });

  it("returns empty string when parts have no text", () => {
    const response = {
      candidates: [{ content: { parts: [{ functionCall: { name: "foo" } }] } }],
    };
    expect(extractText(response)).toBe("");
  });
});
