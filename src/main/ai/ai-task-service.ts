import { ChatActionService } from "./chat-action-service";
import {
  buildChatContextSummaryBatches,
  buildSummarizedAgentContextFromItems,
  buildSummaryItemFromBatch,
  isChatAgentContextTooLarge,
  resolveChatAgentContext,
  type ResolvedChatAgentContext
} from "./chat-agent-context";
import type { ChatAgentDirectoryItem, ChatAgentToolExecutorResult } from "./chat-agent-harness";
import type { ChatPlanner } from "./chat-agent-planner";
import {
  chatAgentPlanSchema,
  type ChatAgentContext,
  type ChatAgentPlan,
  type ChatContextBatchSummaryInput,
  type ChatChapterSummaryInput,
  type ChatContextSummaryItem,
  type ChatContextSummaryMergeInput
} from "./chat-agent-types";
import { executeChatAgentToolWithAction, MOSHU_CHAT_AGENT_TOOLS } from "./chat-agent-tools";
import { selectChatMemoryCompactionTarget } from "./chat-agent-memory";
import { enrichChatInputWithReferencedChapter } from "./chat-context-resolver";
import { parseChatScopeReference } from "./chat-reference-parser";
import type { OpenRouterToolCall, OpenRouterToolDefinition } from "./openrouter-client";
import { estimateTextTokens } from "./token-estimator";
import type { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { ProofreadIssue } from "../shared/proofread";
import { getTokenBudget, type TokenBudget } from "./token-budget";
import type {
  AiApplyCandidateInput,
  AiChatAction,
  AiChatMessageRecord,
  AiChatSessionRecord,
  AiClearChatInput,
  AiCreateChatSessionInput,
  AiCreateTaskInput,
  AiDeleteChatSessionInput,
  AiGeneratePreviewInput,
  AiGeneratePreviewStreamInput,
  AiGetChatSessionInput,
  AiListChatSessionsInput,
  AiListChatMessagesInput,
  AiRenameChatSessionInput,
  AiRejectCandidateInput,
  AiSaveCandidateToScratchpadInput,
  AiSendChatMessageInput,
  AiSendChatMessageStreamInput,
  AiStreamContextEvent,
  AiTaskCandidateRecord,
  AiTaskRecord,
  AiUpdateTaskInput
} from "../shared/types";

export type AiTaskGenerationResult = {
  readonly generatedText: string;
  readonly changeSummary: string | null;
  readonly proofreadIssues?: readonly ProofreadIssue[] | null;
  readonly truncated?: boolean;
};

export type AiGenerationOptions = {
  readonly signal?: AbortSignal;
};

export type AiTaskGenerator = {
  readonly generate: (task: AiTaskRecord) => Promise<AiTaskGenerationResult>;
  readonly generateStream?: (task: AiTaskRecord, handlers: AiTaskStreamHandlers, options?: AiGenerationOptions) => Promise<AiTaskGenerationResult>;
  readonly continueStream?: (
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options?: AiGenerationOptions
  ) => Promise<AiTaskGenerationResult>;
};

export type AiChatMessageResult = {
  readonly role: "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly actions?: readonly AiChatAction[];
};

export type AiChatGenerationInput = AiSendChatMessageStreamInput & {
  readonly history: readonly AiChatMessageRecord[];
  readonly agentContext?: ChatAgentContext;
  readonly compactedMemorySummary?: string | null;
  readonly compactedMemoryThroughMessageId?: string | null;
};

export type AiChatAgentGenerationInput = AiSendChatMessageStreamInput & {
  readonly history: readonly AiChatMessageRecord[];
  readonly compactedMemorySummary?: string | null;
  readonly compactedMemoryThroughMessageId?: string | null;
  readonly chapterDirectory: readonly ChatAgentDirectoryItem[];
  readonly tools: readonly OpenRouterToolDefinition[];
  readonly executeTool: (call: OpenRouterToolCall) => Promise<ChatAgentToolExecutorResult>;
};

export type AiChatHistoryMemorySummaryInput = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly previousSummary: string | null;
  readonly messages: readonly AiChatMessageRecord[];
};

export type AiChatHistoryMemorySummaryResult = {
  readonly summary: string;
};

export type AiChatGenerator = {
  readonly sendMessage: (input: AiSendChatMessageInput) => Promise<AiChatMessageResult>;
  readonly sendMessageStream?: (input: AiChatGenerationInput, handlers: AiChatStreamHandlers, options?: AiGenerationOptions) => Promise<AiChatMessageResult>;
  readonly sendAgentMessageStream?: (
    input: AiChatAgentGenerationInput,
    handlers: AiChatStreamHandlers,
    options?: AiGenerationOptions
  ) => Promise<AiChatMessageResult>;
  readonly summarizeChapterForContext?: (input: ChatChapterSummaryInput, options?: AiGenerationOptions) => Promise<string>;
  readonly summarizeContextBatchForContext?: (input: ChatContextBatchSummaryInput, options?: AiGenerationOptions) => Promise<string>;
  readonly mergeContextSummaries?: (input: ChatContextSummaryMergeInput, options?: AiGenerationOptions) => Promise<string>;
  readonly summarizeChatHistoryForMemory?: (
    input: AiChatHistoryMemorySummaryInput,
    options?: AiGenerationOptions
  ) => Promise<AiChatHistoryMemorySummaryResult>;
};

type GeneratedPreview = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

export type AiTaskStreamHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onDone?: (event: { readonly requestId: string; readonly payload: GeneratedPreview }) => void;
  readonly onError?: (event: { readonly requestId: string; readonly error: string }) => void;
};

export type AiChatStreamResult = {
  readonly messages: readonly AiChatMessageRecord[];
  readonly action: AiChatAction | null;
};

export type AiChatStreamHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onReasoning?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onContext?: (event: {
    readonly requestId: string;
    readonly estimatedInputTokens: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly modelContextTokens: number | null;
    readonly modelName: string;
    readonly contextMode: "direct" | "summarized";
    readonly scopeLabel: string;
  }) => void;
  readonly onDone?: (event: { readonly requestId: string; readonly payload: AiChatStreamResult }) => void;
  readonly onError?: (event: { readonly requestId: string; readonly error: string }) => void;
};

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

type AiTaskRepositoryResolver = (projectId?: string) => AiTaskRepository;
type AiChatRepositoryResolver = (projectId: string) => AiChatRepository;
type ScratchNoteRepositoryResolver = (projectId: string) => ScratchNoteRepository;
type ChapterRepositoryResolver = (projectId: string) => ChapterRepository;
type ChatTokenBudgetResolver = () => TokenBudget | Promise<TokenBudget>;

function truncatedTaskError(task: AiTaskRecord): string {
  return task.taskType === "proofread"
    ? "校对结果被截断。请缩短选区，或换用输出额度更高的模型后重试。"
    : "AI 输出被截断。已保留部分结果，请点击继续生成或缩短选区后重试。";
}

function isCancellationReason(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") {
    return String(reason) === "canceled";
  }

  const record = reason as { readonly code?: unknown; readonly message?: unknown; readonly name?: unknown };
  return (
    record.code === "ERR_CANCELED" ||
    record.name === "AbortError" ||
    record.name === "CanceledError" ||
    record.message === "canceled" ||
    record.message === "AI 对话已取消。"
  );
}

function isSameContextMeterModel(previous: AiStreamContextEvent, next: AiStreamContextEvent): boolean {
  return (
    previous.modelName === next.modelName &&
    previous.modelContextTokens === next.modelContextTokens &&
    previous.maxInputTokens === next.maxInputTokens &&
    previous.maxOutputTokens === next.maxOutputTokens
  );
}

function mergeSessionContextUsage(previous: AiStreamContextEvent | null, next: AiStreamContextEvent, options: { readonly allowDecrease: boolean }): AiStreamContextEvent {
  if (!previous || !isSameContextMeterModel(previous, next)) {
    return next;
  }
  if (options.allowDecrease) {
    return next;
  }
  if (next.estimatedInputTokens >= previous.estimatedInputTokens) {
    return next;
  }

  return {
    ...next,
    estimatedInputTokens: previous.estimatedInputTokens,
    contextMode: previous.contextMode,
    scopeLabel: "会话背景窗口"
  };
}

function advanceSessionContextUsageAfterAnswer(
  previous: AiStreamContextEvent | null,
  input: AiSendChatMessageStreamInput,
  assistantContent: string
): AiStreamContextEvent | null {
  if (!previous) {
    return null;
  }

  const exchangeTokens = estimateTextTokens([input.message, assistantContent].filter(Boolean).join("\n")) + 8;
  if (exchangeTokens <= 0) {
    return previous;
  }

  return {
    ...previous,
    requestId: input.requestId,
    estimatedInputTokens: Math.min(previous.maxInputTokens, previous.estimatedInputTokens + exchangeTokens),
    scopeLabel: "会话背景窗口"
  };
}

function inferChatIntent(message: string): ChatAgentPlan["intent"] {
  const normalized = message.replace(/\s+/g, "");
  if (/校对|错别字|病句/.test(normalized)) {
    return "proofread";
  }
  if (/改写|重写|润色/.test(normalized)) {
    return "rewrite_suggest";
  }
  if (/整理|梳理|归纳/.test(normalized)) {
    return "organize";
  }
  if (/总结|摘要|概括|提炼/.test(normalized)) {
    return "summarize";
  }
  if (/分析|节奏|人物|动机|伏笔|矛盾|逻辑/.test(normalized)) {
    return "analyze";
  }
  return "answer";
}

function inferSafeChatActions(message: string): ChatAgentPlan["actions"] {
  const normalized = message.replace(/\s+/g, "");
  if (/(草稿纸|草稿|素材)/.test(normalized) && /(加入|保存|存到|放到|记录)/.test(normalized)) {
    return [{ type: "add_to_scratchpad" }];
  }
  return [];
}

function buildPlanFromAtReference(message: string): ChatAgentPlan | null {
  const reference = parseChatScopeReference(message);
  if (!reference) {
    return null;
  }

  return {
    intent: inferChatIntent(reference.messageWithoutReference || message),
    scope: reference.scope,
    actions: inferSafeChatActions(message),
    reason: "用户使用 @ 显式指定上下文范围"
  };
}

function isScopeFollowUpMessage(message: string): boolean {
  const normalized = message.replace(/\s+/g, "");
  return /^(同时|顺便|另外|还有|也|并且|然后|再|继续|同样)/.test(normalized) || /(同时|顺便|另外|还有|也要|也请|并且)/.test(normalized);
}

function buildPlanFromPreviousScope(message: string, history: readonly AiChatMessageRecord[]): ChatAgentPlan | null {
  if (!isScopeFollowUpMessage(message)) {
    return null;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role !== "user") {
      continue;
    }
    const previousReference = parseChatScopeReference(item.content);
    if (!previousReference) {
      continue;
    }

    return {
      intent: inferChatIntent(message),
      scope: previousReference.scope,
      actions: inferSafeChatActions(message),
      reason: "用户追问，沿用上一轮明确指定的章节范围"
    };
  }

  return null;
}

export class AiTaskService {
  private readonly resolveAiTaskRepo: AiTaskRepositoryResolver;
  private readonly resolveAiChatRepo?: AiChatRepositoryResolver;
  private readonly resolveChapterRepo?: ChapterRepositoryResolver;
  private readonly resolveScratchRepo?: ScratchNoteRepositoryResolver;
  private readonly chatActionService?: ChatActionService;
  private readonly activeStreams = new Map<string, AbortController>();

  constructor(
    aiTaskRepo: AiTaskRepository | AiTaskRepositoryResolver,
    private readonly generator?: AiTaskGenerator,
    private readonly chatGenerator?: AiChatGenerator,
    aiChatRepo?: AiChatRepository | AiChatRepositoryResolver,
    scratchRepo?: ScratchNoteRepository | ScratchNoteRepositoryResolver,
    chapterRepo?: ChapterRepository | ChapterRepositoryResolver,
    private readonly chatPlanner?: ChatPlanner,
    private readonly resolveChatTokenBudget: ChatTokenBudgetResolver = () => getTokenBudget("chat")
  ) {
    this.resolveAiTaskRepo = typeof aiTaskRepo === "function" ? aiTaskRepo : () => aiTaskRepo;
    this.resolveAiChatRepo = aiChatRepo ? (typeof aiChatRepo === "function" ? aiChatRepo : () => aiChatRepo) : undefined;
    this.resolveChapterRepo = chapterRepo ? (typeof chapterRepo === "function" ? chapterRepo : () => chapterRepo) : undefined;
    this.resolveScratchRepo = scratchRepo ? (typeof scratchRepo === "function" ? scratchRepo : () => scratchRepo) : undefined;
    this.chatActionService = this.resolveScratchRepo ? new ChatActionService(this.resolveScratchRepo) : undefined;
  }

  private getAiChatRepo(projectId: string): AiChatRepository {
    if (!this.resolveAiChatRepo) {
      throw new Error("AI 对话存储未初始化。");
    }

    return this.resolveAiChatRepo(projectId);
  }

  private resolveReferencedChapterInput<T extends AiSendChatMessageInput | AiSendChatMessageStreamInput>(input: T): T {
    if (!input.projectId || !this.resolveChapterRepo) {
      return input;
    }

    return enrichChatInputWithReferencedChapter(input, this.resolveChapterRepo(input.projectId));
  }

  private async resolveChatAgentPlan(
    input: AiSendChatMessageStreamInput,
    history: readonly AiChatMessageRecord[],
    signal?: AbortSignal
  ): Promise<ChatAgentPlan | null> {
    const explicitPlan = buildPlanFromAtReference(input.message);
    if (explicitPlan) {
      if (!this.resolveChapterRepo) {
        return null;
      }
      return chatAgentPlanSchema.parse(explicitPlan);
    }

    const previousScopePlan = buildPlanFromPreviousScope(input.message, history);
    if (previousScopePlan) {
      if (!this.resolveChapterRepo) {
        return null;
      }
      return chatAgentPlanSchema.parse(previousScopePlan);
    }

    if (!this.chatPlanner) {
      return null;
    }
    if (!this.resolveChapterRepo) {
      throw new Error("AI 对话章节上下文服务未初始化。");
    }

    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const plan = chatAgentPlanSchema.parse(
      await this.chatPlanner.plan(
        {
          projectId: input.projectId,
          message: input.message,
          currentChapterId: input.chapterId,
          selectionText: input.selectionText,
          chapters: chapterRepo.listByProject(input.projectId)
        },
        { signal }
      )
    );

    if (plan.needsClarification) {
      throw new Error(plan.clarificationQuestion ?? "AI 需要更多信息才能判断这次对话要读取哪些章节。");
    }

    return plan;
  }

  private async buildAgenticChatGenerationInput(
    input: AiSendChatMessageStreamInput,
    history: readonly AiChatMessageRecord[],
    memory: Pick<AiChatSessionRecord, "compactedMemorySummary" | "compactedMemoryThroughMessageId">,
    signal?: AbortSignal
  ): Promise<{ readonly generationInput: AiChatGenerationInput; readonly plan: ChatAgentPlan } | null> {
    const plan = await this.resolveChatAgentPlan(input, history, signal);
    if (!plan) {
      return null;
    }
    if (!this.resolveChapterRepo) {
      throw new Error("AI 对话章节上下文服务未初始化。");
    }

    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const chatBudget = await this.resolveChatTokenBudget();
    const resolved = resolveChatAgentContext(
      {
        projectId: input.projectId,
        message: input.message,
        chapterId: input.chapterId,
        selectionText: input.selectionText
      },
      plan,
      chapterRepo,
      chatBudget
    );
    const agentContext = await this.compressResolvedAgentContext(input.projectId, input.message, resolved, chatBudget, signal);

    return {
      plan,
      generationInput: {
        ...input,
        chapterId: resolved.primaryChapterId ?? undefined,
        currentChapterTitle: resolved.chapters.length === 1 ? resolved.chapters[0].content.title : undefined,
        chapterExcerpt:
          agentContext.mode === "direct" && resolved.chapters.length === 1
            ? agentContext.contextText.split("\n").slice(1).join("\n")
            : undefined,
        history,
        compactedMemorySummary: memory.compactedMemorySummary,
        compactedMemoryThroughMessageId: memory.compactedMemoryThroughMessageId,
        agentContext
      }
    };
  }

  private async compressResolvedAgentContext(
    projectId: string,
    message: string,
    resolved: ResolvedChatAgentContext,
    chatBudget: TokenBudget,
    signal?: AbortSignal
  ): Promise<ChatAgentContext> {
    if (!resolved.requiresSummaries) {
      return resolved.agentContext;
    }

    const summaryItems = await this.summarizeAgentContext(projectId, message, resolved, signal);
    let agentContext = buildSummarizedAgentContextFromItems(resolved, summaryItems);
    if (isChatAgentContextTooLarge(message, agentContext.contextText, chatBudget)) {
      const mergeContextSummaries = this.chatGenerator?.mergeContextSummaries;
      if (!mergeContextSummaries) {
        throw new Error("AI 对话分章摘要仍然过长，需要聚合摘要，但聚合摘要服务未初始化。");
      }
      const mergedSummary = await mergeContextSummaries(
        {
          projectId,
          userMessage: message,
          scopeLabel: resolved.agentContext.scopeLabel,
          summaries: summaryItems
        },
        { signal }
      );
      agentContext = {
        ...agentContext,
        contextText: `[${resolved.agentContext.scopeLabel} | 聚合摘要]\n${mergedSummary.trim()}`
      };
      if (isChatAgentContextTooLarge(message, agentContext.contextText, chatBudget)) {
        throw new Error("AI 对话聚合摘要仍然超过输入预算，请缩小章节范围后重试。");
      }
    }

    return agentContext;
  }

  private async buildToolCallAgentGenerationInput(
    input: AiSendChatMessageStreamInput,
    history: readonly AiChatMessageRecord[],
    memory: Pick<AiChatSessionRecord, "compactedMemorySummary" | "compactedMemoryThroughMessageId">,
    signal?: AbortSignal
  ): Promise<AiChatAgentGenerationInput | null> {
    if (!this.chatGenerator?.sendAgentMessageStream || !this.resolveChapterRepo) {
      return null;
    }

    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const chapters = chapterRepo.listByProject(input.projectId);
    const currentChapter = input.chapterId ? chapters.find((chapter) => chapter.id === input.chapterId) : null;
    const tokenBudget = await this.resolveChatTokenBudget();
    const allowedActions = inferSafeChatActions(input.message).map((action) => action.type);
    const scratchRepo = this.resolveScratchRepo?.(input.projectId);
    const runtimeBase = {
      projectId: input.projectId,
      currentChapterId: currentChapter?.id ?? input.chapterId,
      selectionText: input.selectionText,
      userMessage: input.message,
      chapterRepo,
      scratchRepo,
      tokenBudget,
      signal,
      allowedActions,
      summarizeResolvedContext: async (resolved: ResolvedChatAgentContext, summarizeSignal?: AbortSignal): Promise<ChatAgentContext> =>
        this.compressResolvedAgentContext(input.projectId, input.message, resolved, tokenBudget, summarizeSignal)
    };

    return {
      ...input,
      currentChapterTitle: currentChapter?.title ?? input.currentChapterTitle,
      history,
      compactedMemorySummary: memory.compactedMemorySummary,
      compactedMemoryThroughMessageId: memory.compactedMemoryThroughMessageId,
      chapterDirectory: chapters.map((chapter, index) => ({
        ordinal: index + 1,
        id: chapter.id,
        title: chapter.title,
        wordCount: chapter.wordCount,
        current: chapter.id === input.chapterId
      })),
      tools: allowedActions.includes("add_to_scratchpad")
        ? MOSHU_CHAT_AGENT_TOOLS
        : MOSHU_CHAT_AGENT_TOOLS.filter((tool) => tool.function.name !== "add_to_scratchpad"),
      executeTool: (call) =>
        executeChatAgentToolWithAction({
          name: call.name,
          argumentsJson: call.argumentsJson,
          runtime: runtimeBase
        })
    };
  }

  private async compactChatMemoryIfNeeded(
    input: AiSendChatMessageStreamInput,
    chatRepo: AiChatRepository,
    history: readonly AiChatMessageRecord[],
    signal?: AbortSignal
  ): Promise<Pick<AiChatSessionRecord, "compactedMemorySummary" | "compactedMemoryThroughMessageId"> & { readonly memoryCompacted: boolean }> {
    let session = chatRepo.getSession({
      projectId: input.projectId,
      sessionId: input.sessionId
    });
    const tokenBudget = await this.resolveChatTokenBudget();
    const compactionTarget = selectChatMemoryCompactionTarget({
      history,
      tokenBudget,
      compactedSummary: session.compactedMemorySummary,
      compactedThroughMessageId: session.compactedMemoryThroughMessageId,
      reservedInputTokens: this.estimateChatMemoryReservedInputTokens(input)
    });
    if (!compactionTarget) {
      return {
        compactedMemorySummary: session.compactedMemorySummary,
        compactedMemoryThroughMessageId: session.compactedMemoryThroughMessageId,
        memoryCompacted: false
      };
    }
    if (!this.chatGenerator?.summarizeChatHistoryForMemory) {
      throw new Error("AI 对话历史过长，需要压缩记忆，但对话记忆压缩服务未初始化。");
    }

    const compacted = await this.chatGenerator.summarizeChatHistoryForMemory(
      {
        projectId: input.projectId,
        sessionId: input.sessionId,
        previousSummary: session.compactedMemorySummary,
        messages: compactionTarget.messagesToCompact
      },
      { signal }
    );
    const summary = compacted.summary.trim();
    if (!summary) {
      throw new Error("AI 对话记忆压缩结果为空。");
    }
    session = chatRepo.updateSessionMemory({
      projectId: input.projectId,
      sessionId: input.sessionId,
      summary,
      compactedThroughMessageId: compactionTarget.compactedThroughMessageId
    });
    return {
      compactedMemorySummary: session.compactedMemorySummary,
      compactedMemoryThroughMessageId: session.compactedMemoryThroughMessageId,
      memoryCompacted: true
    };
  }

  private estimateChatMemoryReservedInputTokens(input: AiSendChatMessageStreamInput): number {
    const chapterDirectory = this.resolveChapterRepo
      ? this.resolveChapterRepo(input.projectId)
          .listByProject(input.projectId)
          .map((chapter, index) => {
            const marker = chapter.id === input.chapterId ? " | 当前打开" : "";
            return `${index + 1}. ${chapter.title} | id=${chapter.id} | 字数=${chapter.wordCount}${marker}`;
          })
          .join("\n")
      : "";

    return estimateTextTokens(
      [
        "墨枢中文小说写作 agent 系统提示和工具说明。",
        "用户问题：",
        input.message,
        input.currentChapterTitle ? `当前打开章节：${input.currentChapterTitle}` : "",
        input.selectionText ? `当前选中文本：${input.selectionText}` : "",
        input.chapterExcerpt ? `当前章节节选：${input.chapterExcerpt}` : "",
        chapterDirectory ? `章节目录：\n${chapterDirectory}` : "",
        "最近对话记忆："
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  private async summarizeAgentContext(
    projectId: string,
    message: string,
    resolved: ResolvedChatAgentContext,
    signal?: AbortSignal
  ): Promise<readonly ChatContextSummaryItem[]> {
    if (this.chatGenerator?.summarizeContextBatchForContext) {
      const batches = buildChatContextSummaryBatches(message, resolved.chapters, await this.resolveChatTokenBudget());
      return mapWithConcurrency(batches, 2, async (batch) => {
        if (signal?.aborted) {
          throw new Error("AI 对话已取消。");
        }

        const summary = await this.chatGenerator!.summarizeContextBatchForContext!(
          {
            projectId,
            userMessage: message,
            scopeLabel: resolved.agentContext.scopeLabel,
            chapters: batch.map((chapter) => ({
              chapterId: chapter.content.id,
              title: chapter.content.title,
              ordinal: chapter.ordinal,
              plainText: chapter.content.plainText
            }))
          },
          { signal }
        );
        const trimmed = summary.trim();
        if (!trimmed) {
          const first = batch[0];
          const last = batch.at(-1) ?? first;
          const label = first && last && first.ordinal !== last.ordinal ? `第${first.ordinal}-${last.ordinal}章` : `第${first?.ordinal ?? "未知"}章`;
          throw new Error(`${label}批量摘要为空。`);
        }
        return buildSummaryItemFromBatch(batch, trimmed);
      });
    }

    if (!this.chatGenerator?.summarizeChapterForContext) {
      throw new Error("AI 对话上下文过长，需要摘要压缩，但摘要服务未初始化。");
    }

    const summaries: ChatContextSummaryItem[] = [];
    for (const chapter of resolved.chapters) {
      if (signal?.aborted) {
        throw new Error("AI 对话已取消。");
      }
      const summary = await this.chatGenerator.summarizeChapterForContext(
        {
          projectId,
          chapterId: chapter.content.id,
          title: chapter.content.title,
          ordinal: chapter.ordinal,
          plainText: chapter.content.plainText,
          userMessage: message,
          scopeLabel: resolved.agentContext.scopeLabel
        },
        { signal }
      );
      summaries.push({
        chapterId: chapter.content.id,
        title: chapter.content.title,
        ordinal: chapter.ordinal,
        summary
      });
    }
    return summaries;
  }

  createTask(input: AiCreateTaskInput): AiTaskRecord {
    return this.resolveAiTaskRepo(input.projectId).createTask({
      projectId: input.projectId,
      chapterId: input.chapterId ?? null,
      taskType: input.taskType,
      status: "configured",
      selection: input.selection ?? null,
      inputText: input.inputText,
      instruction: input.instruction ?? null,
      presetId: input.presetId ?? null,
      outputText: null,
      error: null
    });
  }

  updateTask(input: AiUpdateTaskInput): AiTaskRecord {
    return this.resolveAiTaskRepo().updateTask(input.taskId, {
      status: input.patch.status,
      instruction: input.patch.instruction,
      presetId: input.patch.presetId,
      error: input.patch.error
    });
  }

  async generatePreview(input: AiGeneratePreviewInput): Promise<GeneratedPreview> {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const task = aiTaskRepo.findTaskById(input.taskId);
    if (!this.generator) {
      const error = "OpenRouter 服务未初始化，无法生成预览。";
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      throw new Error(error);
    }

    aiTaskRepo.updateTask(task.id, {
      status: "generating",
      error: null
    });

    try {
      const generated = await this.generator.generate(task);
      if (generated.truncated) {
        const error = truncatedTaskError(task);
        aiTaskRepo.updateTask(task.id, {
          status: "failed",
          outputText: generated.generatedText,
          error
        });
        throw new Error(error);
      }
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.proofreadIssues ? generated.changeSummary : generated.generatedText,
        error: null
      });
      return {
        task: updatedTask,
        candidate
      };
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      throw new Error(error);
    }
  }

  async generatePreviewStream(input: AiGeneratePreviewStreamInput, handlers: AiTaskStreamHandlers = {}): Promise<GeneratedPreview> {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const task = aiTaskRepo.findTaskById(input.taskId);
    if (!this.generator?.generateStream) {
      const error = "OpenRouter 流式服务未初始化，无法生成预览。";
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }

    aiTaskRepo.updateTask(task.id, {
      status: "generating",
      error: null
    });

    const abortController = this.registerStream(input.requestId);

    try {
      const generated = await this.generator.generateStream(task, {
        onChunk: (event) => {
          if (task.taskType !== "proofread") {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        }
      }, { signal: abortController.signal });
      if (generated.truncated) {
        const error = truncatedTaskError(task);
        aiTaskRepo.updateTask(task.id, {
          status: "failed",
          outputText: generated.generatedText,
          error
        });
        throw new Error(error);
      }
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.proofreadIssues ? generated.changeSummary : generated.generatedText,
        error: null
      });
      const result = {
        task: updatedTask,
        candidate
      };
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.activeStreams.delete(input.requestId);
    }
  }

  async continuePreviewStream(input: AiGeneratePreviewStreamInput, handlers: AiTaskStreamHandlers = {}): Promise<GeneratedPreview> {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const task = aiTaskRepo.findTaskById(input.taskId);
    const partialText = task.outputText?.trim() ?? "";
    if (!partialText) {
      const error = "没有可继续生成的部分结果。";
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }
    if (task.taskType === "proofread") {
      const error = "校对结果被截断时请缩短选区后重新校对。";
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }
    if (!this.generator?.continueStream) {
      const error = "OpenRouter 继续生成服务未初始化。";
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    }

    aiTaskRepo.updateTask(task.id, {
      status: "generating",
      error: null
    });

    const abortController = this.registerStream(input.requestId);

    try {
      const generated = await this.generator.continueStream(
        task,
        partialText,
        {
          onChunk: (event) => {
            handlers.onChunk?.({ requestId: input.requestId, content: event.content });
          }
        },
        { signal: abortController.signal }
      );
      if (generated.truncated) {
        const error = truncatedTaskError(task);
        aiTaskRepo.updateTask(task.id, {
          status: "failed",
          outputText: generated.generatedText,
          error
        });
        throw new Error(error);
      }
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText: generated.generatedText,
        error: null
      });
      const result = {
        task: updatedTask,
        candidate
      };
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.activeStreams.delete(input.requestId);
    }
  }

  cancelStream(input: { readonly requestId: string }): void {
    const controller = this.activeStreams.get(input.requestId);
    if (!controller) {
      return;
    }
    controller.abort();
    this.activeStreams.delete(input.requestId);
  }

  applyCandidate(input: AiApplyCandidateInput): GeneratedPreview {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const candidate = aiTaskRepo.findCandidateById(input.candidateId);
    const task = aiTaskRepo.findTaskById(candidate.taskId);
    if (task.selection && input.selectionHash !== task.selection.selectionHash) {
      throw new Error("AI 选区校验失败，请重新选择文本后再应用。");
    }

    const inserted = input.applyMode === "insert_below" || input.applyMode === "insert_at_cursor";
    const updatedCandidate = aiTaskRepo.updateCandidateStatus(candidate.id, inserted ? "inserted" : "applied");
    const updatedTask = aiTaskRepo.updateTask(candidate.taskId, {
      status: inserted ? "inserted" : "applied",
      error: null
    });

    return {
      task: updatedTask,
      candidate: updatedCandidate
    };
  }

  saveCandidateToScratchpad(input: AiSaveCandidateToScratchpadInput): GeneratedPreview {
    const aiTaskRepo = this.resolveAiTaskRepo();
    const candidate = aiTaskRepo.updateCandidateStatus(input.candidateId, "inserted_to_scratchpad");
    const task = aiTaskRepo.updateTask(candidate.taskId, {
      status: "saved_to_scratchpad",
      error: null
    });

    return {
      task,
      candidate
    };
  }

  async sendChatMessage(input: AiSendChatMessageInput): Promise<AiChatMessageResult> {
    if (!this.chatGenerator) {
      throw new Error("OpenRouter 对话服务未初始化。");
    }

    if (!input.projectId) {
      return this.chatGenerator.sendMessage(input);
    }

    const chatRepo = this.getAiChatRepo(input.projectId);
    const session = chatRepo.getOrCreateDefaultSession(input.projectId);
    const sessionId = input.sessionId ?? session.id;

    chatRepo.createMessage({
      projectId: input.projectId,
      sessionId,
      role: "user",
      content: input.message,
      action: null
    });
    chatRepo.renameSessionFromFirstMessage({
      projectId: input.projectId,
      sessionId,
      message: input.message
    });

    try {
      const generationInput = this.resolveReferencedChapterInput({
        ...input,
        projectId: input.projectId,
        sessionId
      });
      const streamLikeInput = {
        projectId: input.projectId,
        sessionId,
        requestId: `chat_non_stream_${Date.now()}`,
        message: generationInput.message,
        chapterId: generationInput.chapterId,
        currentChapterTitle: generationInput.currentChapterTitle,
        selectionText: generationInput.selectionText,
        chapterExcerpt: generationInput.chapterExcerpt
      } satisfies AiSendChatMessageStreamInput;
      const generated = await this.chatGenerator.sendMessage(generationInput);
      const assistantMessage = chatRepo.createMessage({
        projectId: input.projectId,
        sessionId,
        role: "assistant",
        content: generated.content,
        action: {
          type: "none"
        }
      });
      const action = this.chatActionService?.executeSafeActionFromChat(streamLikeInput, generated.content) ?? null;
      if (action) {
        chatRepo.createMessage({
          projectId: input.projectId,
          sessionId,
          role: "tool",
          content: "已加入草稿纸。",
          action
        });
      }
      return {
        role: "assistant",
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt
      };
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : String(reason);
      chatRepo.createMessage({
        projectId: input.projectId,
        sessionId,
        role: "error",
        content: error,
        action: null
      });
      throw new Error(error);
    }
  }

  getChatSession(input: AiGetChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).getOrCreateDefaultSession(input.projectId);
  }

  listChatSessions(input: AiListChatSessionsInput): AiChatSessionRecord[] {
    return this.getAiChatRepo(input.projectId).listSessions(input.projectId);
  }

  createChatSession(input: AiCreateChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).createSession(input);
  }

  renameChatSession(input: AiRenameChatSessionInput): AiChatSessionRecord {
    return this.getAiChatRepo(input.projectId).renameSession(input);
  }

  deleteChatSession(input: AiDeleteChatSessionInput): void {
    this.getAiChatRepo(input.projectId).deleteSession(input);
  }

  listChatMessages(input: AiListChatMessagesInput): AiChatMessageRecord[] {
    return this.getAiChatRepo(input.projectId).listMessages(input);
  }

  clearChat(input: AiClearChatInput): void {
    this.getAiChatRepo(input.projectId).clearSession(input);
  }

  async sendChatMessageStream(input: AiSendChatMessageStreamInput, handlers: AiChatStreamHandlers = {}): Promise<AiChatStreamResult> {
    const chatRepo = this.getAiChatRepo(input.projectId);
    const history = chatRepo.listMessages({
      projectId: input.projectId,
      sessionId: input.sessionId
    });
    const userMessage = chatRepo.createMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      role: "user",
      content: input.message,
      action: null
    });
    chatRepo.renameSessionFromFirstMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: input.message
    });

    const fail = (error: string): never => {
      chatRepo.createMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "error",
        content: error,
        action: null
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    };

    if (!this.chatGenerator?.sendMessageStream && !this.chatGenerator?.sendAgentMessageStream) {
      return fail("OpenRouter 对话流式服务未初始化。");
    }

    const abortController = this.registerStream(input.requestId);

    try {
      const memory = await this.compactChatMemoryIfNeeded(input, chatRepo, history, abortController.signal);
      const toolCallAgentInput = await this.buildToolCallAgentGenerationInput(input, history, memory, abortController.signal);
      const legacyAgenticGeneration = toolCallAgentInput ? null : await this.buildAgenticChatGenerationInput(input, history, memory, abortController.signal);
      const generationInput =
        toolCallAgentInput ??
        legacyAgenticGeneration?.generationInput ?? {
          ...this.resolveReferencedChapterInput(input),
          history,
          compactedMemorySummary: memory.compactedMemorySummary,
          compactedMemoryThroughMessageId: memory.compactedMemoryThroughMessageId
        };
      const streamHandlers = {
        onChunk: (event: { readonly content: string }) => {
          handlers.onChunk?.({ requestId: input.requestId, content: event.content });
        },
        onReasoning: (event: { readonly content: string }) => {
          handlers.onReasoning?.({ requestId: input.requestId, content: event.content });
        },
        onContext: (event: Parameters<NonNullable<AiChatStreamHandlers["onContext"]>>[0]) => {
          const previousUsage = chatRepo.getSession({
            projectId: input.projectId,
            sessionId: input.sessionId
          }).lastContextUsage;
          const contextUsage = mergeSessionContextUsage(previousUsage, { ...event, requestId: input.requestId }, { allowDecrease: memory.memoryCompacted });
          chatRepo.updateSessionContextUsage({
            projectId: input.projectId,
            sessionId: input.sessionId,
            contextUsage
          });
          handlers.onContext?.(contextUsage);
        }
      } satisfies AiChatStreamHandlers;
      const generated = toolCallAgentInput
        ? await this.chatGenerator.sendAgentMessageStream!(toolCallAgentInput, streamHandlers, { signal: abortController.signal })
        : await this.chatGenerator.sendMessageStream!(generationInput, streamHandlers, { signal: abortController.signal });
      const assistantMessage = chatRepo.createMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: generated.content,
        action: {
          type: "none"
        }
      });
      const action =
        generated.actions?.[0] ??
        (legacyAgenticGeneration
          ? this.chatActionService?.executePlannedActionFromChat(generationInput, legacyAgenticGeneration.plan, generated.content) ?? null
          : toolCallAgentInput
            ? null
            : this.chatActionService?.executeSafeActionFromChat(generationInput, generated.content) ?? null);
      const toolMessage = action
        ? chatRepo.createMessage({
            projectId: input.projectId,
            sessionId: input.sessionId,
            role: "tool",
            content: "已加入草稿纸。",
            action
          })
        : null;
      const result = {
        messages: toolMessage ? [userMessage, assistantMessage, toolMessage] : [userMessage, assistantMessage],
        action
      };
      const finalContextUsage = advanceSessionContextUsageAfterAnswer(
        chatRepo.getSession({
          projectId: input.projectId,
          sessionId: input.sessionId
        }).lastContextUsage,
        input,
        generated.content
      );
      if (finalContextUsage) {
        chatRepo.updateSessionContextUsage({
          projectId: input.projectId,
          sessionId: input.sessionId,
          contextUsage: finalContextUsage
        });
        handlers.onContext?.(finalContextUsage);
      }
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      if (abortController.signal.aborted || isCancellationReason(reason)) {
        return {
          messages: [userMessage],
          action: null
        };
      }
      return fail(reason instanceof Error ? reason.message : String(reason));
    } finally {
      this.activeStreams.delete(input.requestId);
    }
  }

  rejectCandidate(input: AiRejectCandidateInput): AiTaskCandidateRecord {
    return this.resolveAiTaskRepo().updateCandidateStatus(input.candidateId, "rejected");
  }

  private registerStream(requestId: string): AbortController {
    this.cancelStream({ requestId });
    const abortController = new AbortController();
    this.activeStreams.set(requestId, abortController);
    return abortController;
  }
}
