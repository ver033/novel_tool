import type { AiTaskRecord } from "../shared/types";

export type AiBudgetedTaskType = AiTaskRecord["taskType"] | "chat";

export type TokenBudget = {
  maxInputTokens: number;
  maxOutputTokens: number;
};

export const DEFAULT_TOKEN_BUDGETS: Record<AiBudgetedTaskType, TokenBudget> = {
  chat: {
    maxInputTokens: 12_000,
    maxOutputTokens: 4_096
  },
  polish: {
    maxInputTokens: 8_000,
    maxOutputTokens: 4_096
  },
  expand: {
    maxInputTokens: 10_000,
    maxOutputTokens: 6_000
  },
  proofread: {
    maxInputTokens: 12_000,
    maxOutputTokens: 8_000
  },
  continue: {
    maxInputTokens: 12_000,
    maxOutputTokens: 6_000
  }
};

export function getTokenBudget(taskType: AiBudgetedTaskType): TokenBudget {
  return { ...DEFAULT_TOKEN_BUDGETS[taskType] };
}
