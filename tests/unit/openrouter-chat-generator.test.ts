import { describe, expect, it } from "vitest";
import {
  buildChapterChunkIndexSummaryMessages,
  buildChapterChunkMergeSummaryMessages,
  buildChapterIndexSummaryMessages,
  buildContinuityCheckMessages
} from "../../src/main/ai/summary-prompts";
import { buildChatCompletionMessages, OpenRouterChatGenerator } from "../../src/main/ai/openrouter-chat-generator";
import { estimateMessagesTokens } from "../../src/main/ai/token-estimator";
import { getTokenBudget } from "../../src/main/ai/token-budget";
import type { AiChatGenerationInput } from "../../src/main/ai/ai-task-service";
import type { ChapterAiSummaryPayload, ContinuityCheckResult } from "../../src/main/shared/summary-index";
import { chapterChunkIndexPayload, chapterIndexPayloadV2, chapterIndexPayloadV3Lite } from "../helpers/summary-index-fixtures";

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

describe("OpenRouter persistent summary index generation", () => {
  const chapterSummary: ChapterAiSummaryPayload = chapterIndexPayloadV3Lite({
    title: "第一章 回乡",
    oneLine: "林远回到故乡。",
    synopsis: "林远在风雨中回到故乡，旧日关系重新浮出水面。",
    detail: "林远在风雨中回到故乡，旧日关系重新浮出水面。旧信和旧宅共同构成本章需要后续承接的核心线索，人物状态、关系悬念和调查动机都被建立。"
  });

  it("builds long-term chapter index prompts instead of request-time user-question prompts", () => {
    const messages = buildChapterIndexSummaryMessages({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      plainText: "林远回到了故乡。"
    });
    const joined = messages.map((message) => message.content).join("\n");

    expect(joined).toContain("长期可复用的章节事实索引");
    expect(joined).toContain("人物认知边界");
    expect(joined).toContain("可核对事实");
    expect(joined).toContain("不可丢失信息");
    expect(joined).toContain('"缓存版本": "三-Lite"');
    expect(joined).toContain("“二-Lite”只允许用于章节片段缓存");
    expect(joined).toContain("场景推进最多 5 项");
    expect(joined).toContain("8000 字章节");
    expect(joined).not.toContain("空间与行动逻辑");
    expect(joined).not.toContain("限制与否定事实");
    expect(joined).not.toContain("适合回答的问题");
    expect(joined).toContain("输出 JSON");
    expect(joined).toContain("章节标题：第一章 回乡");
    expect(joined).not.toContain("oneLine");
    expect(joined).not.toContain("用户最终问题");
  });

  it("streams and parses persistent chapter summary JSON", async () => {
    const requests: Array<{ readonly messages: readonly { readonly content: string }[]; readonly maxCompletionTokens?: number; readonly temperature?: number }> = [];
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 16_384),
        contextLength: 16_384,
        modelName: "summary/model",
        client: {
          createChatCompletion: async () => {
            throw new Error("persistent summary index generation must use streaming completions");
          },
          streamChatCompletion: async (request: { readonly messages: readonly { readonly content: string }[]; readonly maxCompletionTokens?: number; readonly temperature?: number }) => {
            requests.push(request);
            return {
              content: JSON.stringify(chapterSummary),
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    const result = await generator.summarizeChapterForIndex({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      plainText: "林远回到了故乡。"
    });

    expect(result).toEqual(chapterSummary);
    expect(requests).toHaveLength(1);
    expect(requests[0].temperature).toBe(0.2);
    expect(requests[0].messages.map((message) => message.content).join("\n")).toContain("长期可复用的章节事实索引");
  });

  it("caps persistent summary index output below the general chat output ceiling", async () => {
    const requests: Array<{ readonly maxCompletionTokens?: number }> = [];
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 131_072),
        contextLength: 131_072,
        modelName: "large-context/model",
        client: {
          streamChatCompletion: async (request: { readonly maxCompletionTokens?: number }) => {
            requests.push(request);
            return {
              content: JSON.stringify(chapterSummary),
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    await generator.summarizeChapterForIndex({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      plainText: "林远回到了故乡。"
    });

    expect(requests[0].maxCompletionTokens).toBeLessThanOrEqual(12_000);
  });

  it("rejects irrecoverable persistent chapter summary JSON instead of accepting empty index data", async () => {
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 16_384),
        contextLength: 16_384,
        modelName: "summary/model",
        client: {
          streamChatCompletion: async () => ({
            content: JSON.stringify({ 章节信息: { 缓存版本: "三-Lite" } }),
            reasoning: "",
            truncated: false,
            toolCalls: []
          })
        }
      })
    });

    await expect(
      generator.summarizeChapterForIndex({
        projectId: "project_1",
        chapterId: "chapter_1",
        title: "第一章 回乡",
        ordinal: 1,
        plainText: "林远回到了故乡。"
      })
    ).rejects.toThrow("模型返回的 JSON 结构不符合章节缓存模板");
  });

  it("builds chunk and merge prompts with strict current-fragment boundaries", () => {
    const chunkMessages = buildChapterChunkIndexSummaryMessages({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      chunkIndex: 0,
      chunkCount: 2,
      textStart: 0,
      textEnd: 100,
      plainText: "林远回到故乡。"
    });
    const mergeMessages = buildChapterChunkMergeSummaryMessages({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      chunks: [
        {
          chunkIndex: 0,
          textStart: 0,
          textEnd: 100,
          summaryShort: "林远回乡。",
          structured: chapterChunkIndexPayload({ chunkIndex: 0, chunkCount: 2 })
        },
        {
          chunkIndex: 1,
          textStart: 90,
          textEnd: 200,
          summaryShort: "旧信出现。",
          structured: chapterChunkIndexPayload({ chunkIndex: 1, chunkCount: 2, summary: "旧信成为新线索。" })
        }
      ]
    });
    const chunkPrompt = chunkMessages.map((message) => message.content).join("\n");
    const mergePrompt = mergeMessages.map((message) => message.content).join("\n");

    expect(chunkPrompt).toContain("只能记录当前片段中出现的信息");
    expect(chunkPrompt).toContain("不得根据其他片段、常识或猜测补全");
    expect(mergePrompt).toContain("不得遗漏片段缓存中明确出现的重要内容");
    expect(chunkPrompt).toContain('"缓存版本": "二-Lite"');
    expect(mergePrompt).toContain('"缓存版本": "三-Lite"');
    expect(mergePrompt).toContain("不得沿用片段缓存的“二-Lite”");
    expect(chunkPrompt).not.toContain("oneLine");
    expect(chunkPrompt).not.toContain("synopsis");
    expect(mergePrompt).not.toContain("oneLine");
    expect(mergePrompt).not.toContain("synopsis");
  });

  it("streams and parses persistent chapter chunk JSON", async () => {
    const requests: Array<{ readonly messages: readonly { readonly content: string }[]; readonly responseFormat?: { readonly type: string } }> = [];
    const chunkPayload = chapterChunkIndexPayload({ chunkIndex: 0, chunkCount: 2 });
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 16_384),
        contextLength: 16_384,
        modelName: "summary/model",
        client: {
          streamChatCompletion: async (request: { readonly messages: readonly { readonly content: string }[]; readonly responseFormat?: { readonly type: string } }) => {
            requests.push(request);
            return {
              content: JSON.stringify(chunkPayload),
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    const result = await generator.summarizeChapterChunkForIndex({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      chunkIndex: 0,
      chunkCount: 2,
      textStart: 0,
      textEnd: 100,
      plainText: "林远回到了故乡。"
    });

    expect(result).toEqual(chunkPayload);
    expect(requests).toHaveLength(1);
    expect(requests[0].responseFormat).toEqual({ type: "json_object" });
  });

  it("streams and parses merged chapter chunk JSON as a canonical chapter index", async () => {
    const requests: Array<{ readonly messages: readonly { readonly content: string }[]; readonly responseFormat?: { readonly type: string } }> = [];
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 16_384),
        contextLength: 16_384,
        modelName: "summary/model",
        client: {
          streamChatCompletion: async (request: { readonly messages: readonly { readonly content: string }[]; readonly responseFormat?: { readonly type: string } }) => {
            requests.push(request);
            return {
              content: JSON.stringify(chapterSummary),
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    const result = await generator.mergeChapterChunksForIndex({
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "第一章 回乡",
      ordinal: 1,
      chunks: [
        {
          chunkIndex: 0,
          textStart: 0,
          textEnd: 100,
          summaryShort: "林远回乡。",
          structured: chapterChunkIndexPayload({ chunkIndex: 0, chunkCount: 2 })
        },
        {
          chunkIndex: 1,
          textStart: 90,
          textEnd: 200,
          summaryShort: "旧信出现。",
          structured: chapterChunkIndexPayload({ chunkIndex: 1, chunkCount: 2, summary: "旧信成为新线索。" })
        }
      ]
    });

    expect(result).toEqual(chapterSummary);
    expect(requests).toHaveLength(1);
    expect(requests[0].responseFormat).toEqual({ type: "json_object" });
  });

  it("builds continuity check prompts from chapter fact indexes without raw chapter text", () => {
    const messages = buildContinuityCheckMessages({
      question: "第3章和第20章人物认知有没有冲突",
      chapters: [
        {
          chapterId: "chapter_3",
          title: "第3章 客人",
          ordinal: 3,
          summaryShort: "第3章短摘要。",
          summaryLong: "第3章长摘要。",
          structured: chapterIndexPayloadV2({
            oneLine: "第3章短摘要。",
            synopsis: "第3章长摘要。"
          })
        },
        {
          chapterId: "chapter_20",
          title: "第20章 旧信",
          ordinal: 20,
          summaryShort: "第20章短摘要。",
          summaryLong: "第20章长摘要。",
          structured: chapterIndexPayloadV2({
            oneLine: "第20章短摘要。",
            synopsis: "第20章长摘要。"
          })
        }
      ]
    });
    const prompt = messages.map((message) => message.content).join("\n");

    expect(prompt).toContain("跨章节连续性检查助手");
    expect(prompt).toContain("不得把疑似伏笔、误导线索、角色撒谎、不可靠叙述直接判为错误");
    expect(prompt).toContain("结构化索引");
    expect(prompt).toContain("第3章短摘要。");
    expect(prompt).not.toContain("章节正文");
  });

  it("streams and parses continuity check JSON", async () => {
    const requests: Array<{ readonly messages: readonly { readonly content: string }[]; readonly responseFormat?: { readonly type: string } }> = [];
    const continuityResult: ContinuityCheckResult = {
      结论: "无明显冲突",
      问题列表: [],
      需要回读的章节: [],
      给作者的简短说明: "根据当前章节缓存，未发现明显连续性冲突。"
    };
    const generator = new OpenRouterChatGenerator({} as never);
    Object.assign(generator as unknown as { createClient: () => Promise<unknown> }, {
      createClient: async () => ({
        chatBudget: getTokenBudget("chat", 16_384),
        contextLength: 16_384,
        modelName: "summary/model",
        client: {
          streamChatCompletion: async (request: { readonly messages: readonly { readonly content: string }[]; readonly responseFormat?: { readonly type: string } }) => {
            requests.push(request);
            return {
              content: JSON.stringify(continuityResult),
              reasoning: "",
              truncated: false,
              toolCalls: []
            };
          }
        }
      })
    });

    const result = await generator.checkContinuity({
      question: "检查前后是否矛盾",
      chapters: [
        {
          chapterId: "chapter_1",
          title: "第1章 起点",
          ordinal: 1,
          summaryShort: "第1章短摘要。",
          summaryLong: "第1章长摘要。",
          structured: chapterIndexPayloadV2({
            oneLine: "第1章短摘要。",
            synopsis: "第1章长摘要。"
          })
        }
      ]
    });

    expect(result).toEqual(continuityResult);
    expect(requests).toHaveLength(1);
    expect(requests[0].responseFormat).toEqual({ type: "json_object" });
  });
});
