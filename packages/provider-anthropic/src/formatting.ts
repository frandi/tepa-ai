import type { LLMMessage, LLMToolUseBlock, ToolSchema } from "@tepa/types";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Convert Tepa LLMMessage array to Anthropic message format.
 */
export function toAnthropicMessages(
  messages: LLMMessage[],
): Anthropic.MessageParam[] {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Map Anthropic stop_reason to Tepa finishReason.
 */
export function toFinishReason(
  stopReason: string | null,
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
  switch (stopReason) {
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "tool_use":
      return "tool_use";
    default:
      return "end_turn";
  }
}

/**
 * Extract text content from Anthropic response content blocks.
 */
export function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Extract tool use blocks from Anthropic response content blocks.
 */
export function extractToolUse(content: Anthropic.ContentBlock[]): LLMToolUseBlock[] {
  return content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    }));
}

/**
 * Convert Tepa ToolSchema to Anthropic tool format.
 */
export function toAnthropicTools(tools: ToolSchema[]): Anthropic.Tool[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(tool.parameters)) {
      properties[name] = {
        type: param.type,
        description: param.description,
      };
      if (param.required !== false) {
        required.push(name);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties,
        required,
      },
    };
  });
}
