export interface LLMRequestOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  text: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  finishReason: "end_turn" | "max_tokens" | "stop_sequence";
}

export interface LLMProvider {
  complete(messages: LLMMessage[], options: LLMRequestOptions): Promise<LLMResponse>;
}
