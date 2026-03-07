import type { LLMMessage } from "@tepa/types";

export interface OpenAIInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OutputText {
  type: "output_text";
  text: string;
}

interface OutputMessage {
  type: "message";
  content: OutputText[];
}

export type ResponseOutput = OutputMessage | { type: string };

/**
 * Convert Tepa LLMMessage array + optional system prompt to OpenAI Responses API input format.
 */
export function toOpenAIInput(
  messages: LLMMessage[],
  systemPrompt?: string,
): OpenAIInputMessage[] {
  const input: OpenAIInputMessage[] = [];

  if (systemPrompt) {
    input.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    input.push({ role: msg.role, content: msg.content });
  }

  return input;
}

/**
 * Map OpenAI response status to Tepa finishReason.
 */
export function toFinishReason(
  status: string | null,
): "end_turn" | "max_tokens" | "stop_sequence" {
  switch (status) {
    case "incomplete":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

/**
 * Extract text from OpenAI Responses API output array.
 */
export function extractText(output: ResponseOutput[]): string {
  return output
    .filter((item): item is OutputMessage => item.type === "message")
    .flatMap((item) => item.content)
    .filter((block): block is OutputText => block.type === "output_text")
    .map((block) => block.text)
    .join("");
}
