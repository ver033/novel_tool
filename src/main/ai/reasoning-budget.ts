import type { OpenRouterReasoningConfig } from "./openrouter-client";
import type { TokenBudget } from "./token-budget";

type ReasoningConfigOptions = {
  readonly exclude: boolean;
  readonly fallbackEffort?: OpenRouterReasoningConfig["effort"];
};

const MIN_REASONING_BUDGET_TOKENS = 256;

export function buildReasoningConfig(budget: TokenBudget, options: ReasoningConfigOptions): OpenRouterReasoningConfig {
  const maxReasoningTokens = budget.maxReasoningTokens ?? 0;
  if (maxReasoningTokens >= MIN_REASONING_BUDGET_TOKENS && maxReasoningTokens < budget.maxOutputTokens) {
    return {
      max_tokens: maxReasoningTokens,
      exclude: options.exclude
    };
  }

  return {
    effort: options.fallbackEffort ?? "medium",
    exclude: options.exclude
  };
}
