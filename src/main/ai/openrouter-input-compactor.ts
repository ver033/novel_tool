import type { OpenRouterMessage, OpenRouterToolDefinition } from "./openrouter-client";
import { estimateMessagesTokens, estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";

const CONTEXT_COMPACTION_NOTICE = "（部分上下文已按当前模型输入窗口压缩。）";
const TOOL_RESULT_COMPACTION_NOTICE = "（工具结果已按当前模型输入窗口压缩；如需完整细节，请缩小范围继续追问。）";
const MIN_MESSAGE_CONTENT_TOKENS = 80;
const INPUT_COMPACTION_MAX_ROUNDS = 30;

export type CompactedOpenRouterInput = {
  readonly messages: readonly OpenRouterMessage[];
  readonly tools: readonly OpenRouterToolDefinition[];
  readonly compacted: boolean;
};

function cloneMessage(message: OpenRouterMessage): OpenRouterMessage {
  if (message.role === "assistant") {
    return {
      ...message,
      tool_calls: message.tool_calls ? [...message.tool_calls] : undefined
    };
  }
  return { ...message };
}

function stripDescriptionFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDescriptionFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "description")
      .map(([key, nested]) => [key, stripDescriptionFields(nested)])
  );
}

export function compactOpenRouterTools(tools: readonly OpenRouterToolDefinition[]): readonly OpenRouterToolDefinition[] {
  return tools.map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: truncateTextToTokenBudget(tool.function.description, 80).text || tool.function.name,
      parameters: stripDescriptionFields(tool.function.parameters) as object
    }
  }));
}

function compactStringContent(content: string, maxTokens: number, notice = CONTEXT_COMPACTION_NOTICE): string {
  const noticeTokens = estimateTextTokens(notice) + 4;
  const textBudget = Math.max(0, maxTokens - noticeTokens);
  const truncated = truncateTextToTokenBudget(content, textBudget);
  return truncated.text.trim() ? `${truncated.text.trim()}\n${notice}` : notice;
}

export function compactToolResultContent(content: string, maxTokens: number): string {
  return compactStringContent(content, maxTokens, TOOL_RESULT_COMPACTION_NOTICE);
}

function compactMessageContent(message: OpenRouterMessage, maxTokens: number): OpenRouterMessage {
  if (message.role === "assistant") {
    return {
      ...message,
      content: message.content ? compactStringContent(message.content, maxTokens) : message.content
    };
  }
  if (message.role === "tool") {
    return {
      ...message,
      content: compactToolResultContent(message.content, maxTokens)
    };
  }
  return {
    ...message,
    content: compactStringContent(message.content, maxTokens)
  };
}

function contentTokenCount(message: OpenRouterMessage): number {
  return estimateTextTokens(message.content ?? "");
}

function findLargestCompactableMessageIndex(messages: readonly OpenRouterMessage[]): number {
  let bestIndex = -1;
  let bestTokens = 0;
  messages.forEach((message, index) => {
    if (message.role === "system") {
      return;
    }
    const tokens = contentTokenCount(message);
    if (tokens > bestTokens && tokens > MIN_MESSAGE_CONTENT_TOKENS) {
      bestIndex = index;
      bestTokens = tokens;
    }
  });
  return bestIndex;
}

function fallbackMessages(messages: readonly OpenRouterMessage[], maxInputTokens: number, tools: readonly OpenRouterToolDefinition[]): readonly OpenRouterMessage[] {
  const system = messages.find((message) => message.role === "system") ?? null;
  const lastUser = [...messages].reverse().find((message): message is Extract<OpenRouterMessage, { readonly role: "user" }> => message.role === "user") ?? null;
  if (!lastUser) {
    return system ? [system] : [];
  }

  const baseMessages: OpenRouterMessage[] = system ? [system, lastUser] : [lastUser];
  const reserved = estimateMessagesTokens(baseMessages.map((message) => (message === lastUser ? { ...message, content: "" } : message)), tools);
  const userBudget = Math.max(MIN_MESSAGE_CONTENT_TOKENS, maxInputTokens - reserved - 32);
  return [...(system ? [system] : []), compactMessageContent(lastUser, userBudget)];
}

export function compactOpenRouterInput(input: {
  readonly messages: readonly OpenRouterMessage[];
  readonly tools?: readonly OpenRouterToolDefinition[];
  readonly maxInputTokens: number;
}): CompactedOpenRouterInput {
  let messages = input.messages.map(cloneMessage);
  let tools = input.tools ?? [];
  if (estimateMessagesTokens(messages, tools) <= input.maxInputTokens) {
    return {
      messages,
      tools,
      compacted: false
    };
  }

  let compacted = false;
  const compactedTools = compactOpenRouterTools(tools);
  if (estimateMessagesTokens(messages, compactedTools) <= input.maxInputTokens) {
    return {
      messages,
      tools: compactedTools,
      compacted: true
    };
  }
  tools = compactedTools;
  compacted = true;

  for (let round = 0; round < INPUT_COMPACTION_MAX_ROUNDS; round += 1) {
    if (estimateMessagesTokens(messages, tools) <= input.maxInputTokens) {
      return {
        messages,
        tools,
        compacted
      };
    }
    const index = findLargestCompactableMessageIndex(messages);
    if (index < 0) {
      break;
    }
    const nextBudget = Math.max(MIN_MESSAGE_CONTENT_TOKENS, Math.floor(contentTokenCount(messages[index]) * 0.55));
    messages[index] = compactMessageContent(messages[index], nextBudget);
  }

  messages = [...fallbackMessages(messages, input.maxInputTokens, tools)];
  if (estimateMessagesTokens(messages, tools) <= input.maxInputTokens) {
    return {
      messages,
      tools,
      compacted: true
    };
  }

  const noToolMessages = fallbackMessages(messages, input.maxInputTokens, []);
  return {
    messages: noToolMessages,
    tools: [],
    compacted: true
  };
}
