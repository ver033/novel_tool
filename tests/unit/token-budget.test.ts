import { describe, expect, it } from "vitest";
import { DEFAULT_TOKEN_BUDGETS, getTokenBudget } from "../../src/main/ai/token-budget";

describe("AI token budgets", () => {
  it("defines separate input and output budgets by AI task type", () => {
    expect(DEFAULT_TOKEN_BUDGETS).toEqual({
      chat: { maxInputTokens: 12000, maxOutputTokens: 12000, maxReasoningTokens: 4000 },
      polish: { maxInputTokens: 8000, maxOutputTokens: 8000, maxReasoningTokens: 2000 },
      expand: { maxInputTokens: 10000, maxOutputTokens: 12000, maxReasoningTokens: 3000 },
      proofread: { maxInputTokens: 12000, maxOutputTokens: 12000, maxReasoningTokens: 4000 },
      continue: { maxInputTokens: 12000, maxOutputTokens: 12000, maxReasoningTokens: 3000 }
    });
  });

  it("returns immutable budget values for callers", () => {
    const budget = getTokenBudget("expand");
    budget.maxOutputTokens = 1;

    expect(getTokenBudget("expand")).toEqual({
      maxInputTokens: 10000,
      maxOutputTokens: 12000,
      maxReasoningTokens: 3000
    });
  });

  it("expands chat input budget when the selected model has a large context window", () => {
    const budget = getTokenBudget("chat", 1_048_576);

    expect(budget.maxOutputTokens).toBe(12000);
    expect(budget.maxReasoningTokens).toBe(4000);
    expect(budget.maxInputTokens).toBeGreaterThan(700_000);
  });

  it("clamps budgets so small context models do not exceed their window", () => {
    const budget = getTokenBudget("proofread", 8_192);

    expect(budget.maxOutputTokens).toBeLessThanOrEqual(3_276);
    expect(budget.maxReasoningTokens).toBeLessThan(budget.maxOutputTokens);
    expect(budget.maxInputTokens + budget.maxOutputTokens).toBeLessThan(8_192);
  });

  it("keeps enough input room for 4k context models instead of collapsing chat context", () => {
    const budget = getTokenBudget("chat", 4_096);

    expect(budget.maxInputTokens).toBeGreaterThanOrEqual(1_500);
    expect(budget.maxOutputTokens).toBeGreaterThanOrEqual(1_000);
    expect(budget.maxInputTokens + budget.maxOutputTokens).toBeLessThan(4_096);
  });
});
