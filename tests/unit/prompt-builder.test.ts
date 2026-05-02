import { describe, expect, it } from "vitest";
import { buildAiTaskPrompt, parseProofreadResponse } from "../../src/main/ai/prompt-builder";
import type { AiTaskRecord } from "../../src/main/shared/types";

function createTask(taskType: AiTaskRecord["taskType"], patch: Partial<AiTaskRecord> = {}): AiTaskRecord {
  return {
    id: `task_${taskType}`,
    projectId: "project_1",
    chapterId: "chapter_1",
    taskType,
    status: "configured",
    selection: null,
    inputText: "林远在雨声里停下脚步。",
    instruction: "保持克制，不要解释。",
    presetId: null,
    outputText: null,
    error: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    ...patch
  };
}

describe("prompt builder", () => {
  it("builds Chinese novel prompts for all four AI task types", () => {
    for (const taskType of ["polish", "expand", "proofread", "continue"] as const) {
      const prompt = buildAiTaskPrompt(createTask(taskType));
      const joined = prompt.messages.map((message) => message.content).join("\n");

      expect(joined).toContain("中文小说");
      expect(joined).toContain("不改变剧情事实");
      expect(joined).toContain("林远在雨声里停下脚步。");
      expect(joined).toContain("保持克制，不要解释。");
    }
  });

  it("keeps reusable preset instructions separate from one-off task instructions", () => {
    const prompt = buildAiTaskPrompt(createTask("polish"), {
      taskPreset: {
        id: "preset_polish_classic",
        name: "古风润色",
        taskType: "polish",
        instruction: "让语言更古雅，但不要堆砌辞藻。",
        showInSelectionMenu: true
      }
    });
    const joined = prompt.messages.map((message) => message.content).join("\n");

    expect(joined).toContain("任务预设：古风润色");
    expect(joined).toContain("预设要求：让语言更古雅，但不要堆砌辞藻。");
    expect(joined).toContain("本次要求：保持克制，不要解释。");
  });

  it("uses strict structured output only for proofread tasks", () => {
    expect(buildAiTaskPrompt(createTask("polish")).responseFormat).toBeUndefined();
    expect(buildAiTaskPrompt(createTask("expand")).responseFormat).toBeUndefined();
    expect(buildAiTaskPrompt(createTask("continue")).responseFormat).toBeUndefined();

    const proofreadPrompt = buildAiTaskPrompt(createTask("proofread"));
    expect(proofreadPrompt.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "proofread_result",
        strict: true,
        schema: {
          properties: {
            issues: {
              maxItems: 20
            }
          }
        }
      }
    });
  });

  it("parses structured proofread output into all actionable issues without generated replacement text", () => {
    const parsed = parseProofreadResponse(
      JSON.stringify({
        issues: [
          {
            type: "表达不顺",
            quote: "雨声里停下脚步",
            suggestion: "林远听着雨声，停下了脚步。",
            reason: "语序更自然"
          },
          {
            type: "重复表达",
            quote: "轻轻地轻轻推门",
            suggestion: "他轻轻推门。",
            reason: "副词重复"
          }
        ]
      })
    );

    expect(parsed).toEqual({
      generatedText: "",
      changeSummary: "发现 2 个问题",
      proofreadIssues: [
        {
          type: "表达不顺",
          quote: "雨声里停下脚步",
          suggestion: "林远听着雨声，停下了脚步。",
          reason: "语序更自然"
        },
        {
          type: "重复表达",
          quote: "轻轻地轻轻推门",
          suggestion: "他轻轻推门。",
          reason: "副词重复"
        }
      ]
    });
  });

  it("parses clean proofread output as a non-applicable clean result", () => {
    const parsed = parseProofreadResponse(
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

  it("gives every task enough completion budget for high reasoning plus final output", () => {
    expect(buildAiTaskPrompt(createTask("polish")).maxCompletionTokens).toBe(8000);
    expect(buildAiTaskPrompt(createTask("expand")).maxCompletionTokens).toBe(12000);
    expect(buildAiTaskPrompt(createTask("proofread")).maxCompletionTokens).toBe(12000);
    expect(buildAiTaskPrompt(createTask("continue")).maxCompletionTokens).toBe(12000);
  });

  it("rejects selected-text tasks that exceed their input budget instead of silently cropping", () => {
    expect(() => buildAiTaskPrompt(createTask("polish", { inputText: "林".repeat(9000) }))).toThrow("选区太长");
    expect(() => buildAiTaskPrompt(createTask("proofread", { inputText: "林".repeat(13000) }))).toThrow("选区太长");
  });

  it("reserves explicit reasoning tokens inside each task completion budget", () => {
    expect(buildAiTaskPrompt(createTask("polish")).reasoning).toEqual({
      max_tokens: 2000,
      exclude: true
    });
    expect(buildAiTaskPrompt(createTask("expand")).reasoning).toEqual({
      max_tokens: 3000,
      exclude: true
    });
    expect(buildAiTaskPrompt(createTask("proofread")).reasoning).toEqual({
      max_tokens: 4000,
      exclude: true
    });
    expect(buildAiTaskPrompt(createTask("continue")).reasoning).toEqual({
      max_tokens: 3000,
      exclude: true
    });
  });

  it("keeps clean proofread responses short", () => {
    const proofreadPrompt = buildAiTaskPrompt(createTask("proofread"));
    const joined = proofreadPrompt.messages.map((message) => message.content).join("\n");

    expect(joined).toContain('如果没有明确问题，只输出 {"issues":[]}');
    expect(joined).toContain("最多返回 20 个最重要的问题");
  });

  it("rejects malformed proofread JSON instead of healing or falling back", () => {
    expect(() => parseProofreadResponse("不是 JSON")).toThrow("OpenRouter 校对结果不是合法 JSON");
  });
});
