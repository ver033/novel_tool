import type { AiTaskRecord } from "../shared/types";

export type AiBudgetedTaskType = AiTaskRecord["taskType"] | "chat";

export type TokenBudget = {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxReasoningTokens?: number;
};

export const DEFAULT_TOKEN_BUDGETS: Record<AiBudgetedTaskType, TokenBudget> = {
  chat: {
    maxInputTokens: 12_000,
    maxOutputTokens: 24_000,
    maxReasoningTokens: 4_000
  },
  polish: {
    maxInputTokens: 8_000,
    maxOutputTokens: 8_000,
    maxReasoningTokens: 2_000
  },
  expand: {
    maxInputTokens: 10_000,
    maxOutputTokens: 12_000,
    maxReasoningTokens: 3_000
  },
  proofread: {
    maxInputTokens: 12_000,
    maxOutputTokens: 12_000,
    maxReasoningTokens: 4_000
  },
  continue: {
    maxInputTokens: 12_000,
    maxOutputTokens: 12_000,
    maxReasoningTokens: 3_000
  }
};

const MODEL_CONTEXT_OUTPUT_RATIO = 0.35;
const MODEL_CONTEXT_SAFETY_RESERVE_RATIO = 0.08;
const MODEL_CONTEXT_MAX_SAFETY_RESERVE_TOKENS = 1024;
const MODEL_CONTEXT_MIN_SAFETY_RESERVE_TOKENS = 256;
const MIN_DYNAMIC_OUTPUT_TOKENS = 512;
const MIN_VISIBLE_COMPLETION_TOKENS = 1024;

export function getTokenBudget(taskType: AiBudgetedTaskType, modelContextTokens?: number | null): TokenBudget {
  const defaults = DEFAULT_TOKEN_BUDGETS[taskType];
  if (!modelContextTokens || !Number.isFinite(modelContextTokens) || modelContextTokens <= 0) {
    return { ...defaults };
  }

  const safetyReserveTokens = Math.min(
    MODEL_CONTEXT_MAX_SAFETY_RESERVE_TOKENS,
    Math.max(MODEL_CONTEXT_MIN_SAFETY_RESERVE_TOKENS, Math.floor(modelContextTokens * MODEL_CONTEXT_SAFETY_RESERVE_RATIO))
  );
  const availableTokens = Math.max(1, Math.floor(modelContextTokens) - safetyReserveTokens);
  const maxOutputTokens = Math.min(
    defaults.maxOutputTokens,
    Math.max(MIN_DYNAMIC_OUTPUT_TOKENS, Math.floor(modelContextTokens * MODEL_CONTEXT_OUTPUT_RATIO)),
    Math.max(1, availableTokens - 1)
  );
  const dynamicInputTokens = Math.max(1, availableTokens - maxOutputTokens);
  const maxReasoningTokens = Math.min(
    defaults.maxReasoningTokens ?? 0,
    Math.max(0, maxOutputTokens - MIN_VISIBLE_COMPLETION_TOKENS)
  );

  return {
    maxInputTokens: dynamicInputTokens,
    maxOutputTokens,
    maxReasoningTokens
  };
}
