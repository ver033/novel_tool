import type { OpenRouterMessage } from "./openrouter-client";

const MESSAGE_OVERHEAD_TOKENS = 4;

function countCjk(value: string): number {
  return Array.from(value.matchAll(/[\u3400-\u9fff\uf900-\ufaff]/g)).length;
}

function countNonWhitespace(value: string): number {
  return value.replace(/\s+/g, "").length;
}

export function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  const cjkCount = countCjk(normalized);
  const nonWhitespaceCount = countNonWhitespace(normalized);
  const nonCjkCount = Math.max(0, nonWhitespaceCount - cjkCount);

  return Math.ceil(cjkCount * 1.1 + nonCjkCount / 3);
}

export function estimateMessagesTokens(messages: readonly OpenRouterMessage[]): number {
  return messages.reduce(
    (total, message) => total + MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.role) + estimateTextTokens(message.content ?? ""),
    0
  );
}

export function truncateTextToTokenBudget(text: string, maxTokens: number): { readonly text: string; readonly truncated: boolean } {
  if (maxTokens <= 0) {
    return {
      text: "",
      truncated: text.length > 0
    };
  }

  if (estimateTextTokens(text) <= maxTokens) {
    return {
      text,
      truncated: false
    };
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTextTokens(text.slice(0, mid)) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return {
    text: text.slice(0, low).trimEnd(),
    truncated: true
  };
}
