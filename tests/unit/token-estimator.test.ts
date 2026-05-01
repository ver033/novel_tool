import { describe, expect, it } from "vitest";
import { estimateMessagesTokens, estimateTextTokens, truncateTextToTokenBudget } from "../../src/main/ai/token-estimator";

describe("AI token estimator", () => {
  it("estimates Chinese text conservatively enough for prompt budgeting", () => {
    expect(estimateTextTokens("林远在雨声里停下脚步。")).toBeGreaterThanOrEqual(12);
  });

  it("estimates mixed English and Chinese text without returning zero", () => {
    expect(estimateTextTokens("Chapter 4: 林远 says hello.")).toBeGreaterThanOrEqual(8);
  });

  it("estimates OpenRouter message arrays with role overhead", () => {
    expect(
      estimateMessagesTokens([
        { role: "system", content: "你是中文小说助手。" },
        { role: "user", content: "总结第四章。" }
      ])
    ).toBeGreaterThan(estimateTextTokens("你是中文小说助手。总结第四章。"));
  });

  it("includes assistant tool call payloads in message token estimates", () => {
    const toolArguments = JSON.stringify({
      scope: "chapter_range",
      from: 1,
      to: 100,
      note: "需要读取并分析的章节范围。".repeat(120)
    });

    expect(
      estimateMessagesTokens([
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_read_large",
              type: "function",
              function: {
                name: "read_chapters",
                arguments: toolArguments
              }
            }
          ]
        }
      ])
    ).toBeGreaterThan(estimateTextTokens(toolArguments));
  });

  it("includes tool definitions when estimating an agent prompt", () => {
    const toolDescription = "读取章节正文，并严格根据工具返回内容回答。".repeat(160);

    expect(
      estimateMessagesTokens(
        [{ role: "user", content: "总结全部章节。" }],
        [
          {
            type: "function",
            function: {
              name: "read_chapters",
              description: toolDescription,
              parameters: {
                type: "object",
                properties: {
                  scope: {
                    type: "string",
                    enum: ["all_chapters"]
                  }
                }
              }
            }
          }
        ]
      )
    ).toBeGreaterThan(estimateTextTokens(toolDescription));
  });

  it("truncates text to a conservative token budget while marking truncation", () => {
    const text = "林远在雨声里停下脚步。".repeat(40);
    const result = truncateTextToTokenBudget(text, 20);

    expect(result.truncated).toBe(true);
    expect(estimateTextTokens(result.text)).toBeLessThanOrEqual(20);
    expect(result.text).toContain("林远");
  });

  it("does not truncate text that fits the budget", () => {
    const text = "林远停步。";
    expect(truncateTextToTokenBudget(text, 100)).toEqual({
      text,
      truncated: false
    });
  });
});
