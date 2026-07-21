import { describe, expect, it } from "vitest";
import { buildChapterReviewPrompt, parseChapterReviewModelResponse, splitChapterTextForReview } from "../../src/main/chapter-review/chapter-review-prompt";

describe("chapter review prompt", () => {
  it("frames AI tone as editorial risk instead of AI authorship detection", () => {
    const prompt = buildChapterReviewPrompt({
      projectName: "斗破测试",
      chapterTitle: "第三十六章 暗潮",
      chapterOrder: 36,
      chunkIndex: 0,
      chunkCount: 1,
      chapterText: "萧炎停下脚步，心中涌起一种前所未有的复杂情绪。",
      nearbyContext: "上一章：主角刚得知密信失踪。",
      maxCompletionTokens: 4000
    });
    const joined = prompt.messages.map((message) => message.content).join("\n");

    expect(joined).toContain("你是中文长篇小说的审稿编辑，不是 AI 文本检测器");
    expect(joined).toContain("不判断作者是否使用过 AI");
    expect(joined).toContain("不输出“AI生成概率”“人类概率”");
    expect(joined).toContain("【章节正文】");
    expect(joined).toContain('"""');
    expect(JSON.stringify(prompt.responseFormat)).toContain("chapter_review_result");
    expect(JSON.stringify(prompt.responseFormat)).toContain("aiToneRisk");
  });

  it("parses structured review results with AI-tone issues and no probability fields", () => {
    const parsed = parseChapterReviewModelResponse(JSON.stringify({
      summary: "本章整体可读，但有一句抽象情绪偏套话。",
      readabilityScore: 4,
      aiToneRisk: "medium",
      issues: [
        {
          code: "ai_tone",
          severity: "medium",
          quote: "心中涌起一种前所未有的复杂情绪",
          locationHint: "第 1 段",
          explanation: "这句用抽象概括替代具体动作和心理触发点，容易显得机械。",
          suggestion: "改成可见动作或更具体的心理触发。",
          suggestedReplacement: "他指尖停在剑柄上，迟迟没有握紧。",
          evidence: [
            {
              source: "target",
              quote: "心中涌起一种前所未有的复杂情绪",
              note: "目标文本中的抽象情绪句"
            }
          ],
          canAutoApply: false,
          needsAuthorJudgment: true
        }
      ]
    }));

    expect(parsed.aiToneRisk).toBe("medium");
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({ code: "ai_tone", needsAuthorJudgment: true });
    expect(JSON.stringify(parsed)).not.toContain("probability");
  });

  it("splits long chapter text without dropping content", () => {
    const paragraphs = Array.from({ length: 80 }, (_, index) => `第${index + 1}段，萧炎沿着石阶向前，夜风卷过长街。`);
    const text = paragraphs.join("\n\n");
    const chunks = splitChapterTextForReview(text, 280);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toContain("第1段");
    expect(chunks.join("\n\n")).toContain("第80段");
    expect(chunks.every((chunk) => chunk.trim().length > 0)).toBe(true);
  });

  it("keeps the review request compact enough for chapter-level latency", () => {
    const prompt = buildChapterReviewPrompt({
      projectName: "斗破测试",
      chapterTitle: "第三十六章 暗潮",
      chapterOrder: 36,
      chunkIndex: 0,
      chunkCount: 1,
      chapterText: "萧炎停下脚步，心中涌起一种前所未有的复杂情绪。",
      nearbyContext: "上一章：主角刚得知密信失踪。",
      maxCompletionTokens: 8000,
      tokenBudget: {
        maxInputTokens: 12000,
        maxOutputTokens: 12000,
        maxReasoningTokens: 4000
      }
    });
    expect(prompt.responseFormat.type).toBe("json_schema");
    if (prompt.responseFormat.type !== "json_schema") {
      throw new Error("chapter review must use json_schema response format");
    }
    const schema = prompt.responseFormat.json_schema.schema as {
      properties: { issues: { maxItems: number } };
    };
    const joined = prompt.messages.map((message) => message.content).join("\n");

    expect(prompt.maxCompletionTokens).toBeLessThanOrEqual(4000);
    expect(prompt.reasoning).toEqual({ max_tokens: 1024, exclude: true });
    expect(schema.properties.issues.maxItems).toBe(30);
    expect(joined).toContain("最多 30 个");
  });
});
