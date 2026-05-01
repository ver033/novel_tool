import { describe, expect, it } from "vitest";
import { buildChatAgentMemoryText, selectChatMemoryCompactionTarget } from "../../src/main/ai/chat-agent-memory";
import { estimateTextTokens } from "../../src/main/ai/token-estimator";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import type { AiChatMessageRecord } from "../../src/main/shared/types";

function message(role: AiChatMessageRecord["role"], content: string, index: number): AiChatMessageRecord {
  return {
    id: `chatmsg_${index}`,
    sessionId: "chat_1",
    projectId: "project_1",
    role,
    content,
    action: null,
    createdAt: `2026-04-30T00:00:${String(index).padStart(2, "0")}.000Z`
  };
}

describe("chat agent memory", () => {
  it("preserves recent user and assistant messages for follow-up intent", () => {
    const memory = buildChatAgentMemoryText({
      history: [
        message("user", "帮我总结现有所有章节的内容", 1),
        message("assistant", "目前全部章节总结如下。", 2),
        message("tool", "已加入草稿纸。", 3)
      ],
      tokenBudget: getTokenBudget("chat")
    });

    expect(memory).toContain("作者：帮我总结现有所有章节的内容");
    expect(memory).toContain("AI：目前全部章节总结如下。");
    expect(memory).not.toContain("已加入草稿纸");
  });

  it("uses compacted memory plus recent raw messages instead of truncating history", () => {
    const smallBudget = {
      maxInputTokens: 2200,
      maxOutputTokens: 512
    };
    const memory = buildChatAgentMemoryText({
      history: Array.from({ length: 20 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `对话内容${index}。`.repeat(index >= 18 ? 20 : 300), index)),
      compactedSummary: "较早对话压缩摘要：用户一直在整理全部章节和角色特征。",
      compactedThroughMessageId: "chatmsg_17",
      tokenBudget: smallBudget
    });

    expect(estimateTextTokens(memory)).toBeLessThanOrEqual(Math.floor(smallBudget.maxInputTokens * 0.75));
    expect(memory).toContain("较早对话压缩摘要");
    expect(memory).toContain("对话内容18");
    expect(memory).toContain("对话内容19");
  });

  it("throws when long memory has not been compacted", () => {
    const smallBudget = {
      maxInputTokens: 2200,
      maxOutputTokens: 512
    };

    expect(() =>
      buildChatAgentMemoryText({
        history: Array.from({ length: 16 }, (_, index) => message(index % 2 === 0 ? "user" : "assistant", `未压缩对话${index}。`.repeat(300), index)),
        tokenBudget: smallBudget
      })
    ).toThrow("AI 对话记忆超过预算");
  });

  it("does not compact a short history just because the model has a large context window", () => {
    const tokenBudget = getTokenBudget("chat", 131_072);
    const history = Array.from({ length: 12 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `长上下文模型里的正常追问${index}。`.repeat(80), index)
    );

    const target = selectChatMemoryCompactionTarget({
      history,
      tokenBudget,
      reservedInputTokens: 6000
    });

    expect(target).toBeNull();
  });

  it("compacts when the projected chat prompt reaches the model-aware trigger threshold", () => {
    const tokenBudget = {
      maxInputTokens: 6000,
      maxOutputTokens: 1024
    };
    const history = Array.from({ length: 18 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `需要压缩的长对话${index}。`.repeat(100), index)
    );

    const target = selectChatMemoryCompactionTarget({
      history,
      tokenBudget,
      reservedInputTokens: 2600
    });

    expect(target?.messagesToCompact.length).toBeGreaterThan(0);
    expect(target?.messagesToCompact.at(-1)?.id).not.toBe(history.at(-1)?.id);
  });

  it("keeps a model-aware recent tail after memory compaction", () => {
    const tokenBudget = {
      maxInputTokens: 20_000,
      maxOutputTokens: 4096
    };
    const history = Array.from({ length: 28 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `最近对话尾部${index}。`.repeat(index >= 22 ? 170 : 260), index)
    );

    const target = selectChatMemoryCompactionTarget({
      history,
      tokenBudget,
      reservedInputTokens: 9000
    });

    expect(target).not.toBeNull();
    expect(target?.messagesToCompact.at(-1)?.id).not.toBe("chatmsg_27");
    expect(target?.messagesToCompact.at(-1)?.id).not.toBe("chatmsg_26");
  });

  it("uses the same formatted memory text for compaction decisions and prompt construction", () => {
    const tokenBudget = {
      maxInputTokens: 2200,
      maxOutputTokens: 512
    };
    const memoryTokenBudget = Math.floor(tokenBudget.maxInputTokens * 0.75);
    const history = [
      message("user", "需要继续压缩的旧问题。".repeat(40), 1),
      message("assistant", "需要继续压缩的旧回答。".repeat(40), 2),
      message("user", "边界追问。", 3),
      message("assistant", "边界回答。", 4)
    ];
    const compactedSummary = "较早对话摘要。".repeat(103);
    const rawRecentText = history.map((item) => `${item.role === "user" ? "作者" : "AI"}：${item.content.trim()}`).join("\n");
    const unformattedMemory = [compactedSummary, rawRecentText].filter(Boolean).join("\n\n");
    const formattedMemory = [`【已压缩的较早对话】\n${compactedSummary}`, `【最近对话原文】\n${rawRecentText}`].join("\n\n");
    expect(estimateTextTokens(unformattedMemory)).toBeLessThanOrEqual(memoryTokenBudget);
    expect(estimateTextTokens(formattedMemory)).toBeGreaterThan(memoryTokenBudget);

    const target = selectChatMemoryCompactionTarget({
      history,
      compactedSummary,
      tokenBudget,
      reservedInputTokens: 0
    });

    expect(target).not.toBeNull();
    expect(target?.messagesToCompact.map((item) => item.id)).toContain("chatmsg_1");
  });

  it("compacts an oversized latest message instead of keeping an impossible raw tail", () => {
    const tokenBudget = {
      maxInputTokens: 2200,
      maxOutputTokens: 512
    };
    const history = [
      message("user", "前一轮问题。", 1),
      message("assistant", "前一轮回答。", 2),
      message("user", "总结全部章节后继续分析角色。".repeat(1200), 3)
    ];

    const target = selectChatMemoryCompactionTarget({
      history,
      tokenBudget,
      reservedInputTokens: 0
    });

    expect(target).not.toBeNull();
    expect(target?.compactedThroughMessageId).toBe("chatmsg_3");
    expect(target?.messagesToCompact.at(-1)?.id).toBe("chatmsg_3");
  });
});
