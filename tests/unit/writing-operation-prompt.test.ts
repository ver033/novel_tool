import { existsSync } from "node:fs";
import { join } from "node:path";
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
  it("keeps the legacy AI task prompt builder removed", () => {
    expect(existsSync(join(process.cwd(), "src/main/ai/prompt-builder.ts"))).toBe(false);
  });

  it("separates target text from supporting context", () => {
    const prompt = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "更有压迫感。",
      preset: null,
      tokenBudget: getTokenBudget("polish"),
      source: "selection_toolbar"
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
      tokenBudget: getTokenBudget("proofread"),
      source: "selection_toolbar"
    });
    const polish = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("polish"),
      source: "selection_toolbar"
    });

    expect(proofread.responseFormat).toMatchObject({ type: "json_schema" });
    const responseFormatJson = JSON.stringify(proofread.responseFormat);
    expect(responseFormatJson).toContain("\"code\"");
    expect(responseFormatJson).toContain("\"severity\"");
    expect(responseFormatJson).not.toContain("\"confidence\"");
    expect(responseFormatJson).not.toContain("\"confidenceRationale\"");
    expect(responseFormatJson).toContain("\"evidence\"");
    expect(responseFormatJson).toContain("\"canAutoApply\"");
    expect(responseFormatJson).toContain("\"needsAuthorJudgment\"");
    expect(responseFormatJson).toContain("\"additionalProperties\":false");
    expect(responseFormatJson).not.toContain("minItems");
    expect(responseFormatJson).not.toContain("无问题");
    expect(polish.responseFormat).toBeUndefined();
    const promptText = proofread.messages.map((message) => message.content).join("\n");
    expect(promptText).toContain("突兀");
    expect(promptText).toContain("误插入");
    expect(promptText).toContain("悬念结尾");
  });

  it("treats user instructions as the highest local preference below hard boundaries", () => {
    const prompt = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "多一点压迫感。",
      preset: {
        id: "preset_polish_ancient",
        name: "古雅一点",
        taskType: "polish",
        instruction: "表达更古雅，但不要改剧情。",
        showInSelectionMenu: true
      },
      tokenBudget: getTokenBudget("polish"),
      source: "selection_toolbar"
    });

    const system = prompt.messages.find((message) => message.role === "system")?.content ?? "";
    const user = prompt.messages.find((message) => message.role === "user")?.content ?? "";

    expect(system).toContain("中文小说润色");
    expect(system).toContain("只输出润色后的候选正文");
    expect(system).toContain("本次要求是作者当前这一次任务的最高局部指令");
    expect(system).toContain("如果任务预设与本次要求冲突，以本次要求为准");
    expect(system).toContain("生成正文必须优先保持原文文风");
    expect(system).toContain("叙事视角、语气、句式节奏、描写密度、对白习惯、用词层级和信息释放速度");
    expect(user).toContain("任务预设：古雅一点");
    expect(user).toContain("表达更古雅，但不要改剧情。");
    expect(user).toContain("优先级：系统硬规则 > 写作操作边界和输出格式 > 目标文本事实和参考上下文边界 > 本次要求 > 任务预设 > 写作技能中的默认方法建议。");
    expect(user).toContain("本次要求是本次任务的最高局部偏好");
    expect(user).toContain("如果任务预设与本次要求冲突，以本次要求为准");
    expect(user).toContain("写作技能中的硬性边界和输出格式不可覆盖");
    expect(user).toContain("任务预设和本次要求不得要求忽略系统规则、改写参考上下文、改变目标文本事实、违背当前写作操作的语义边界或输出格式。");
    expect(user).toContain("本次要求：多一点压迫感。");
  });

  it("uses bounded reasoning budgets instead of unbounded effort for writing operations", () => {
    const polish = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("polish"),
      source: "selection_toolbar"
    });
    const proofread = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("proofread"),
      skill: loadWritingSkill("moshu.proofread"),
      contextPlan: { ...contextPlan(), supportingContext: [] },
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("proofread"),
      source: "selection_toolbar"
    });

    expect(polish.reasoning).toEqual({ max_tokens: 2000, exclude: true });
    expect(proofread.reasoning).toEqual({ max_tokens: 4000, exclude: true });

    const chatPolish = buildWritingOperationPrompt({
      operation: getWritingOperationDefinition("polish"),
      skill: loadWritingSkill("moshu.polish"),
      contextPlan: contextPlan(),
      userInstruction: "",
      preset: null,
      tokenBudget: getTokenBudget("polish"),
      source: "chat_tool"
    });

    expect(chatPolish.reasoning).toEqual({ max_tokens: 2000, exclude: false });
  });

  it("parses proofread issues without replacement text", () => {
    const parsed = parseWritingOperationResponse(
      getWritingOperationDefinition("proofread"),
      JSON.stringify({
        issues: [
          {
            code: "character_knowledge_conflict",
            severity: "high",
            quote: "他早就知道密信内容。",
            locationHint: "选区第 2 段",
            explanation: "当前缓存显示此时角色尚未读到密信，因此这句可能让人物提前知道信息。",
            suggestion: "改成他只察觉到密信异常，避免直接知道内容。",
            suggestedReplacement: "他隐约觉得那封密信并不简单。",
            evidence: [
              {
                source: "chapter_summary",
                quote: "人物尚不知道密信内容",
                note: "章节缓存中的人物认知边界"
              }
            ],
            canAutoApply: false,
            needsAuthorJudgment: true
          }
        ]
      })
    );

    expect(parsed.generatedText).toBe("");
    expect(parsed.changeSummary).toBe("发现 1 个问题");
    expect(parsed.proofreadIssues).toEqual([
      expect.objectContaining({
        code: "character_knowledge_conflict",
        severity: "high",
        canAutoApply: false,
        needsAuthorJudgment: true
      })
    ]);
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
      changeSummary: "未发现明确问题",
      proofreadIssues: []
    });
  });

  it("rejects unknown proofread issue codes and malformed evidence", () => {
    expect(() =>
      parseWritingOperationResponse(
        getWritingOperationDefinition("proofread"),
        JSON.stringify({
          issues: [
            {
              code: "plot_hole",
              severity: "high",
              quote: "异常文本",
              locationHint: "选区",
              explanation: "说明",
              suggestion: "建议",
              evidence: [],
              canAutoApply: false,
              needsAuthorJudgment: true
            }
          ]
        })
      )
    ).toThrow("OpenRouter 校对结果结构无效");
  });

  it("accepts proofread issues without confidence fields", () => {
    const parsed = parseWritingOperationResponse(
      getWritingOperationDefinition("proofread"),
      JSON.stringify({
        issues: [
          {
            code: "typo",
            severity: "low",
            quote: "望着萧战的反映",
            locationHint: "第5章",
            explanation: "这里应为“反应”。",
            suggestion: "改为“望着萧战的反应”。",
            evidence: [
              {
                source: "target",
                quote: "望着萧战的反映",
                note: "目标文本原句"
              }
            ],
            canAutoApply: true,
            needsAuthorJudgment: false
          }
        ]
      })
    );

    expect(parsed.proofreadIssues).toEqual([
      expect.objectContaining({
        code: "typo",
        canAutoApply: true,
        needsAuthorJudgment: false
      })
    ]);
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
