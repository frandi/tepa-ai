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

export type LLMLogStatus = "success" | "error" | "retry";

export interface LLMLogEntry {
  timestamp: string;
  provider: string;
  status: LLMLogStatus;
  durationMs: number;
  attempt: number;
  request: {
    model: string;
    messageCount: number;
    totalCharLength: number;
    promptPreview: string;
    maxTokens?: number;
    temperature?: number;
    hasSystemPrompt: boolean;
    messages?: LLMMessage[];
    systemPrompt?: string;
  };
  response?: {
    text: string;
    tokensUsed: { input: number; output: number };
    finishReason: string;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}

export type LLMLogCallback = (entry: LLMLogEntry) => void;
