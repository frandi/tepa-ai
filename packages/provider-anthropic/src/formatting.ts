import type { LLMMessage } from "@tepa/types";
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
): "end_turn" | "max_tokens" | "stop_sequence" {
  switch (stopReason) {
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
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
