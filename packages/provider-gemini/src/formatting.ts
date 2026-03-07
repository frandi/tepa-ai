import type { LLMMessage } from "@tepa/types";

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
): "end_turn" | "max_tokens" | "stop_sequence" {
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
