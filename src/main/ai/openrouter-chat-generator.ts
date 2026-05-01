import type {
  AiChatAgentGenerationInput,
  AiChatGenerationInput,
  AiChatGenerator,
  AiChatHistoryMemorySummaryInput,
  AiChatMessageResult,
  AiChatStreamHandlers,
  AiGenerationOptions
} from "./ai-task-service";
import { runChatAgentLoop, type ChatAgentModel } from "./chat-agent-harness";
import { buildChatAgentMemoryText } from "./chat-agent-memory";
import type {
  ChatAgentContext,
  ChatChapterSummaryInput,
  ChatContextBatchChapterInput,
  ChatContextBatchSummaryInput,
  ChatContextSummaryItem,
  ChatContextSummaryMergeInput
} from "./chat-agent-types";
import { logDevLlmPrompt } from "./dev-prompt-logger";
import type { OpenRouterChatCompletionResult, OpenRouterMessage } from "./openrouter-client";
import { OpenRouterClient } from "./openrouter-client";
import { buildReasoningConfig } from "./reasoning-budget";
import { getTokenBudget, type TokenBudget } from "./token-budget";
import { estimateMessagesTokens, estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import type { SettingsService } from "../settings/settings-service";

function hasAgentContext(input: AiChatGenerationInput): input is AiChatGenerationInput & { readonly agentContext: ChatAgentContext } {
  return "agentContext" in input && Boolean(input.agentContext);
}

const CHAPTER_SUMMARY_MAX_TOKENS = 1800;
const CHAPTER_SUMMARY_MERGE_MAX_TOKENS = 2200;
const CONTEXT_BATCH_SUMMARY_MAX_TOKENS = 3200;
const CONTEXT_SUMMARY_MERGE_MAX_TOKENS = 3200;
const CHAT_MEMORY_SUMMARY_MAX_TOKENS = 2200;
const CHAT_MEMORY_SUMMARY_PROMPT_RATIO = 0.75;
const CHAT_MEMORY_SUMMARY_RECOMPRESS_MAX_ROUNDS = 2;

function capInternalMaxCompletionTokens(requestedTokens: number, budget: TokenBudget): number {
  return Math.max(1, Math.min(requestedTokens, budget.maxOutputTokens));
}

function formatAgentContextSource(mode: ChatAgentContext["mode"]): string {
  if (mode === "summarized") {
    return "分章摘要";
  }
  if (mode === "mixed") {
    return "部分原文，部分摘要";
  }
  return "项目数据库原文";
}

function buildUserPrompt(input: AiChatGenerationInput): string {
  if (hasAgentContext(input)) {
    return [
      "用户问题：",
      input.message,
      `\n上下文范围：${input.agentContext.scopeLabel}`,
      `\n上下文来源：${formatAgentContextSource(input.agentContext.mode)}`,
      "\n上下文内容：",
      input.agentContext.contextText,
      input.selectionText ? `\n用户当前选中文本：\n${input.selectionText}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "用户问题：",
    input.message,
    input.currentChapterTitle ? `\n当前章节：${input.currentChapterTitle}` : "",
    input.selectionText ? `\n选中文本：\n${input.selectionText}` : "",
    input.chapterExcerpt ? `\n当前章节节选：\n${input.chapterExcerpt}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSystemPrompt(): string {
  return [
    "你是中文小说写作助手。",
    "你可以讨论润色、扩写、校对、续写、节奏、人物动机和场景处理。",
    "用户要求总结并加入草稿纸时，直接给出可保存的总结正文；系统会负责保存动作。",
    "如果系统提供了“上下文范围”和“上下文内容”，必须以这些内容为准；不要声称用户没有提供对应章节。",
    "当上下文范围是全部章节或章节范围时，要综合所有给出的章节，不要只回答当前章节。",
    "不要直接替用户确认写回正文；涉及正文修改时给出建议或候选文本。",
    "保持回答简洁、具体、可执行。"
  ].join("\n");
}

function buildHistoryMessages(input: AiChatGenerationInput, chatBudget: TokenBudget): OpenRouterMessage[] {
  const memory = buildChatAgentMemoryText({
    history: input.history,
    tokenBudget: chatBudget,
    compactedSummary: input.compactedMemorySummary,
    compactedThroughMessageId: input.compactedMemoryThroughMessageId
  });
  if (memory === "（无）") {
    return [];
  }
  return [
    {
      role: "user",
      content: `对话记忆：\n${memory}`
    }
  ];
}

function assertChatMessagesWithinBudget(messages: readonly OpenRouterMessage[], maxInputTokens: number): void {
  const estimatedTokens = estimateMessagesTokens(messages);
  if (estimatedTokens <= maxInputTokens) {
    return;
  }

  throw new Error(`AI 对话上下文太长，预计输入约 ${estimatedTokens} tokens，超过上限 ${maxInputTokens}。请缩短问题或选中文本后重试。`);
}

export function buildChatCompletionMessages(input: AiChatGenerationInput, chatBudget: TokenBudget = getTokenBudget("chat")): OpenRouterMessage[] {
  const systemMessage = {
    role: "system",
    content: buildSystemPrompt()
  } satisfies OpenRouterMessage;
  const userMessage = {
    role: "user",
    content: buildUserPrompt(input)
  } satisfies OpenRouterMessage;
  assertChatMessagesWithinBudget([systemMessage, userMessage], chatBudget.maxInputTokens);
  const selectedHistory: OpenRouterMessage[] = [];

  for (const historyMessage of buildHistoryMessages(input, chatBudget).reverse()) {
    const candidate = [systemMessage, historyMessage, ...selectedHistory, userMessage];
    if (estimateMessagesTokens(candidate) <= chatBudget.maxInputTokens) {
      selectedHistory.unshift(historyMessage);
    }
  }

  return [systemMessage, ...selectedHistory, userMessage];
}

export class OpenRouterChatGenerator implements AiChatGenerator {
  constructor(private readonly settingsService: SettingsService) {}

  private async createClient(): Promise<{
    readonly client: OpenRouterClient;
    readonly modelName: string;
    readonly contextLength: number | null;
    readonly chatBudget: TokenBudget;
  }> {
    const config = await this.settingsService.getOpenRouterConfigWithModelMetadata(undefined, { requireTools: true });
    return {
      modelName: config.modelName,
      contextLength: config.contextLength,
      chatBudget: getTokenBudget("chat", config.contextLength),
      client: new OpenRouterClient({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        modelName: config.modelName
      })
    };
  }

  async sendMessageStream(input: AiChatGenerationInput, handlers: AiChatStreamHandlers, options: AiGenerationOptions = {}): Promise<AiChatMessageResult> {
    const { chatBudget, client, contextLength, modelName } = await this.createClient();
    const reasoning = buildReasoningConfig(chatBudget, { exclude: false, fallbackEffort: "medium" });
    const messages = buildChatCompletionMessages(input, chatBudget);
    handlers.onContext?.({
      requestId: input.requestId,
      estimatedInputTokens: estimateMessagesTokens(messages),
      maxInputTokens: chatBudget.maxInputTokens,
      maxOutputTokens: chatBudget.maxOutputTokens,
      modelContextTokens: contextLength,
      modelName,
      contextMode: input.agentContext?.mode ?? "direct",
      scopeLabel: input.agentContext?.scopeLabel ?? (input.currentChapterTitle ? "本章" : input.selectionText ? "选中文本" : "当前对话")
    });
    logDevLlmPrompt({
      kind: "chat",
      modelName,
      messages,
      meta: {
        chapterId: input.chapterId,
        agentContextMode: input.agentContext?.mode,
        agentContextScope: input.agentContext?.scopeLabel,
        currentChapterTitle: input.currentChapterTitle,
        historyMessageCount: input.history.length,
        projectId: input.projectId,
        requestMode: "stream",
        sessionId: input.sessionId
      },
      params: {
        maxCompletionTokens: chatBudget.maxOutputTokens,
        reasoning,
        temperature: 0.55
      }
    });
    const result = await client.streamChatCompletion(
      {
        messages,
        maxCompletionTokens: chatBudget.maxOutputTokens,
        reasoning,
        temperature: 0.55,
        signal: options.signal
      },
      {
        onToken(token) {
          handlers.onChunk?.({ requestId: input.requestId, content: token });
        },
        onReasoning(token) {
          handlers.onReasoning?.({ requestId: input.requestId, content: token });
        }
      }
    );
    const content = result.content.trim();
    if (!content) {
      throw new Error("OpenRouter 返回了空对话内容。");
    }

    return {
      role: "assistant",
      content,
      createdAt: new Date().toISOString()
    };
  }

  async sendAgentMessageStream(
    input: AiChatAgentGenerationInput,
    handlers: AiChatStreamHandlers,
    options: AiGenerationOptions = {}
  ): Promise<AiChatMessageResult> {
    const { chatBudget, client, contextLength, modelName } = await this.createClient();
    const reasoning = buildReasoningConfig(chatBudget, { exclude: false, fallbackEffort: "medium" });
    let iteration = 0;
    const model = {
      stream: async (agentInput, streamHandlers) => {
        iteration += 1;
        logDevLlmPrompt({
          kind: "chat:agent-loop",
          modelName,
          messages: agentInput.messages,
          meta: {
            projectId: input.projectId,
            sessionId: input.sessionId,
            requestMode: "agent_stream",
            iteration,
            toolCount: agentInput.tools.length
          },
          params: {
            maxCompletionTokens: agentInput.maxCompletionTokens,
            reasoning: agentInput.reasoning,
            temperature: agentInput.temperature
          }
        });

        return client.streamChatCompletion(
          {
            messages: agentInput.messages,
            tools: agentInput.tools,
            toolChoice: "auto",
            parallelToolCalls: false,
            allowEmptyContent: true,
            maxCompletionTokens: agentInput.maxCompletionTokens,
            reasoning: agentInput.reasoning,
            temperature: agentInput.temperature,
            signal: agentInput.signal
          },
          streamHandlers
        );
      }
    } satisfies ChatAgentModel;

    const result = await runChatAgentLoop(
      {
        requestId: input.requestId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        userMessage: input.message,
        history: input.history,
        compactedMemorySummary: input.compactedMemorySummary,
        compactedMemoryThroughMessageId: input.compactedMemoryThroughMessageId,
        currentChapterId: input.chapterId,
        currentChapterTitle: input.currentChapterTitle,
        selectionText: input.selectionText,
        chapterDirectory: input.chapterDirectory,
        tools: input.tools,
        executeTool: input.executeTool,
        model,
        tokenBudget: chatBudget,
        modelContextTokens: contextLength,
        modelName,
        reasoning,
        signal: options.signal
      },
      handlers
    );

    return {
      role: "assistant",
      content: result.content,
      createdAt: new Date().toISOString(),
      actions: result.actions
    };
  }

  async summarizeChapterForContext(input: ChatChapterSummaryInput, options: AiGenerationOptions = {}): Promise<string> {
    const { chatBudget: budget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CHAPTER_SUMMARY_MAX_TOKENS, budget);
    const chunkBudget = Math.max(1200, budget.maxInputTokens - estimateTextTokens(input.userMessage) - maxCompletionTokens);
    const chunks = splitTextIntoTokenChunks(input.plainText, chunkBudget);
    const chunkSummaries: string[] = [];

    for (const [index, chunk] of chunks.entries()) {
      const messages = buildChapterSummaryMessages(input, chunk, index + 1, chunks.length);
      logDevLlmPrompt({
        kind: "chat:chapter-summary",
        modelName,
        messages,
        meta: {
          projectId: input.projectId,
          chapterId: input.chapterId,
          chapterTitle: input.title,
          chunkIndex: index + 1,
          chunkCount: chunks.length,
          scopeLabel: input.scopeLabel
        },
        params: {
          maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(client, {
        messages,
        maxCompletionTokens,
        temperature: 0.2,
        signal: options.signal
      });
      const content = result.content.trim();
      if (!content) {
        throw new Error(`第${input.ordinal}章摘要为空。`);
      }
      if (result.truncated) {
        throw new Error(`第${input.ordinal}章摘要被截断，请换用输出额度更高的模型后重试。`);
      }
      chunkSummaries.push(content);
    }

    if (chunkSummaries.length === 1) {
      return chunkSummaries[0];
    }

    const messages = buildChapterSummaryMergeMessages(input, chunkSummaries);
    const mergeMaxCompletionTokens = capInternalMaxCompletionTokens(CHAPTER_SUMMARY_MERGE_MAX_TOKENS, budget);
    logDevLlmPrompt({
      kind: "chat:chapter-summary-merge",
      modelName,
      messages,
      meta: {
        projectId: input.projectId,
        chapterId: input.chapterId,
        chapterTitle: input.title,
        chunkCount: chunkSummaries.length,
        scopeLabel: input.scopeLabel
      },
      params: {
        maxCompletionTokens: mergeMaxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens: mergeMaxCompletionTokens,
      temperature: 0.2,
      signal: options.signal
    });
    const content = result.content.trim();
    if (!content) {
      throw new Error(`第${input.ordinal}章合并摘要为空。`);
    }
    if (result.truncated) {
      throw new Error(`第${input.ordinal}章合并摘要被截断，请换用输出额度更高的模型后重试。`);
    }
    return content;
  }

  async summarizeContextBatchForContext(input: ChatContextBatchSummaryInput, options: AiGenerationOptions = {}): Promise<string> {
    if (input.chapters.length === 0) {
      throw new Error("AI 对话批量摘要缺少章节。");
    }
    if (input.chapters.length === 1) {
      const chapter = input.chapters[0];
      return this.summarizeChapterForContext(
        {
          projectId: input.projectId,
          chapterId: chapter.chapterId,
          title: chapter.title,
          ordinal: chapter.ordinal,
          plainText: chapter.plainText,
          userMessage: input.userMessage,
          scopeLabel: input.scopeLabel
        },
        options
      );
    }

    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CONTEXT_BATCH_SUMMARY_MAX_TOKENS, chatBudget);
    const messages = buildContextBatchSummaryMessages(input);
    const first = input.chapters[0];
    const last = input.chapters.at(-1) ?? first;
    logDevLlmPrompt({
      kind: "chat:context-batch-summary",
      modelName,
      messages,
      meta: {
        projectId: input.projectId,
        firstChapter: first.ordinal,
        lastChapter: last.ordinal,
        chapterCount: input.chapters.length,
        scopeLabel: input.scopeLabel
      },
      params: {
        maxCompletionTokens,
        temperature: 0.2
      }
    });
    const result = await this.runInternalStreamingCompletion(client, {
      messages,
      maxCompletionTokens,
      temperature: 0.2,
      signal: options.signal
    });
    const content = result.content.trim();
    if (!content) {
      throw new Error(`第${first.ordinal}-${last.ordinal}章批量摘要为空。`);
    }
    if (result.truncated) {
      throw new Error(`第${first.ordinal}-${last.ordinal}章批量摘要被截断，请缩小章节范围或换用输出额度更高的模型后重试。`);
    }
    return content;
  }

  async mergeContextSummaries(input: ChatContextSummaryMergeInput, options: AiGenerationOptions = {}): Promise<string> {
    return this.mergeSummaryItems(input, input.summaries, options, 0);
  }

  async summarizeChatHistoryForMemory(input: AiChatHistoryMemorySummaryInput, options: AiGenerationOptions = {}): Promise<{ readonly summary: string }> {
    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CHAT_MEMORY_SUMMARY_MAX_TOKENS, chatBudget);
    let currentSummary = input.previousSummary?.trim() ?? "";
    const formatted = input.messages.map(formatChatMemoryMessage).join("\n\n");
    let remaining = formatted.trim();
    let chunkIndex = 0;

    while (remaining) {
      chunkIndex += 1;
      const chunk = buildBudgetedChatMemoryChunk({
        input,
        currentSummary,
        maxCompletionTokens,
        maxInputTokens: chatBudget.maxInputTokens,
        remaining,
        chunkIndex
      });
      const messages = buildChatHistoryMemorySummaryMessages({
        ...input,
        previousSummary: currentSummary || null,
        messagesText: chunk,
        chunkIndex,
        chunkCount: estimateRemainingChunkCount(remaining, chunk, chunkIndex)
      });
      logDevLlmPrompt({
        kind: "chat:memory-compaction",
        modelName,
        messages,
        meta: {
          projectId: input.projectId,
          sessionId: input.sessionId,
          messageCount: input.messages.length,
          chunkIndex,
          chunkCount: estimateRemainingChunkCount(remaining, chunk, chunkIndex)
        },
        params: {
          maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(client, {
        messages,
        maxCompletionTokens,
        temperature: 0.2,
        signal: options.signal
      });
      currentSummary = result.content.trim();
      if (!currentSummary) {
        throw new Error("AI 对话记忆压缩结果为空。");
      }
      if (result.truncated) {
        throw new Error("AI 对话记忆压缩结果被截断，请换用输出额度更高的模型后重试。");
      }
      currentSummary = await this.recompressMemorySummaryIfNeeded({
        chatBudget,
        client,
        input,
        maxCompletionTokens,
        modelName,
        options,
        summary: currentSummary
      });
      remaining = remaining.slice(chunk.length).trimStart();
    }

    return {
      summary: currentSummary
    };
  }

  private async mergeSummaryItems(
    input: ChatContextSummaryMergeInput,
    summaries: readonly ChatContextSummaryItem[],
    options: AiGenerationOptions,
    depth: number
  ): Promise<string> {
    if (summaries.length === 0) {
      return "（没有可用摘要）";
    }
    if (depth > 5) {
      throw new Error("AI 对话摘要层级过深，请缩小章节范围后重试。");
    }

    const { chatBudget, client, modelName } = await this.createClient();
    const maxCompletionTokens = capInternalMaxCompletionTokens(CONTEXT_SUMMARY_MERGE_MAX_TOKENS, chatBudget);
    const batches = buildSummaryMergeBatches(input, summaries, chatBudget, maxCompletionTokens);
    const merged: ChatContextSummaryItem[] = [];

    for (const [index, batch] of batches.entries()) {
      const messages = buildContextSummaryMergeMessages(input, batch);
      logDevLlmPrompt({
        kind: "chat:context-summary-merge",
        modelName,
        messages,
        meta: {
          projectId: input.projectId,
          scopeLabel: input.scopeLabel,
          mergeDepth: depth,
          batchIndex: index + 1,
          batchCount: batches.length,
          summaryCount: batch.length
        },
        params: {
          maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(client, {
        messages,
        maxCompletionTokens,
        temperature: 0.2,
        signal: options.signal
      });
      const content = result.content.trim();
      if (!content) {
        throw new Error("AI 对话聚合摘要为空。");
      }
      if (result.truncated) {
        throw new Error("AI 对话聚合摘要被截断，请缩小章节范围或换用输出额度更高的模型后重试。");
      }
      const first = batch[0];
      const last = batch.at(-1) ?? first;
      merged.push({
        chapterId: first.chapterId,
        title: first.ordinal === last.ordinal ? first.title : `${first.title} 至 ${last.title}`,
        ordinal: first.ordinal,
        summary: content
      });
    }

    if (merged.length === 1) {
      return merged[0].summary;
    }

    return this.mergeSummaryItems(input, merged, options, depth + 1);
  }

  private async runInternalStreamingCompletion(
    client: OpenRouterClient,
    input: {
      readonly messages: readonly OpenRouterMessage[];
      readonly maxCompletionTokens: number;
      readonly temperature: number;
      readonly signal?: AbortSignal;
    }
  ): Promise<OpenRouterChatCompletionResult> {
    return client.streamChatCompletion({
      messages: input.messages,
      maxCompletionTokens: input.maxCompletionTokens,
      temperature: input.temperature,
      signal: input.signal
    });
  }

  private async recompressMemorySummaryIfNeeded(input: {
    readonly client: OpenRouterClient;
    readonly chatBudget: TokenBudget;
    readonly input: AiChatHistoryMemorySummaryInput;
    readonly maxCompletionTokens: number;
    readonly modelName: string;
    readonly options: AiGenerationOptions;
    readonly summary: string;
  }): Promise<string> {
    const summaryBudget = getChatMemorySummaryBudget(input.chatBudget);
    let summary = input.summary;
    for (let round = 1; round <= CHAT_MEMORY_SUMMARY_RECOMPRESS_MAX_ROUNDS && estimateTextTokens(summary) > summaryBudget; round += 1) {
      const messages = buildChatMemoryRecompressionMessages(summary, summaryBudget, round);
      logDevLlmPrompt({
        kind: "chat:memory-recompression",
        modelName: input.modelName,
        messages,
        meta: {
          projectId: input.input.projectId,
          sessionId: input.input.sessionId,
          round
        },
        params: {
          maxCompletionTokens: input.maxCompletionTokens,
          temperature: 0.2
        }
      });
      const result = await this.runInternalStreamingCompletion(input.client, {
        messages,
        maxCompletionTokens: input.maxCompletionTokens,
        temperature: 0.2,
        signal: input.options.signal
      });
      summary = result.content.trim();
      if (!summary) {
        throw new Error("AI 对话记忆二次压缩结果为空。");
      }
      if (result.truncated) {
        throw new Error("AI 对话记忆二次压缩结果被截断，请换用输出额度更高的模型后重试。");
      }
    }
    if (estimateTextTokens(summary) > summaryBudget) {
      throw new Error("AI 对话记忆压缩结果仍然超过输入预算，请开启新对话，或换用上下文更大的模型后重试。");
    }
    return summary;
  }
}

function splitTextIntoTokenChunks(text: string, maxTokens: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining) {
    const chunk = truncateTextToTokenBudget(remaining, maxTokens).text;
    if (!chunk) {
      break;
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length).trimStart();
  }

  return chunks.length > 0 ? chunks : ["（本章暂无正文）"];
}

function estimateRemainingChunkCount(remaining: string, chunk: string, chunkIndex: number): number {
  const rest = remaining.slice(chunk.length).trimStart();
  if (!rest) {
    return chunkIndex;
  }
  const chunkTokens = Math.max(1, estimateTextTokens(chunk));
  return chunkIndex + Math.ceil(estimateTextTokens(rest) / chunkTokens);
}

function buildBudgetedChatMemoryChunk(input: {
  readonly input: AiChatHistoryMemorySummaryInput;
  readonly currentSummary: string;
  readonly maxCompletionTokens: number;
  readonly maxInputTokens: number;
  readonly remaining: string;
  readonly chunkIndex: number;
}): string {
  const reserveTokens = estimateTextTokens(input.currentSummary) + input.maxCompletionTokens + 400;
  let chunkBudget = Math.max(1, input.maxInputTokens - reserveTokens);
  let chunk = truncateTextToTokenBudget(input.remaining, chunkBudget).text;

  while (chunk) {
    const messages = buildChatHistoryMemorySummaryMessages({
      ...input.input,
      previousSummary: input.currentSummary || null,
      messagesText: chunk,
      chunkIndex: input.chunkIndex,
      chunkCount: estimateRemainingChunkCount(input.remaining, chunk, input.chunkIndex)
    });
    const estimatedTokens = estimateMessagesTokens(messages);
    if (estimatedTokens <= input.maxInputTokens) {
      return chunk;
    }

    const overage = estimatedTokens - input.maxInputTokens;
    chunkBudget = Math.max(0, estimateTextTokens(chunk) - overage - 64);
    const nextChunk = truncateTextToTokenBudget(chunk, chunkBudget).text;
    if (!nextChunk || nextChunk === chunk) {
      break;
    }
    chunk = nextChunk;
  }

  throw new Error("AI 对话记忆压缩输入超过模型窗口，请开启新对话，或换用上下文更大的模型后重试。");
}

function buildChapterSummaryMessages(input: ChatChapterSummaryInput, chunk: string, chunkIndex: number, chunkCount: number): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说章节摘要助手。",
        "你的任务是为后续整书/范围问答压缩上下文，必须忠实保留剧情事实、人物行动、关键冲突、伏笔、设定变化和未解决问题。",
        "不要评价文笔，不要改写正文，不要加入原文没有的信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `上下文范围：${input.scopeLabel}`,
        `章节：第${input.ordinal}章 ${input.title}`,
        `分段：${chunkIndex}/${chunkCount}`,
        "正文：",
        chunk,
        "请输出本段对最终问题有用的摘要。"
      ].join("\n")
    }
  ];
}

function buildChapterSummaryMergeMessages(input: ChatChapterSummaryInput, summaries: readonly string[]): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说章节摘要整合助手。",
        "把同一章节的多个分段摘要合并成一个章节摘要。",
        "保留剧情事实、人物行动、关键冲突、伏笔、设定变化和未解决问题；不要扩写。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `章节：第${input.ordinal}章 ${input.title}`,
        "分段摘要：",
        summaries.map((summary, index) => `段${index + 1}：\n${summary}`).join("\n\n"),
        "请合并为一个章节摘要。"
      ].join("\n")
    }
  ];
}

function formatBatchChapter(chapter: ChatContextBatchChapterInput): string {
  return [`[第${chapter.ordinal}章 ${chapter.title}]`, chapter.plainText.trim() || "（本章暂无正文）"].join("\n");
}

function buildContextBatchSummaryMessages(input: ChatContextBatchSummaryInput): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说多章节摘要助手。",
        "你的任务是把一组连续章节压缩成给后续对话使用的批量摘要。",
        "必须忠实保留剧情事实、人物行动、关键冲突、伏笔、设定变化和未解决问题。",
        "按章节顺序组织摘要，必要时用短小条目；不要评价文笔，不要改写正文，不要加入原文没有的信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `上下文范围：${input.scopeLabel}`,
        `章节批次：第${input.chapters[0]?.ordinal ?? "?"}-${input.chapters.at(-1)?.ordinal ?? "?"}章`,
        "正文：",
        input.chapters.map(formatBatchChapter).join("\n\n"),
        "请输出这批章节对最终问题有用的摘要。"
      ].join("\n")
    }
  ];
}

function formatSummaryItem(item: ChatContextSummaryItem): string {
  return [`[第${item.ordinal}章 ${item.title}]`, item.summary].join("\n");
}

function buildSummaryMergeBatches(
  input: ChatContextSummaryMergeInput,
  summaries: readonly ChatContextSummaryItem[],
  budget: TokenBudget = getTokenBudget("chat"),
  maxCompletionTokens = capInternalMaxCompletionTokens(CONTEXT_SUMMARY_MERGE_MAX_TOKENS, budget)
): readonly (readonly ChatContextSummaryItem[])[] {
  const maxBatchTokens = Math.max(1200, budget.maxInputTokens - estimateTextTokens(input.userMessage) - maxCompletionTokens);
  const batches: ChatContextSummaryItem[][] = [];
  let current: ChatContextSummaryItem[] = [];
  let currentTokens = 0;

  for (const item of summaries) {
    const block = formatSummaryItem(item);
    const blockTokens = estimateTextTokens(block);
    const nextWouldOverflow = current.length > 0 && currentTokens + blockTokens > maxBatchTokens;
    if (nextWouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    if (blockTokens > maxBatchTokens) {
      const trimmed = truncateTextToTokenBudget(item.summary, Math.max(200, maxBatchTokens - estimateTextTokens(item.title) - 80)).text;
      current.push({
        ...item,
        summary: trimmed
      });
      batches.push(current);
      current = [];
      currentTokens = 0;
      continue;
    }

    current.push(item);
    currentTokens += blockTokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function buildContextSummaryMergeMessages(input: ChatContextSummaryMergeInput, summaries: readonly ChatContextSummaryItem[]): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说范围摘要压缩助手。",
        "把多个章节摘要压缩成更短的范围摘要，用于后续回答作者问题。",
        "必须保留主线进展、人物关系变化、关键冲突、伏笔、设定变化和未解决问题；不要加入原摘要没有的信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `用户最终问题：${input.userMessage}`,
        `上下文范围：${input.scopeLabel}`,
        "章节摘要：",
        summaries.map(formatSummaryItem).join("\n\n"),
        "请输出压缩后的范围摘要。"
      ].join("\n")
    }
  ];
}

function formatChatMemoryMessage(message: AiChatHistoryMemorySummaryInput["messages"][number]): string {
  const role = message.role === "user" ? "作者" : message.role === "assistant" ? "AI" : message.role;
  return [`[${role} | ${message.createdAt}]`, message.content.trim()].join("\n");
}

function buildChatHistoryMemorySummaryMessages(input: AiChatHistoryMemorySummaryInput & {
  readonly messagesText: string;
  readonly chunkIndex: number;
  readonly chunkCount: number;
}): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说写作 agent 的对话记忆压缩器。",
        "你的任务是把较早的多轮对话压缩成后续 agent 可继续使用的长期记忆。",
        "必须保留：用户长期目标、已指定的章节范围、已经总结过的剧情、人物特征、设定结论、用户偏好、未完成事项、上一轮仍可能被追问的指代对象。",
        "不要编造正文内容，不要删除仍有后续引用价值的信息。",
        "输出结构化 Markdown，简洁但信息完整。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        input.previousSummary ? `已有压缩记忆：\n${input.previousSummary}` : "已有压缩记忆：无",
        "",
        `待合并的较早对话：${input.chunkIndex}/${input.chunkCount}`,
        input.messagesText,
        "",
        "请输出更新后的完整压缩记忆。"
      ].join("\n")
    }
  ];
}

function getChatMemorySummaryBudget(chatBudget: TokenBudget): number {
  return Math.max(400, Math.floor(chatBudget.maxInputTokens * CHAT_MEMORY_SUMMARY_PROMPT_RATIO) - 120);
}

function buildChatMemoryRecompressionMessages(summary: string, targetTokens: number, round: number): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是中文小说写作 agent 的对话记忆二次压缩器。",
        "上一轮压缩记忆仍然过长，必须进一步压缩到更短。",
        "保留用户长期目标、章节范围、剧情结论、人物特征、设定结论、用户偏好和未完成事项。",
        "不要编造正文内容，不要加入新信息。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `目标上限：约 ${targetTokens} tokens`,
        `压缩轮次：${round}`,
        "上一轮压缩记忆：",
        summary,
        "",
        "请输出更短的完整压缩记忆。"
      ].join("\n")
    }
  ];
}
