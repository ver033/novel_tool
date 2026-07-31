import type { Model } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiNovelAgentRuntime } from "../../src/main/ai/agent-runtime/pi-novel-agent-runtime";
import type { NovelAgentRunInput } from "../../src/main/ai/agent-runtime/novel-agent-runtime";

const runtimeConfig = {
  providerType: "openrouter",
  apiKey: "test-key",
  baseUrl: "https://openrouter.ai/api/v1",
  modelName: "test/model",
  contextLength: 32_000,
  supportsTools: true
} as const;

function createInput(overrides: Partial<NovelAgentRunInput> = {}): NovelAgentRunInput {
  return {
    requestId: "request_1",
    projectId: "project_1",
    sessionId: "session_1",
    message: "请概括当前项目",
    contentLanguage: "zh-CN",
    history: [],
    chapterDirectory: [],
    tools: [],
    executeTool: async () => ({ content: "{}", action: null }),
    ...overrides
  };
}

function createRuntime(responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0]) {
  const faux = createFauxCore({});
  faux.setResponses(responses);
  const settingsService = {
    getOpenRouterConfigWithModelMetadata: vi.fn(async () => runtimeConfig)
  };
  const runtime = new PiNovelAgentRuntime({
    settingsService,
    now: () => Date.parse("2026-07-21T00:00:00.000Z"),
    streamFn: (model, context, options) => faux.streamSimple(model as Model<string>, context, options)
  });
  return { faux, runtime, settingsService };
}

describe("PiNovelAgentRuntime", () => {
  it("uses the fetch installed by the main process for its production OpenAI-compatible stream", async () => {
    const originalFetch = globalThis.fetch;
    const installedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response([
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"test/model","choices":[{"index":0,"delta":{"role":"assistant","content":"共享网络已生效。"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_test","object":"chat.completion.chunk","created":0,"model":"test/model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));
    globalThis.fetch = installedFetch as typeof globalThis.fetch;

    try {
      const runtime = new PiNovelAgentRuntime({
        settingsService: {
          getOpenRouterConfigWithModelMetadata: vi.fn(async () => runtimeConfig)
        }
      });

      await expect(runtime.run(createInput(), {})).resolves.toMatchObject({
        content: "共享网络已生效。"
      });
      expect(installedFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses DeepSeek V4 request semantics for Pi Agent runs", async () => {
    const originalFetch = globalThis.fetch;
    const installedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response([
      'data: {"id":"chatcmpl_deepseek","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"检查上下文"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_deepseek","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"已完成。"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_deepseek","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));
    globalThis.fetch = installedFetch as typeof globalThis.fetch;

    try {
      const runtime = new PiNovelAgentRuntime({
        settingsService: {
          getOpenRouterConfigWithModelMetadata: vi.fn(async () => ({
            providerType: "deepseek" as const,
            apiKey: "deepseek-secret",
            baseUrl: "https://api.deepseek.com",
            modelName: "deepseek-v4-flash",
            contextLength: 1_000_000,
            supportsTools: true
          }))
        }
      });

      await expect(runtime.run(createInput(), {})).resolves.toMatchObject({
        content: "已完成。"
      });
      expect(installedFetch).toHaveBeenCalledTimes(1);
      const requestInit = installedFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(requestInit).toBeDefined();
      const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "deepseek-v4-flash",
        max_tokens: expect.any(Number),
        thinking: { type: "enabled" },
        reasoning_effort: "high"
      });
      expect(body).not.toHaveProperty("parallel_tool_calls");
      expect(new Headers(requestInit?.headers).has("X-OpenRouter-Title")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses Tencent Cloud TokenHub DeepSeek semantics for Pi Agent runs with tools", async () => {
    const originalFetch = globalThis.fetch;
    const installedFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response([
      'data: {"id":"chatcmpl_tokenhub","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"检查上下文"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_tokenhub","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"已完成。"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_tokenhub","object":"chat.completion.chunk","created":0,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));
    globalThis.fetch = installedFetch as typeof globalThis.fetch;

    try {
      const runtime = new PiNovelAgentRuntime({
        settingsService: {
          getOpenRouterConfigWithModelMetadata: vi.fn(async () => ({
            providerType: "tencent-tokenhub" as const,
            apiKey: "tencent-tokenhub-secret",
            baseUrl: "https://tokenhub.tencentmaas.com/v1",
            modelName: "deepseek-v4-flash",
            contextLength: 1_000_000,
            supportsTools: true
          }))
        }
      });

      await expect(runtime.run(createInput({
        tools: [{
          name: "read_chapter",
          description: "读取章节",
          parameters: {
            type: "object",
            properties: {
              chapterId: { type: "string" }
            },
            required: ["chapterId"]
          }
        }]
      }), {})).resolves.toMatchObject({
        content: "已完成。"
      });
      expect(installedFetch).toHaveBeenCalledTimes(1);
      expect(String(installedFetch.mock.calls[0]?.[0])).toBe("https://tokenhub.tencentmaas.com/v1/chat/completions");
      const requestInit = installedFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "deepseek-v4-flash",
        max_tokens: expect.any(Number),
        thinking: {
          type: "enabled",
          reasoning_effort: "high"
        },
        tools: expect.arrayContaining([expect.objectContaining({
          type: "function",
          function: expect.objectContaining({ name: "read_chapter" })
        })])
      });
      expect(body).not.toHaveProperty("reasoning");
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("max_completion_tokens");
      expect(body).not.toHaveProperty("provider");
      expect(body).not.toHaveProperty("parallel_tool_calls");
      const headers = new Headers(requestInit?.headers);
      expect(headers.get("Authorization")).toBe("Bearer tencent-tokenhub-secret");
      expect(headers.has("X-OpenRouter-Title")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("runs a direct answer through Pi and forwards the final text", async () => {
    const { runtime, settingsService } = createRuntime([fauxAssistantMessage("可以从人物动机开始梳理。")]);
    const onChunk = vi.fn();

    await expect(runtime.run(createInput(), { onChunk })).resolves.toMatchObject({
      role: "assistant",
      content: "可以从人物动机开始梳理。",
      createdAt: "2026-07-21T00:00:00.000Z",
      activities: []
    });
    expect(onChunk).toHaveBeenCalledWith({ requestId: "request_1", content: "可以从人物动机开始梳理。" });
    expect(settingsService.getOpenRouterConfigWithModelMetadata).toHaveBeenCalledWith(undefined, { requireTools: true });
  });

  it("executes tools sequentially inside Pi and continues with their results", async () => {
    const executeTool = vi.fn(async () => ({
      content: JSON.stringify({ chapters: [{ ordinal: 1, title: "第一章" }] }),
      action: null
    }));
    const { runtime, faux } = createRuntime([
      fauxAssistantMessage(fauxToolCall("list_chapters", {}, { id: "tool_1" }), { stopReason: "toolUse" }),
      (context) => {
        expect(context.messages.some((message) => message.role === "toolResult" && message.toolName === "list_chapters")).toBe(true);
        return fauxAssistantMessage("项目目前有一章。");
      }
    ]);

    const onActivity = vi.fn();
    const result = await runtime.run(createInput({
      tools: [{ name: "list_chapters", description: "列出章节", parameters: { type: "object", properties: {} } }],
      executeTool
    }), { onActivity });
    expect(result).toMatchObject({ content: "项目目前有一章。" });
    expect(result.activities).toEqual([
      expect.objectContaining({ kind: "tool", toolName: "list_chapters", status: "complete", title: "查看章节目录" })
    ]);
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request_1",
      activity: expect.objectContaining({ kind: "tool", toolName: "list_chapters" })
    }));
    expect(executeTool).toHaveBeenCalledWith({ id: "tool_1", name: "list_chapters", argumentsJson: "{}" });
    expect(faux.state.callCount).toBe(2);
  });

  it("lets Pi create visible tasks only when the model chooses the task tools", async () => {
    const executeTool = vi.fn(async () => ({ content: JSON.stringify({ chapters: [] }), action: null }));
    const { runtime, faux } = createRuntime([
      fauxAssistantMessage(fauxToolCall("task_create", {
        subject: "整理人物动机",
        description: "读取相关章节并给出结论",
        activeForm: "正在整理人物动机"
      }, { id: "task_create_1" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("task_update", {
        taskId: "1",
        status: "in_progress"
      }, { id: "task_update_1" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("list_chapters", {}, { id: "tool_list" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("task_update", {
        taskId: "1",
        status: "completed"
      }, { id: "task_update_2" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("人物动机已经整理完成。")
    ]);

    const result = await runtime.run(createInput({
      message: "读取相关章节并整理主要人物的动机变化",
      tools: [{ name: "list_chapters", description: "列出章节", parameters: { type: "object", properties: {} } }],
      executeTool
    }), {});

    expect(result.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "task",
        taskId: "1",
        title: "整理人物动机",
        activeForm: "正在整理人物动机",
        status: "complete"
      }),
      expect.objectContaining({ kind: "tool", toolName: "list_chapters", status: "complete" })
    ]));
    expect(result.activities?.filter((activity) => activity.kind === "tool").map((activity) => activity.toolName)).toEqual(["list_chapters"]);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(faux.state.callCount).toBe(5);
  });

  it("preserves substantive answer text emitted alongside a task update", async () => {
    const report = "第1章到第3章的完整分析：时间线清晰，人物动机从自我怀疑转向主动求变，并需注意跨章时间衔接。";
    const { runtime } = createRuntime([
      fauxAssistantMessage(fauxToolCall("task_create", {
        subject: "分析前三章",
        activeForm: "正在分析前三章"
      }, { id: "task_create_report" }), { stopReason: "toolUse" }),
      fauxAssistantMessage([
        fauxText(report),
        fauxToolCall("task_update", { taskId: "1", status: "completed" }, { id: "task_complete_report" })
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage("以上分析已经完成。")
    ]);
    const onChunk = vi.fn();

    const result = await runtime.run(createInput({ message: "分析第一章到第三章并给出结论" }), { onChunk });

    expect(result.content).toContain(report);
    expect(result.content).toContain("以上分析已经完成。");
    expect(onChunk).toHaveBeenCalledWith({ requestId: "request_1", content: report });
    expect(result.activities).toEqual([
      expect.objectContaining({ kind: "task", title: "分析前三章", status: "complete" })
    ]);
  });

  it("leaves tool selection to Pi instead of forcing writing operations", () => {
    const source = readFileSync(join(process.cwd(), "src/main/ai/agent-runtime/pi-novel-agent-runtime.ts"), "utf8");
    expect(source).not.toContain("tool_choice");
    expect(source).not.toContain("shouldForceWritingOperationTool");
  });

  it("terminates on an authoritative writing candidate without asking the model to restate it", async () => {
    const { runtime, faux } = createRuntime([
      fauxAssistantMessage(
        fauxToolCall("run_writing_operation", {
          operation: "polish",
          target: { kind: "inline_text", text: "雨落在长街上。" }
        }, { id: "tool_write" }),
        { stopReason: "toolUse" }
      )
    ]);
    const onChunk = vi.fn();
    const result = await runtime.run(createInput({
      message: "请润色：雨落在长街上。",
      tools: [{
        name: "run_writing_operation",
        description: "润色",
        parameters: {
          type: "object",
          properties: {
            operation: { type: "string" },
            target: { type: "object", properties: { kind: { type: "string" }, text: { type: "string" } }, required: ["kind"] }
          },
          required: ["operation", "target"]
        }
      }],
      executeTool: async () => ({
        content: JSON.stringify({
          operation: "polish",
          outputKind: "candidate_text",
          generatedText: "细雨无声地落在长街上。",
          streamedPresentation: false
        }),
        action: null
      })
    }), { onChunk });

    expect(result.content).toBe("【润色稿】\n细雨无声地落在长街上。");
    expect(onChunk).toHaveBeenCalledWith({ requestId: "request_1", content: result.content });
    expect(faux.state.callCount).toBe(1);
  });

  it("uses Japanese policy text and Japanese tool descriptions for Japanese projects", async () => {
    const { runtime } = createRuntime([
      (context) => {
        expect(context.systemPrompt).toContain("日本語小説執筆エージェント");
        expect(context.systemPrompt).toContain("作品本文の言語は日本語");
        expect(context.systemPrompt).toContain("作業項目を必ず可視化");
        expect(context.tools?.[0]?.description).toContain("章一覧");
        expect(context.tools?.find((tool) => tool.name === "task_create")?.description).toContain("直接回答");
        const prompt = context.messages.find((message) => message.role === "user");
        expect(prompt?.content).toContain("ユーザーの依頼");
        return fauxAssistantMessage("第一章の出来事を要約します。");
      }
    ]);

    await expect(runtime.run(createInput({
      contentLanguage: "ja-JP",
      message: "第一章を要約してください",
      tools: [{ name: "list_chapters", description: "列出章节", parameters: { type: "object", properties: {} } }]
    }), {})).resolves.toMatchObject({ content: "第一章の出来事を要約します。" });
  });

  it("answers a Japanese question in Japanese even when the project prose language is Chinese", async () => {
    const { runtime } = createRuntime([
      (context) => {
        expect(context.systemPrompt).toContain("作者への説明と最終回答は日本語");
        expect(context.systemPrompt).toContain("作品本文の言語は中国語");
        expect(context.tools?.[0]?.description).toContain("章一覧");
        return fauxAssistantMessage("第一章の出来事を要約します。");
      }
    ]);

    await expect(runtime.run(createInput({
      contentLanguage: "zh-CN",
      message: "第一章を日本語で要約してください",
      tools: [{ name: "list_chapters", description: "列出章节", parameters: { type: "object", properties: {} } }]
    }), {})).resolves.toMatchObject({ content: "第一章の出来事を要約します。" });
  });

  it("asks Pi to rewrite a Chinese-first answer and never streams the rejected text", async () => {
    const rejected = "下面是第一章的总结，主要讲述了人物的成长。";
    const { runtime, faux } = createRuntime([
      fauxAssistantMessage(rejected),
      (context) => {
        const correction = [...context.messages].reverse().find((message) => message.role === "user");
        expect(correction?.content).toContain("自然な日本語だけで書き直してください");
        return fauxAssistantMessage("第一章では、主人公が困難を通じて成長します。");
      }
    ]);
    const onChunk = vi.fn();

    await expect(runtime.run(createInput({
      contentLanguage: "zh-CN",
      message: "第一章を日本語で要約してください"
    }), { onChunk })).resolves.toMatchObject({
      content: "第一章では、主人公が困難を通じて成長します。"
    });
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith({
      requestId: "request_1",
      content: "第一章では、主人公が困難を通じて成長します。"
    });
    expect(onChunk).not.toHaveBeenCalledWith(expect.objectContaining({ content: rejected }));
    expect(faux.state.callCount).toBe(2);
  });

  it("returns a Japanese safety message if the corrected answer is still Chinese-first", async () => {
    const rejected = "下面是第一章的总结，主要讲述了人物的成长。";
    const { runtime } = createRuntime([
      fauxAssistantMessage(rejected),
      fauxAssistantMessage(rejected)
    ]);
    const onChunk = vi.fn();

    const result = await runtime.run(createInput({
      contentLanguage: "zh-CN",
      message: "第一章を日本語で要約してください"
    }), { onChunk });

    expect(result.content).toContain("日本語での回答生成に失敗しました");
    expect(result.content).not.toContain(rejected);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({ content: result.content }));
  });

  it("presents Japanese proofread tool results without Chinese labels", async () => {
    const { runtime } = createRuntime([
      fauxAssistantMessage(
        fauxToolCall("run_writing_operation", {
          operation: "proofread",
          target: { kind: "inline_text", text: "彼は扉を開けた。。" }
        }, { id: "tool_proofread" }),
        { stopReason: "toolUse" }
      )
    ]);

    const result = await runtime.run(createInput({
      contentLanguage: "ja-JP",
      message: "次の文章を校正してください：彼は扉を開けた。。",
      tools: [{
        name: "run_writing_operation",
        description: "校正",
        parameters: { type: "object", properties: {} }
      }],
      executeTool: async () => ({
        content: JSON.stringify({
          operation: "proofread",
          outputKind: "proofread_issues",
          proofreadIssues: [{
            code: "punctuation",
            quote: "。。",
            suggestion: "。",
            explanation: "句点が重複しています。",
            needsAuthorJudgment: false
          }]
        }),
        action: null
      })
    }), {});

    expect(result.content).toContain("【校正結果】");
    expect(result.content).toContain("句読点");
    expect(result.content).toContain("修正案");
    expect(result.content).not.toMatch(/校对|标点问题|建议/);
  });

  it("rejects a direct proofread answer and asks Pi to use the writing tool", async () => {
    const executeTool = vi.fn(async () => ({
      content: JSON.stringify({
        operation: "proofread",
        outputKind: "proofread_issues",
        proofreadIssues: [{
          code: "punctuation",
          quote: "。。",
          suggestion: "。",
          explanation: "句点が重複しています。",
          severity: "medium"
        }]
      }),
      action: null
    }));
    const directAnswer = "句点が重複しています。『。』に修正してください。";
    const { runtime, faux } = createRuntime([
      fauxAssistantMessage(directAnswer),
      (context) => {
        const correction = [...context.messages].reverse().find((message) => message.role === "user");
        expect(correction?.content).toContain("run_writing_operation");
        return fauxAssistantMessage(fauxToolCall("run_writing_operation", {
          operation: "proofread",
          target: { kind: "inline_text", text: "彼は扉を開けた。。" }
        }, { id: "tool_proofread_retry" }), { stopReason: "toolUse" });
      }
    ]);
    const onChunk = vi.fn();

    const result = await runtime.run(createInput({
      contentLanguage: "ja-JP",
      message: "次の文章を校正してください：彼は扉を開けた。。",
      tools: [{ name: "run_writing_operation", description: "校正", parameters: { type: "object", properties: {} } }],
      executeTool
    }), { onChunk });

    expect(result.content).toContain("【校正結果】");
    expect(result.content).not.toContain(directAnswer);
    expect(onChunk).not.toHaveBeenCalledWith(expect.objectContaining({ content: directAnswer }));
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(faux.state.callCount).toBe(2);
  });

  it("stops a repeated tool loop after eight Pi turns", async () => {
    const repeated = Array.from({ length: 8 }, (_, index) =>
      fauxAssistantMessage(fauxToolCall("list_chapters", {}, { id: `tool_${index + 1}` }), { stopReason: "toolUse" })
    );
    const { runtime, faux } = createRuntime(repeated);

    await expect(runtime.run(createInput({
      tools: [{ name: "list_chapters", description: "列出章节", parameters: { type: "object", properties: {} } }]
    }), {})).rejects.toThrow("超过 8 轮");
    expect(faux.state.callCount).toBe(8);
  });
});
