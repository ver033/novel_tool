import { estimateTextTokens } from "./token-estimator";
import type { TokenBudget } from "./token-budget";
import type { AiChatMessageRecord } from "../shared/types";

const CHAT_MEMORY_COMPACTION_TRIGGER_RATIO = 0.75;
const CHAT_MEMORY_RECENT_TAIL_RATIO = 0.2;
const CHAT_MEMORY_MAX_RECENT_TAIL_TOKENS = 8000;
const CHAT_MEMORY_MIN_RECENT_TAIL_TOKENS = 2000;
const CHAT_MEMORY_MIN_BUDGET_TOKENS = 400;
const CHAT_MEMORY_TAIL_BUDGET_RATIO = 0.55;

export type ChatAgentMemoryInput = {
  readonly history: readonly AiChatMessageRecord[];
  readonly tokenBudget: TokenBudget;
  readonly compactedSummary?: string | null;
  readonly compactedThroughMessageId?: string | null;
  readonly reservedInputTokens?: number;
};

export type ChatMemoryCompactionTarget = {
  readonly messagesToCompact: readonly AiChatMessageRecord[];
  readonly compactedThroughMessageId: string;
};

type ChatAgentMemoryPolicy = {
  readonly memoryTokenBudget: number;
  readonly recentTailTokenBudget: number;
};

function getChatAgentMemoryPolicy(tokenBudget: TokenBudget, reservedInputTokens = 0): ChatAgentMemoryPolicy {
  const availableTriggerTokens = Math.max(
    CHAT_MEMORY_MIN_BUDGET_TOKENS,
    Math.floor(tokenBudget.maxInputTokens * CHAT_MEMORY_COMPACTION_TRIGGER_RATIO) - Math.max(0, reservedInputTokens)
  );
  const preferredTailTokens = Math.min(
    CHAT_MEMORY_MAX_RECENT_TAIL_TOKENS,
    Math.max(CHAT_MEMORY_MIN_RECENT_TAIL_TOKENS, Math.floor(tokenBudget.maxInputTokens * CHAT_MEMORY_RECENT_TAIL_RATIO))
  );
  const tailBudget = Math.min(preferredTailTokens, Math.max(CHAT_MEMORY_MIN_BUDGET_TOKENS, Math.floor(availableTriggerTokens * CHAT_MEMORY_TAIL_BUDGET_RATIO)));

  return {
    memoryTokenBudget: availableTriggerTokens,
    recentTailTokenBudget: tailBudget
  };
}

function relevantChatMessages(history: readonly AiChatMessageRecord[]): readonly AiChatMessageRecord[] {
  return history.filter((message) => message.role === "user" || message.role === "assistant");
}

function formatChatMessage(message: AiChatMessageRecord): string {
  return `${message.role === "user" ? "作者" : "AI"}：${message.content.trim()}`;
}

function formatChatMessages(messages: readonly AiChatMessageRecord[]): string {
  return messages.map(formatChatMessage).filter((line) => line.trim()).join("\n");
}

function findCompactedThroughIndex(messages: readonly AiChatMessageRecord[], compactedThroughMessageId?: string | null): number {
  if (!compactedThroughMessageId) {
    return -1;
  }
  return messages.findIndex((message) => message.id === compactedThroughMessageId);
}

export function selectChatMemoryCompactionTarget(input: ChatAgentMemoryInput): ChatMemoryCompactionTarget | null {
  const messages = relevantChatMessages(input.history);
  if (messages.length === 0) {
    return null;
  }
  const memoryPolicy = getChatAgentMemoryPolicy(input.tokenBudget, input.reservedInputTokens);
  const compactedThroughIndex = findCompactedThroughIndex(messages, input.compactedThroughMessageId);
  const existingMemoryText = [input.compactedSummary?.trim(), formatChatMessages(messages.slice(compactedThroughIndex + 1))].filter(Boolean).join("\n\n");
  if (estimateTextTokens(existingMemoryText) <= memoryPolicy.memoryTokenBudget) {
    return null;
  }

  let tailStartIndex = messages.length;
  let tailTokens = 0;
  for (let index = messages.length - 1; index >= compactedThroughIndex + 1; index -= 1) {
    const nextTokens = estimateTextTokens(formatChatMessage(messages[index]));
    if (tailStartIndex < messages.length && tailTokens + nextTokens > memoryPolicy.recentTailTokenBudget) {
      break;
    }
    tailStartIndex = index;
    tailTokens += nextTokens;
  }

  const messagesToCompact = messages.slice(compactedThroughIndex + 1, tailStartIndex);
  const compactedThroughMessage = messagesToCompact.at(-1);
  if (!compactedThroughMessage) {
    throw new Error("AI 对话记忆超过预算，且最近消息本身过长。请开启新对话，或缩短上一轮超长回复后重试。");
  }

  return {
    messagesToCompact,
    compactedThroughMessageId: compactedThroughMessage.id
  };
}

export function buildChatAgentMemoryText(input: ChatAgentMemoryInput): string {
  const messages = relevantChatMessages(input.history);
  const compactedThroughIndex = findCompactedThroughIndex(messages, input.compactedThroughMessageId);
  const recentMessages = messages.slice(compactedThroughIndex + 1);
  const recentText = formatChatMessages(recentMessages);
  const compactedSummary = input.compactedSummary?.trim() ?? "";
  if (!compactedSummary && !recentText) {
    return "（无）";
  }

  const sections: string[] = [];
  if (compactedSummary) {
    sections.push(["【已压缩的较早对话】", compactedSummary].join("\n"));
  }
  if (recentText) {
    sections.push(["【最近对话原文】", recentText].join("\n"));
  }
  const memoryText = sections.join("\n\n");
  const memoryPolicy = getChatAgentMemoryPolicy(input.tokenBudget, input.reservedInputTokens);
  if (estimateTextTokens(memoryText) > memoryPolicy.memoryTokenBudget) {
    throw new Error("AI 对话记忆超过预算，需要先压缩上下文。");
  }
  return memoryText;
}
