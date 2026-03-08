import type { LLMLogEntry } from "@tepa/types";

const RESPONSE_PREVIEW_LENGTH = 120;

export function defaultLogCallback(entry: LLMLogEntry): void {
  const { provider, status, durationMs, request, response, error } = entry;

  let detail: string;
  if (status === "success" && response) {
    const totalTokens = response.tokensUsed.input + response.tokensUsed.output;
    detail = `${totalTokens} tokens (${request.model})`;
  } else if (error) {
    detail = error.message;
  } else {
    detail = `(${request.model})`;
  }

  const attemptSuffix = status === "retry" ? ` (attempt ${entry.attempt})` : "";
  const time = formatTime(entry.timestamp);

  console.log(`[${time}][${status}${attemptSuffix}][${provider}] ${durationMs}ms | ${detail}`);

  if (request.promptPreview) {
    console.log(`  → ${request.promptPreview}`);
  }
  if (status === "success" && response) {
    const responsePreview = truncatePreview(response.text, RESPONSE_PREVIEW_LENGTH);
    if (responsePreview) {
      console.log(`  ← ${responsePreview}`);
    }
  }
}

function formatTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function truncatePreview(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return collapsed.slice(0, maxLength) + "...";
}
