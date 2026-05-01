import type { OpenRouterMessage, OpenRouterToolDefinition } from "./openrouter-client";

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

function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return estimateTextTokens(String(value));
  }
}

function estimateMessageExtraTokens(message: OpenRouterMessage): number {
  if (message.role === "assistant") {
    return message.tool_calls ? estimateJsonTokens(message.tool_calls) : 0;
  }
  if (message.role === "tool") {
    return estimateTextTokens([message.tool_call_id, message.name ?? ""].filter(Boolean).join("\n"));
  }
  return 0;
}

export function estimateMessagesTokens(messages: readonly OpenRouterMessage[], tools: readonly OpenRouterToolDefinition[] = []): number {
  const messageTokens = messages.reduce(
    (total, message) =>
      total + MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.role) + estimateTextTokens(message.content ?? "") + estimateMessageExtraTokens(message),
    0
  );
  if (tools.length === 0) {
    return messageTokens;
  }
  return messageTokens + MESSAGE_OVERHEAD_TOKENS + estimateJsonTokens(tools);
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
