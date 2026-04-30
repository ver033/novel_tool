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

const MODEL_CONTEXT_INPUT_RATIO = 0.72;
const MODEL_CONTEXT_OUTPUT_RATIO = 0.4;
const MODEL_CONTEXT_SAFETY_RESERVE_TOKENS = 1024;
const MIN_DYNAMIC_OUTPUT_TOKENS = 512;

export function getTokenBudget(taskType: AiBudgetedTaskType, modelContextTokens?: number | null): TokenBudget {
  const defaults = DEFAULT_TOKEN_BUDGETS[taskType];
  if (!modelContextTokens || !Number.isFinite(modelContextTokens) || modelContextTokens <= 0) {
    return { ...defaults };
  }

  const maxOutputTokens = Math.min(
    defaults.maxOutputTokens,
    Math.max(MIN_DYNAMIC_OUTPUT_TOKENS, Math.floor(modelContextTokens * MODEL_CONTEXT_OUTPUT_RATIO))
  );
  const dynamicInputTokens = Math.max(
    0,
    Math.floor(modelContextTokens * MODEL_CONTEXT_INPUT_RATIO) - maxOutputTokens - MODEL_CONTEXT_SAFETY_RESERVE_TOKENS
  );

  return {
    maxInputTokens: dynamicInputTokens,
    maxOutputTokens
  };
}
