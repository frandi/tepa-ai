import type { LLMMessage, LLMToolUseBlock, ToolChoice, ToolSchema } from "@tepa/types";

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

/**
 * Convert Tepa LLMMessage array to Gemini contents format.
 *
 * Handles three message shapes:
 * 1. Plain text messages → `{ text }` parts
 * 2. Assistant messages with `toolUse` → `{ functionCall }` parts
 * 3. User messages with `toolResult` → `{ functionResponse }` parts
 */
export function toGeminiContents(messages: LLMMessage[]): GeminiContent[] {
  return messages.map((msg) => {
    const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";

    // Assistant message with tool calls
    if (msg.role === "assistant" && msg.toolUse && msg.toolUse.length > 0) {
      const parts: GeminiPart[] = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      for (const tool of msg.toolUse) {
        parts.push({
          functionCall: {
            name: tool.name,
            args: tool.input,
          },
        });
      }
      return { role, parts };
    }

    // User message with tool results
    if (msg.role === "user" && msg.toolResult && msg.toolResult.length > 0) {
      const parts: GeminiPart[] = [];
      for (const result of msg.toolResult) {
        let response: Record<string, unknown>;
        try {
          response = JSON.parse(result.result);
        } catch {
          response = { result: result.result };
        }
        parts.push({
          functionResponse: {
            name: result.name,
            response,
          },
        });
      }
      return { role, parts };
    }

    // Plain text message
    return { role, parts: [{ text: msg.content }] };
  });
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
 * Extract text from a Gemini response by reading text parts directly
 * from candidates. This avoids the SDK's `response.text` getter which
 * logs a warning when the response also contains functionCall parts.
 */
export function extractText(response: Record<string, unknown>): string {
  const resp = response as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
    }[];
  };
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text!)
    .join("");
}

/**
 * Extract tool use blocks from a Gemini response.
 */
export function extractToolUse(response: Record<string, unknown>): LLMToolUseBlock[] {
  const resp = response as {
    candidates?: {
      content?: { parts?: { functionCall?: { name: string; args?: Record<string, unknown> } }[] };
    }[];
  };
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
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
      const prop: Record<string, unknown> = {
        type: param.type.toUpperCase(),
        description: param.description,
      };
      if (param.enum && param.enum.length > 0) {
        prop.enum = param.enum;
      }
      properties[name] = prop;
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

/**
 * Convert Tepa ToolChoice to Gemini toolConfig.
 * Returns undefined when no config is needed (defaults to AUTO).
 */
export function toGeminiToolConfig(
  toolChoice: ToolChoice | undefined,
): Record<string, unknown> | undefined {
  if (toolChoice === undefined || toolChoice === "auto") {
    return undefined;
  }

  if (toolChoice === "any") {
    return { functionCallingConfig: { mode: "ANY" } };
  }

  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }

  // { name: "tool_name" } — force a specific tool
  return {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [toolChoice.name],
    },
  };
}
