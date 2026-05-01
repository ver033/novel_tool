import { describe, expect, it } from "vitest";
import { buildChatCompletionMessages, OpenRouterChatGenerator } from "../../src/main/ai/openrouter-chat-generator";
import { estimateMessagesTokens } from "../../src/main/ai/token-estimator";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import type { AiChatGenerationInput } from "../../src/main/ai/ai-task-service";

function createInput(patch: Partial<AiChatGenerationInput> = {}): AiChatGenerationInput {
  return {
    requestId: "chat_stream_budget",
    projectId: "project_1",
    sessionId: "chat_1",
    message: "总结本章",
    chapterId: "chapter_1",
    currentChapterTitle: "第一章",
    chapterExcerpt: "本章正文。",
    history: [],
    ...patch
  };
}

describe("OpenRouter chat generator prompt assembly", () => {
  it("uses compacted memory and recent raw history in the chat input budget", () => {
    const oldHugeMessage = "旧历史".repeat(20000);
    const recentMessage = "最近讨论：主角需要更清晰的动机。";
    const messages = buildChatCompletionMessages(
      createInput({
        compactedMemorySummary: "旧历史压缩摘要：作者一直在讨论主角动机。",
        compactedMemoryThroughMessageId: "old_user",
        history: [
          {
            id: "old_user",
            projectId: "project_1",
            sessionId: "chat_1",
            role: "user",
            content: oldHugeMessage,
            action: null,
            createdAt: "2026-04-29T00:00:00.000Z"
          },
          {
            id: "recent_assistant",
            projectId: "project_1",
            sessionId: "chat_1",
            role: "assistant",
            content: recentMessage,
            action: { type: "none" },
            createdAt: "2026-04-29T00:01:00.000Z"
          }
        ]
      })
    );

    const joined = messages.map((message) => message.content).join("\n");
    expect(messages[0].role).toBe("system");
    expect(messages.at(-1)).toMatchObject({ role: "user" });
    expect(joined).toContain("总结本章");
    expect(joined).toContain("旧历史压缩摘要");
    expect(joined).toContain(recentMessage);
    expect(joined).not.toContain(oldHugeMessage);
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(getTokenBudget("chat").maxInputTokens);
  });

  it("throws a clear error when the current chat prompt alone exceeds the input budget", () => {
    expect(() =>
      buildChatCompletionMessages(
        createInput({
          message: "这段怎么改？",
          selectionText: "长选区".repeat(30000)
        })
      )
    ).toThrow("AI 对话上下文太长");
  });

  it("uses resolved agent context instead of stale renderer chapter excerpts", () => {
    const messages = buildChatCompletionMessages(
      createInput({
        currentChapterTitle: "错误标题",
        chapterExcerpt: "renderer 里的过期正文",
        agentContext: {
          scopeLabel: "全部章节",
          contextText: "[第1章 起点]\n真实第一章正文\n\n[第2章 暗潮]\n真实第二章正文",
          sourceChapterIds: ["chapter_1", "chapter_2"],
          mode: "direct"
        }
      } as Partial<AiChatGenerationInput>)
    );

    const joined = messages.map((message) => message.content).join("\n");
    expect(joined).toContain("上下文范围：全部章节");
    expect(joined).toContain("真实第一章正文");
    expect(joined).toContain("真实第二章正文");
    expect(joined).not.toContain("当前章节节选");
    expect(joined).not.toContain("renderer 里的过期正文");
  });

  it("labels mixed agent context as partially summarized context", () => {
    const messages = buildChatCompletionMessages(
      createInput({
        agentContext: {
          scopeLabel: "第1-3章",
          contextText: "第1章原文节选。\n\n第2-3章摘要。",
          sourceChapterIds: ["chapter_1", "chapter_2", "chapter_3"],
          mode: "mixed"
        }
      } as Partial<AiChatGenerationInput>)
    );

    const joined = messages.map((message) => message.content).join("\n");
    expect(joined).toContain("上下文范围：第1-3章");
    expect(joined).toContain("上下文来源：部分原文，部分摘要");
  });

  it("caps internal summary requests to the selected model output budget", async () => {
    const chatBudget = getTokenBudget("chat", 4_096);
    const requests: Array<{ readonly maxCompletionTokens?: number }> = [];
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget,
        contextLength: 4_096,
        modelName: "small-context/model",
        client: {
          streamChatCompletion: async (request: { readonly maxCompletionTokens?: number }) => {
            requests.push(request);
            return {
              content: "摘要内容",
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    await generator.summarizeChapterForContext({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章",
      ordinal: 1,
      plainText: "正文".repeat(80),
      userMessage: "总结本章",
      scopeLabel: "第1章"
    });
    await generator.summarizeContextBatchForContext({
      projectId: "project_1",
      chapters: [
        { chapterId: "chapter_1", ordinal: 1, title: "第一章", plainText: "第一章正文" },
        { chapterId: "chapter_2", ordinal: 2, title: "第二章", plainText: "第二章正文" }
      ],
      userMessage: "总结全部章节",
      scopeLabel: "全部章节"
    });
    await generator.mergeContextSummaries({
      projectId: "project_1",
      summaries: [
        { chapterId: "chapter_1", ordinal: 1, title: "第一章", summary: "第一章摘要" },
        { chapterId: "chapter_2", ordinal: 2, title: "第二章", summary: "第二章摘要" }
      ],
      userMessage: "总结全部章节",
      scopeLabel: "全部章节"
    });
    await generator.summarizeChatHistoryForMemory({
      projectId: "project_1",
      sessionId: "chat_1",
      previousSummary: null,
      messages: [
        {
          id: "msg_1",
          projectId: "project_1",
          sessionId: "chat_1",
          role: "user",
          content: "前面我们讨论了主角动机。",
          action: null,
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ]
    });

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => (request.maxCompletionTokens ?? 0) <= chatBudget.maxOutputTokens)).toBe(true);
  });

  it("uses streaming requests for internal context summaries and memory compaction", async () => {
    const streamedKinds: string[] = [];
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 16_384),
        contextLength: 16_384,
        modelName: "streaming/model",
        client: {
          createChatCompletion: async () => {
            throw new Error("internal summaries must use streaming completions");
          },
          streamChatCompletion: async (request: { readonly messages: readonly { readonly content: string }[] }) => {
            const joined = request.messages.map((message) => message.content).join("\n");
            if (joined.includes("章节批次")) {
              streamedKinds.push("batch");
            } else if (joined.includes("待合并的较早对话")) {
              streamedKinds.push("memory");
            } else if (joined.includes("分段摘要")) {
              streamedKinds.push("chapter-merge");
            } else if (joined.includes("请输出本段对最终问题有用的摘要")) {
              streamedKinds.push("chapter");
            } else if (joined.includes("章节摘要")) {
              streamedKinds.push("summary-merge");
            } else {
              streamedKinds.push("chapter");
            }
            return {
              content: "流式摘要内容",
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    await generator.summarizeChapterForContext({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章",
      ordinal: 1,
      plainText: "正文".repeat(80),
      userMessage: "总结本章",
      scopeLabel: "第1章"
    });
    await generator.summarizeContextBatchForContext({
      projectId: "project_1",
      chapters: [
        { chapterId: "chapter_1", ordinal: 1, title: "第一章", plainText: "第一章正文" },
        { chapterId: "chapter_2", ordinal: 2, title: "第二章", plainText: "第二章正文" }
      ],
      userMessage: "总结全部章节",
      scopeLabel: "全部章节"
    });
    await generator.mergeContextSummaries({
      projectId: "project_1",
      summaries: [
        { chapterId: "chapter_1", ordinal: 1, title: "第一章", summary: "第一章摘要" },
        { chapterId: "chapter_2", ordinal: 2, title: "第二章", summary: "第二章摘要" }
      ],
      userMessage: "总结全部章节",
      scopeLabel: "全部章节"
    });
    await generator.summarizeChatHistoryForMemory({
      projectId: "project_1",
      sessionId: "chat_1",
      previousSummary: null,
      messages: [
        {
          id: "msg_1",
          projectId: "project_1",
          sessionId: "chat_1",
          role: "user",
          content: "前面我们讨论了主角动机。",
          action: null,
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ]
    });

    expect(streamedKinds).toContain("chapter");
    expect(streamedKinds).toContain("batch");
    expect(streamedKinds).toContain("summary-merge");
    expect(streamedKinds).toContain("memory");
  });

  it("recalculates chat memory compaction chunks as the rolling summary grows", async () => {
    const chatBudget = {
      maxInputTokens: 2200,
      maxOutputTokens: 512
    };
    const requestTokenCounts: number[] = [];
    let callCount = 0;
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget,
        contextLength: 4096,
        modelName: "small-context/model",
        client: {
          streamChatCompletion: async (request: { readonly messages: Parameters<typeof estimateMessagesTokens>[0] }) => {
            callCount += 1;
            requestTokenCounts.push(estimateMessagesTokens(request.messages));
            return {
              content: callCount === 1 ? "滚动压缩摘要。".repeat(160) : "最终压缩摘要。",
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    await generator.summarizeChatHistoryForMemory({
      projectId: "project_1",
      sessionId: "chat_1",
      previousSummary: null,
      messages: Array.from({ length: 16 }, (_, index) => ({
        id: `msg_${index}`,
        projectId: "project_1",
        sessionId: "chat_1",
        role: index % 2 === 0 ? "user" : "assistant",
        content: `需要压缩的对话${index}。`.repeat(120),
        action: null,
        createdAt: `2026-05-01T00:00:${String(index).padStart(2, "0")}.000Z`
      }))
    });

    expect(requestTokenCounts.length).toBeGreaterThan(1);
    expect(requestTokenCounts.every((tokens) => tokens <= chatBudget.maxInputTokens)).toBe(true);
  });

  it("recompresses chat memory when the first summary is still too large for the next agent prompt", async () => {
    const chatBudget = {
      maxInputTokens: 2200,
      maxOutputTokens: 512
    };
    let streamCallCount = 0;
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget,
        contextLength: 4096,
        modelName: "small-context/model",
        client: {
          createChatCompletion: async () => {
            throw new Error("memory compaction must use streaming completions");
          },
          streamChatCompletion: async () => {
            streamCallCount += 1;
            return {
              content: streamCallCount === 1 ? "仍然过长的压缩摘要。".repeat(600) : "最终短记忆：用户在整理全部章节和角色关系。",
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    const result = await generator.summarizeChatHistoryForMemory({
      projectId: "project_1",
      sessionId: "chat_1",
      previousSummary: null,
      messages: [
        {
          id: "msg_1",
          projectId: "project_1",
          sessionId: "chat_1",
          role: "assistant",
          content: "超长回答。".repeat(50),
          action: null,
          createdAt: "2026-05-01T00:00:00.000Z"
        }
      ]
    });

    expect(streamCallCount).toBe(2);
    expect(result.summary).toBe("最终短记忆：用户在整理全部章节和角色关系。");
  });
});
