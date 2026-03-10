import type { LLMMessage, LLMToolUseBlock, ToolSchema } from "@tepa/types";

export interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

/**
 * Convert Tepa LLMMessage array to Gemini contents format.
 * Maps "assistant" role to "model".
 */
export function toGeminiContents(messages: LLMMessage[]): GeminiContent[] {
  return messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));
}

/**
 * Map Gemini finish reason to Tepa finishReason.
 */
export function toFinishReason(
  reason: string | null | undefined,
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
  switch (reason) {
    case "MAX_TOKENS":
      return "max_tokens";
    case "STOP":
    default:
      return "end_turn";
  }
}

/**
 * Extract text from a Gemini response.
 */
export function extractText(response: { text?: string }): string {
  return response.text ?? "";
}

/**
 * Extract tool use blocks from a Gemini response.
 */
export function extractToolUse(response: any): LLMToolUseBlock[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const blocks: LLMToolUseBlock[] = [];
  let index = 0;

  for (const part of parts) {
    if (part.functionCall?.name) {
      blocks.push({
        id: `gemini-call-${index++}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    }
  }

  return blocks;
}

/**
 * Convert Tepa ToolSchema to Gemini function declarations.
 */
export function toGeminiTools(tools: ToolSchema[]): Record<string, unknown>[] {
  const functionDeclarations = tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(tool.parameters)) {
      properties[name] = {
        type: param.type.toUpperCase(),
        description: param.description,
      };
      if (param.required !== false) {
        required.push(name);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "OBJECT",
        properties,
        required,
      },
    };
  });

  return [{ functionDeclarations }];
}
