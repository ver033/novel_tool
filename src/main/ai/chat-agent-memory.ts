import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import type { TokenBudget } from "./token-budget";
import type { AiChatMessageRecord } from "../shared/types";

const CHAT_MEMORY_COMPACTION_TRIGGER_RATIO = 0.75;
const CHAT_MEMORY_RECENT_TAIL_RATIO = 0.2;
const CHAT_MEMORY_MAX_RECENT_TAIL_TOKENS = 8000;
const CHAT_MEMORY_MIN_RECENT_TAIL_TOKENS = 2000;
const CHAT_MEMORY_MIN_BUDGET_TOKENS = 400;
const CHAT_MEMORY_TAIL_BUDGET_RATIO = 0.55;
const CHAT_MEMORY_LOCAL_COMPACTION_NOTICE = "（较早对话或超长消息已按当前模型窗口压缩。）";

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

function buildMemoryText(compactedSummary: string, recentMessages: readonly AiChatMessageRecord[]): string {
  const recentText = formatChatMessages(recentMessages);
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
  return sections.join("\n\n");
}

function buildBudgetedMemoryText(
  compactedSummary: string,
  recentMessages: readonly AiChatMessageRecord[],
  memoryTokenBudget: number
): string {
  const fullMemoryText = buildMemoryText(compactedSummary, recentMessages);
  if (estimateTextTokens(fullMemoryText) <= memoryTokenBudget) {
    return fullMemoryText;
  }

  const summaryBudget = compactedSummary ? Math.max(80, Math.floor(memoryTokenBudget * 0.35)) : 0;
  const compactedSummaryText =
    compactedSummary && summaryBudget > 0
      ? `${truncateTextToTokenBudget(compactedSummary, summaryBudget).text.trim()}\n${CHAT_MEMORY_LOCAL_COMPACTION_NOTICE}`.trim()
      : "";
  const sections: string[] = [];
  if (compactedSummaryText) {
    sections.push(["【已压缩的较早对话】", compactedSummaryText].join("\n"));
  }

  const recentLines: string[] = [];
  const wrapperTokens = estimateTextTokens(buildMemoryText(compactedSummaryText, [])) + estimateTextTokens("【最近对话原文】") + 32;
  let remainingTailBudget = Math.max(80, memoryTokenBudget - wrapperTokens);
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const line = formatChatMessage(recentMessages[index]);
    const lineTokens = estimateTextTokens(line);
    if (lineTokens <= remainingTailBudget) {
      recentLines.unshift(line);
      remainingTailBudget -= lineTokens;
      continue;
    }
    if (recentLines.length === 0 && remainingTailBudget > 80) {
      recentLines.unshift(`${truncateTextToTokenBudget(line, remainingTailBudget).text.trim()}\n${CHAT_MEMORY_LOCAL_COMPACTION_NOTICE}`.trim());
    }
    break;
  }
  if (recentLines.length > 0) {
    sections.push(["【最近对话原文】", recentLines.join("\n")].join("\n"));
  }

  const candidate = sections.join("\n\n") || CHAT_MEMORY_LOCAL_COMPACTION_NOTICE;
  if (estimateTextTokens(candidate) <= memoryTokenBudget) {
    return candidate;
  }
  return `${truncateTextToTokenBudget(candidate, memoryTokenBudget).text.trim()}\n${CHAT_MEMORY_LOCAL_COMPACTION_NOTICE}`.trim();
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
  const compactedSummary = input.compactedSummary?.trim() ?? "";
  const existingMemoryText = buildMemoryText(compactedSummary, messages.slice(compactedThroughIndex + 1));
  if (estimateTextTokens(existingMemoryText) <= memoryPolicy.memoryTokenBudget) {
    return null;
  }

  let tailStartIndex = messages.length;
  let tailTokens = 0;
  for (let index = messages.length - 1; index >= compactedThroughIndex + 1; index -= 1) {
    const nextTokens = estimateTextTokens(formatChatMessage(messages[index]));
    if (tailTokens + nextTokens > memoryPolicy.recentTailTokenBudget) {
      break;
    }
    tailStartIndex = index;
    tailTokens += nextTokens;
  }

  const messagesToCompact = messages.slice(compactedThroughIndex + 1, tailStartIndex);
  const compactedThroughMessage = messagesToCompact.at(-1);
  if (!compactedThroughMessage) {
    return null;
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
  const compactedSummary = input.compactedSummary?.trim() ?? "";
  const memoryText = buildMemoryText(compactedSummary, recentMessages);
  const memoryPolicy = getChatAgentMemoryPolicy(input.tokenBudget, input.reservedInputTokens);
  return estimateTextTokens(memoryText) <= memoryPolicy.memoryTokenBudget
    ? memoryText
    : buildBudgetedMemoryText(compactedSummary, recentMessages, memoryPolicy.memoryTokenBudget);
}
