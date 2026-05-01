import { describe, expect, it } from "vitest";
import { buildWritingOperationPrompt, parseWritingOperationResponse } from "../../src/main/ai/writing-operation-prompt";
import { getWritingOperationDefinition } from "../../src/main/ai/writing-operation-registry";
import { loadWritingSkill } from "../../src/main/ai/writing-skill-loader";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import type { WritingContextPlan } from "../../src/main/ai/writing-operation-types";

function contextPlan(): WritingContextPlan {
  return {
    targetText: "萧炎垂下眼，指节慢慢攥紧。",
    supportingContext: [
      {
        kind: "same_chapter_before",
        label: "第3章 选区前文",
        content: "众人的目光落在少年身上。",
        reason: "保持场景压力"
      }
    ],
    mode: "direct",
    estimatedInputTokens: 320,
    maxInputTokens: 8000,
    reason: "选区是唯一修改目标"
  };
}

describe("writing operation prompt", () => {
  it("separates target text from supporting context", () => {
    const prompt = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "更有压迫感。",
      preset: null,
      tokenBudget: getTokenBudget("polish")
    });

    const joined = prompt.messages.map((message) => message.content).join("\n");
    expect(joined).toContain("【目标文本】");
    expect(joined).toContain("萧炎垂下眼，指节慢慢攥紧。");
    expect(joined).toContain("【参考上下文】");
    expect(joined).toContain("众人的目光落在少年身上。");
    expect(joined).toContain("参考上下文不能作为改写目标");
    expect(joined).toContain("更有压迫感。");
  });

  it("uses strict JSON schema only for proofread", () => {
    const proofread = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("proofread"),
      skill: loadWritingSkill("moshu.proofread"),
      contextPlan: { ...contextPlan(), supportingContext: [] },
      userInstruction: "检查明显问题。",
      preset: null,
      tokenBudget: getTokenBudget("proofread")
    });
    const polish = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("polish")
    });

    expect(proofread.responseFormat).toMatchObject({ type: "json_schema" });
    expect(JSON.stringify(proofread.responseFormat)).not.toContain("minItems");
    expect(polish.responseFormat).toBeUndefined();
  });

  it("uses bounded reasoning budgets instead of unbounded effort for writing operations", () => {
    const polish = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("polish")
    });
    const proofread = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("proofread"),
      skill: loadWritingSkill("moshu.proofread"),
      contextPlan: { ...contextPlan(), supportingContext: [] },
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("proofread")
    });

    expect(polish.reasoning).toEqual({ max_tokens: 2000, exclude: true });
    expect(proofread.reasoning).toEqual({ max_tokens: 4000, exclude: true });
  });

  it("parses proofread issues without replacement text", () => {
    const parsed = parseWritingOperationResponse(
      getWritingOperationDefinition("proofread"),
      JSON.stringify({
        issues: [
          {
            type: "重复表达",
            quote: "轻轻地轻轻",
            suggestion: "轻轻",
            reason: "重复"
          }
        ]
      })
    );

    expect(parsed.generatedText).toBe("");
    expect(parsed.changeSummary).toBe("发现 1 个问题");
    expect(parsed.proofreadIssues).toHaveLength(1);
  });

  it("parses empty proofread issues as a clean result", () => {
    const parsed = parseWritingOperationResponse(
      getWritingOperationDefinition("proofread"),
      JSON.stringify({
        issues: []
      })
    );

    expect(parsed).toEqual({
      generatedText: "",
      changeSummary: "无问题",
      proofreadIssues: []
    });
  });

  it("rejects advice-only candidate text for polish", () => {
    expect(() =>
      parseWritingOperationResponse(getWritingOperationDefinition("polish"), "以下是润色建议：\n1. 增强画面感")
    ).toThrow("AI 没有返回可直接使用的候选正文");
  });

  it("keeps candidate text when the model adds a simple draft label", () => {
    const parsed = parseWritingOperationResponse(getWritingOperationDefinition("polish"), "【润色稿】\n萧炎垂下眼，指节一点点攥紧。");

    expect(parsed.generatedText).toBe("萧炎垂下眼，指节一点点攥紧。");
    expect(parsed.proofreadIssues).toBeNull();
  });
});
