import type { LLMMessage, LLMToolUseBlock, ToolSchema } from "@tepa/types";

export interface OpenAIInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OutputText {
  type: "output_text";
  text: string;
}

interface FunctionCallOutput {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

interface OutputMessage {
  type: "message";
  content: OutputText[];
}

export type ResponseOutput = OutputMessage | FunctionCallOutput | { type: string };

/**
 * Convert Tepa LLMMessage array + optional system prompt to OpenAI Responses API input format.
 */
export function toOpenAIInput(messages: LLMMessage[], systemPrompt?: string): OpenAIInputMessage[] {
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
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
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

/**
 * Extract tool use blocks from OpenAI Responses API output.
 */
export function extractToolUse(output: ResponseOutput[]): LLMToolUseBlock[] {
  return output
    .filter((item): item is FunctionCallOutput => item.type === "function_call")
    .map((item) => ({
      id: item.call_id,
      name: item.name,
      input: JSON.parse(item.arguments) as Record<string, unknown>,
    }));
}

/**
 * Convert Tepa ToolSchema to OpenAI Responses API tool format.
 */
export function toOpenAITools(tools: ToolSchema[]): Record<string, unknown>[] {
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
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    };
  });
}
