import {
  buildChatContextSummaryBatches,
  buildSummarizedAgentContextFromItems,
  buildSummaryItemFromBatch,
  isChatAgentContextTooLarge,
  resolveChatAgentContext,
  type ResolvedChatAgentContext
} from "./chat-agent-context";
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
import { isOpenRouterCanceledError } from "./openrouter-error";
import type {
  NovelAgentRunInput,
  NovelAgentRunOptions,
  NovelAgentRunResult,
  NovelAgentRuntime,
  NovelAgentRuntimeHandlers,
  NovelAgentToolDefinition
} from "./agent-runtime/novel-agent-runtime";
import { LegacyNovelAgentRuntime } from "./agent-runtime/legacy-novel-agent-runtime";
import type { ContinuityCheckInput } from "./summary-prompts";
import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import { WritingOperationRunner } from "./writing-operation-runner";
import type { WritingOperationOutputKind, WritingOperationResult, WritingOperationTarget } from "./writing-operation-types";
import type { AiChatRepository } from "../db/repositories/ai-chat-repo";
import { AiTaskRepository } from "../db/repositories/ai-task-repo";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ScratchNoteRepository } from "../db/repositories/scratch-note-repo";
import type { SummaryRepository } from "../db/repositories/summary-repo";
import type { ProofreadIssue } from "../shared/proofread";
import type { ContinuityCheckResult } from "../shared/summary-index";
import { getTokenBudget, type TokenBudget } from "./token-budget";
import { DEFAULT_CONTENT_LANGUAGE, resolveResponseLanguage, type ContentLanguage } from "../shared/language";
import type {
  AiAgentActivityRecord,
  AiApplyCandidateInput,
  AiChatAction,
  AiChatMessageRecord,
  AiChatSessionRecord,
  AiClearChatInput,
  AiCreateChatSessionInput,
  AiCreateTaskInput,
  AiDeleteChatSessionInput,
  AiGeneratePreviewStreamInput,
  AiGetChatSessionInput,
  AiListChatSessionsInput,
  AiListChatMessagesInput,
  AiRegenerateChatMessageStreamInput,
  AiRenameChatSessionInput,
  AiRejectCandidateInput,
  AiSaveCandidateToScratchpadInput,
  AiSendChatMessageStreamInput,
  AiStreamContextEvent,
  AiTaskCandidateRecord,
  AiTaskRecord,
  TaskType,
  AiUpdateTaskInput
} from "../shared/types";

export type AiTaskGenerationResult = {
  readonly generatedText: string;
  readonly changeSummary: string | null;
  readonly proofreadIssues?: readonly ProofreadIssue[] | null;
  readonly contextPlan?: AiTaskCandidateRecord["writingContextPlan"];
  readonly truncated?: boolean;
};

export type AiGenerationOptions = NovelAgentRunOptions;

function formatChatWritingOperationTitle(operation: TaskType, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): string {
  if (language === "ja-JP") {
    if (operation === "expand") return "加筆案";
    if (operation === "continue") return "続きの本文";
    if (operation === "proofread") return "校正結果";
    return "推敲案";
  }
  if (operation === "expand") {
    return "扩写稿";
  }
  if (operation === "continue") {
    return "续写稿";
  }
  if (operation === "proofread") {
    return "校对结果";
  }
  return "润色稿";
}

export type AiTaskGenerator = {
  readonly generateStream?: (task: AiTaskRecord, handlers: AiTaskStreamHandlers, options?: AiGenerationOptions) => Promise<AiTaskGenerationResult>;
  readonly continueStream?: (
    task: AiTaskRecord,
    partialText: string,
    handlers: AiTaskStreamHandlers,
    options?: AiGenerationOptions
  ) => Promise<AiTaskGenerationResult>;
};

export type AiChatMessageResult = NovelAgentRunResult;

export type AiChatStreamExecutionOptions = {
  readonly allowActions?: boolean;
  readonly allowTools?: boolean;
  readonly allowAutoChapterContext?: boolean;
  readonly includeHistory?: boolean;
};

export type AiChatGenerationInput = AiSendChatMessageStreamInput & {
  readonly history: readonly AiChatMessageRecord[];
  readonly agentContext?: ChatAgentContext;
  readonly compactedMemorySummary?: string | null;
  readonly compactedMemoryThroughMessageId?: string | null;
};

export type AiChatAgentGenerationInput = NovelAgentRunInput;

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
  readonly sendMessageStream?: (input: AiChatGenerationInput, handlers: AiChatStreamHandlers, options?: AiGenerationOptions) => Promise<AiChatMessageResult>;
  readonly sendAgentMessageStream?: (
    input: AiChatAgentGenerationInput,
    handlers: NovelAgentRuntimeHandlers,
    options?: AiGenerationOptions
  ) => Promise<AiChatMessageResult>;
  readonly summarizeChapterForContext?: (input: ChatChapterSummaryInput, options?: AiGenerationOptions) => Promise<string>;
  readonly summarizeContextBatchForContext?: (input: ChatContextBatchSummaryInput, options?: AiGenerationOptions) => Promise<string>;
  readonly mergeContextSummaries?: (input: ChatContextSummaryMergeInput, options?: AiGenerationOptions) => Promise<string>;
  readonly summarizeChatHistoryForMemory?: (
    input: AiChatHistoryMemorySummaryInput,
    options?: AiGenerationOptions
  ) => Promise<AiChatHistoryMemorySummaryResult>;
  readonly checkContinuity?: (input: ContinuityCheckInput, options?: AiGenerationOptions) => Promise<ContinuityCheckResult>;
};

type GeneratedPreview = {
  readonly task: AiTaskRecord;
  readonly candidate: AiTaskCandidateRecord;
};

export type AiTaskStreamHandlers = {
  readonly onChunk?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onReasoning?: (event: { readonly requestId: string; readonly content: string }) => void;
  readonly onContext?: (event: AiStreamContextEvent) => void;
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
  readonly onActivity?: (event: { readonly requestId: string; readonly activity: AiAgentActivityRecord }) => void;
  readonly onContext?: (event: {
    readonly requestId: string;
    readonly estimatedInputTokens: number;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly modelContextTokens: number | null;
    readonly modelName: string;
    readonly contextMode: "direct" | "summarized" | "mixed";
    readonly scopeLabel: string;
    readonly indexMode?: AiStreamContextEvent["indexMode"];
    readonly indexedChapterCount?: number;
    readonly totalChapterCount?: number;
    readonly staleChapterCount?: number;
    readonly skippedTooShortChapterCount?: number;
  }) => void;
  readonly onDone?: (event: { readonly requestId: string; readonly payload: AiChatStreamResult }) => void;
  readonly onError?: (event: { readonly requestId: string; readonly error: string }) => void;
};

function toNovelAgentToolDefinition(tool: (typeof MOSHU_CHAT_AGENT_TOOLS)[number]): NovelAgentToolDefinition {
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters
  };
}

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
type ContentLanguageResolver = (projectId: string) => ContentLanguage;
type ChapterRepositoryResolver = (projectId: string) => ChapterRepository;
type SummaryRepositoryResolver = (projectId: string) => SummaryRepository;
type ChatTokenBudgetResolver = () => TokenBudget | Promise<TokenBudget>;

function truncatedTaskError(task: AiTaskRecord): string {
  return task.taskType === "proofread"
    ? "校对结果被截断。请缩短选区，或换用输出额度更高的模型后重试。"
    : "AI 输出被截断。已保留部分结果，请点击继续生成或缩短选区后重试。";
}

function isCancellationReason(reason: unknown): boolean {
  if (isOpenRouterCanceledError(reason)) {
    return true;
  }
  if (!reason || typeof reason !== "object") {
    return String(reason) === "canceled";
  }

  const record = reason as { readonly code?: unknown; readonly isCanceled?: unknown; readonly message?: unknown; readonly name?: unknown };
  return (
    record.isCanceled === true ||
    record.code === "canceled" ||
    record.code === "ERR_CANCELED" ||
    record.name === "AbortError" ||
    record.name === "CanceledError" ||
    record.message === "canceled" ||
    record.message === "AI 对话已取消。" ||
    record.message === "AI 任务已取消。"
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

function mergeSessionContextUsage(previous: AiStreamContextEvent | null, next: AiStreamContextEvent): AiStreamContextEvent {
  if (!previous || !isSameContextMeterModel(previous, next)) {
    return next;
  }
  if (next.estimatedInputTokens >= previous.estimatedInputTokens) {
    return next;
  }

  return {
    ...next,
    estimatedInputTokens: previous.estimatedInputTokens,
    contextMode: next.contextMode,
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
    memoryCompactedThisRun: false,
    scopeLabel: "会话背景窗口"
  };
}

function inferChatIntent(message: string): ChatAgentPlan["intent"] {
  const normalized = message.replace(/\s+/g, "");
  if (/校对|错别字|病句|校正|誤字|脱字|文法/.test(normalized)) {
    return "proofread";
  }
  if (/改写|重写|润色|推敲|リライト|書き直/.test(normalized)) {
    return "rewrite_suggest";
  }
  if (/整理|梳理|归纳|まとめ直|整理して/.test(normalized)) {
    return "organize";
  }
  if (/总结|摘要|概括|提炼|要約|あらすじ|まとめて/.test(normalized)) {
    return "summarize";
  }
  if (/分析|节奏|人物|动机|伏笔|矛盾|逻辑|テンポ|登場人物|動機|伏線|矛盾|論理/.test(normalized)) {
    return "analyze";
  }
  return "answer";
}

function inferSafeChatActions(message: string): ChatAgentPlan["actions"] {
  const normalized = message.replace(/\s+/g, "");
  if (
    (/(草稿纸|草稿|素材)/.test(normalized) && /(加入|保存|存到|放到|记录)/.test(normalized)) ||
    (/(下書きメモ|下書き|メモ|素材)/.test(normalized) && /(追加|保存|入れて|記録|残して)/.test(normalized))
  ) {
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
  return /^(同时|顺便|另外|还有|也|并且|然后|再|继续|同样|同時に|ついでに|それと|さらに|続けて|同様に|また)/.test(normalized) || /(同时|顺便|另外|还有|也要|也请|并且|同時に|ついでに|それも|こちらも)/.test(normalized);
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
  private readonly resolveSummaryRepo?: SummaryRepositoryResolver;
  private readonly agentRuntime?: NovelAgentRuntime;
  private readonly activeStreams = new Map<string, AbortController>();

  constructor(
    aiTaskRepo: AiTaskRepository | AiTaskRepositoryResolver,
    private readonly generator?: AiTaskGenerator,
    private readonly chatGenerator?: AiChatGenerator,
    aiChatRepo?: AiChatRepository | AiChatRepositoryResolver,
    scratchRepo?: ScratchNoteRepository | ScratchNoteRepositoryResolver,
    chapterRepo?: ChapterRepository | ChapterRepositoryResolver,
    private readonly chatPlanner?: ChatPlanner,
    private readonly resolveChatTokenBudget: ChatTokenBudgetResolver = () => getTokenBudget("chat"),
    private readonly writingOperationRunner?: WritingOperationRunner,
    summaryRepo?: SummaryRepository | SummaryRepositoryResolver,
    agentRuntime?: NovelAgentRuntime,
    private readonly resolveContentLanguage: ContentLanguageResolver = () => DEFAULT_CONTENT_LANGUAGE
  ) {
    this.resolveAiTaskRepo = typeof aiTaskRepo === "function" ? aiTaskRepo : () => aiTaskRepo;
    this.resolveAiChatRepo = aiChatRepo ? (typeof aiChatRepo === "function" ? aiChatRepo : () => aiChatRepo) : undefined;
    this.resolveChapterRepo = chapterRepo ? (typeof chapterRepo === "function" ? chapterRepo : () => chapterRepo) : undefined;
    this.resolveScratchRepo = scratchRepo ? (typeof scratchRepo === "function" ? scratchRepo : () => scratchRepo) : undefined;
    this.resolveSummaryRepo = summaryRepo ? (typeof summaryRepo === "function" ? summaryRepo : () => summaryRepo) : undefined;
    this.agentRuntime =
      agentRuntime ??
      (chatGenerator?.sendAgentMessageStream
        ? new LegacyNovelAgentRuntime({ sendAgentMessageStream: chatGenerator.sendAgentMessageStream.bind(chatGenerator) })
        : undefined);
  }

  private getAiChatRepo(projectId: string): AiChatRepository {
    if (!this.resolveAiChatRepo) {
      throw new Error("AI 对话存储未初始化。");
    }

    return this.resolveAiChatRepo(projectId);
  }

  private resolveReferencedChapterInput<T extends AiSendChatMessageStreamInput>(input: T): T {
    if (!input.projectId || !this.resolveChapterRepo) {
      return input;
    }

    return enrichChatInputWithReferencedChapter(input, this.resolveChapterRepo(input.projectId));
  }

  private async resolveChatAgentPlan(
    input: AiSendChatMessageStreamInput,
    history: readonly AiChatMessageRecord[],
    signal?: AbortSignal,
    options: { readonly allowPlanner?: boolean } = {}
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

    if (options.allowPlanner === false || !this.chatPlanner) {
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
    signal?: AbortSignal,
    options: { readonly allowPlanner?: boolean } = {}
  ): Promise<{ readonly generationInput: AiChatGenerationInput; readonly plan: ChatAgentPlan } | null> {
    const plan = await this.resolveChatAgentPlan(input, history, signal, options);
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
      chatBudget,
      { summaryRepo: this.resolveSummaryRepo?.(input.projectId) }
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
      const chatGenerator = this.chatGenerator;
      if (!chatGenerator?.mergeContextSummaries) {
        throw new Error("AI 对话分章摘要仍然过长，需要聚合摘要，但聚合摘要服务未初始化。");
      }
      const mergedSummary = await chatGenerator.mergeContextSummaries(
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
        const textBudget = Math.max(0, chatBudget.maxInputTokens - estimateTextTokens(message) - 900);
        agentContext = {
          ...agentContext,
          contextText: `${truncateTextToTokenBudget(agentContext.contextText, textBudget).text.trim()}\n（聚合摘要已按当前模型窗口压缩；需要完整细节时请缩小章节范围继续追问。）`
        };
      }
    }

    return agentContext;
  }

  private async buildToolCallAgentGenerationInput(
    input: AiSendChatMessageStreamInput,
    history: readonly AiChatMessageRecord[],
    memory: Pick<AiChatSessionRecord, "compactedMemorySummary" | "compactedMemoryThroughMessageId">,
    signal?: AbortSignal,
    streamHandlers?: AiChatStreamHandlers,
    options: AiChatStreamExecutionOptions = {}
  ): Promise<AiChatAgentGenerationInput | null> {
    if (!this.agentRuntime || !this.resolveChapterRepo) {
      return null;
    }

    const chapterRepo = this.resolveChapterRepo(input.projectId);
    const chapters = chapterRepo.listByProject(input.projectId);
    const currentChapter = input.chapterId ? chapters.find((chapter) => chapter.id === input.chapterId) : null;
    const tokenBudget = await this.resolveChatTokenBudget();
    const allowedActions = options.allowActions === false ? [] : inferSafeChatActions(input.message).map((action) => action.type);
    const scratchRepo = this.resolveScratchRepo?.(input.projectId);
    const summaryRepo = this.resolveSummaryRepo?.(input.projectId);
    const checkContinuity = this.chatGenerator?.checkContinuity?.bind(this.chatGenerator);
    const runtimeBase = {
      projectId: input.projectId,
      currentChapterId: currentChapter?.id ?? input.chapterId,
      selectionText: input.selectionText,
      userMessage: input.message,
      chapterRepo,
      summaryRepo,
      scratchRepo,
      tokenBudget,
      signal,
      allowedActions,
      executeContinuityCheck: checkContinuity ? async (request: ContinuityCheckInput) => checkContinuity(request, { signal }) : undefined,
      executeWritingOperation: async (request: { readonly operation: TaskType; readonly target: WritingOperationTarget; readonly instruction: string }) => {
        const result = await this.runChatWritingOperation({
          projectId: input.projectId,
          operation: request.operation,
          target: request.target,
          instruction: request.instruction,
          presentationLanguage: resolveResponseLanguage(input.message, this.resolveContentLanguage(input.projectId)),
          signal,
          streamHandlers
        });
        const outputKind: WritingOperationOutputKind = request.operation === "proofread" ? "proofread_issues" : "candidate_text";
        return {
          operation: request.operation,
          outputKind,
          generatedText: result.generatedText,
          changeSummary: result.changeSummary,
          proofreadIssues: result.proofreadIssues ?? null,
          contextPlan: result.contextPlan,
          streamedPresentation: result.streamedPresentation === true
        };
      },
      summarizeResolvedContext: async (resolved: ResolvedChatAgentContext, summarizeSignal?: AbortSignal): Promise<ChatAgentContext> =>
        this.compressResolvedAgentContext(input.projectId, input.message, resolved, tokenBudget, summarizeSignal)
    };

    return {
      ...input,
      contentLanguage: this.resolveContentLanguage(input.projectId),
      responseLanguage: resolveResponseLanguage(input.message, this.resolveContentLanguage(input.projectId)),
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
      tools:
        options.allowTools === false
          ? []
          : MOSHU_CHAT_AGENT_TOOLS.filter((tool) => {
              if (tool.function.name === "add_to_scratchpad") {
                return allowedActions.includes("add_to_scratchpad");
              }
              return true;
            }).map(toNovelAgentToolDefinition),
      executeTool: (call) =>
        executeChatAgentToolWithAction({
          name: call.name,
          argumentsJson: call.argumentsJson,
          runtime: runtimeBase
        })
    };
  }

  private async runChatWritingOperation(input: {
    readonly projectId: string;
    readonly operation: TaskType;
    readonly target: WritingOperationTarget;
    readonly instruction: string;
    readonly presentationLanguage: ContentLanguage;
    readonly signal?: AbortSignal;
    readonly streamHandlers?: AiChatStreamHandlers;
  }): Promise<WritingOperationResult & { readonly streamedPresentation?: boolean }> {
    if (!this.writingOperationRunner) {
      throw new Error("写作操作服务未初始化。");
    }
    const outputKind: WritingOperationOutputKind = input.operation === "proofread" ? "proofread_issues" : "candidate_text";
    const shouldStreamToChat = outputKind === "candidate_text" && Boolean(input.streamHandlers?.onChunk);
    let streamedTitle = false;
    const streamTitleOnce = (): void => {
      if (!shouldStreamToChat || streamedTitle) {
        return;
      }
      streamedTitle = true;
      input.streamHandlers?.onChunk?.({
        requestId: "",
        content: `【${formatChatWritingOperationTitle(input.operation, input.presentationLanguage)}】\n`
      });
    };
    const result = await this.writingOperationRunner.runRequest(
      {
        projectId: input.projectId,
        source: "chat_tool",
        operation: input.operation,
        target: input.target,
        userInstruction: input.instruction,
        preset: null
      },
      { signal: input.signal },
      shouldStreamToChat
        ? {
            onChunk: (event) => {
              streamTitleOnce();
              input.streamHandlers?.onChunk?.({
                requestId: "",
                content: event.content
              });
            },
            onReasoning: (event) => {
              input.streamHandlers?.onReasoning?.({
                requestId: "",
                content: event.content
              });
            },
            onContext: input.streamHandlers?.onContext
          }
        : {
            onReasoning: (event) => {
              input.streamHandlers?.onReasoning?.({
                requestId: "",
                content: event.content
              });
            },
            onContext: input.streamHandlers?.onContext
          }
    );
    return {
      ...result,
      streamedPresentation: shouldStreamToChat
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
        },
        onContext: (event) => {
          handlers.onContext?.({ ...event, requestId: input.requestId });
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
      const result = this.createPreviewResult(aiTaskRepo, task, generated, generated.proofreadIssues ? generated.changeSummary : generated.generatedText);
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      if (abortController.signal.aborted || isCancellationReason(reason)) {
        aiTaskRepo.updateTask(task.id, {
          status: task.status,
          outputText: task.outputText,
          error: task.error
        });
        throw new Error("AI 任务已取消。");
      }
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.unregisterStreamIfCurrent(input.requestId, abortController);
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
          },
          onContext: (event) => {
            handlers.onContext?.({ ...event, requestId: input.requestId });
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
      const result = this.createPreviewResult(aiTaskRepo, task, generated, generated.generatedText);
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      if (abortController.signal.aborted || isCancellationReason(reason)) {
        aiTaskRepo.updateTask(task.id, {
          status: task.status,
          outputText: task.outputText,
          error: task.error
        });
        throw new Error("AI 任务已取消。");
      }
      const error = reason instanceof Error ? reason.message : String(reason);
      aiTaskRepo.updateTask(task.id, {
        status: "failed",
        error
      });
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.unregisterStreamIfCurrent(input.requestId, abortController);
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

  hasActiveStreams(): boolean {
    return this.activeStreams.size > 0;
  }

  applyCandidate(input: AiApplyCandidateInput): GeneratedPreview {
    const aiTaskRepo = this.resolveAiTaskRepo(input.projectId);
    const candidate = aiTaskRepo.findCandidateById(input.candidateId);
    const task = aiTaskRepo.findTaskById(candidate.taskId);
    if (task.projectId !== input.projectId) {
      throw new Error("AI 候选不属于当前项目。");
    }
    if (task.selection && input.selectionHash !== task.selection.selectionHash) {
      throw new Error("AI 选区校验失败，请重新选择文本后再应用。");
    }

    return aiTaskRepo.transact(() => {
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
    });
  }

  saveCandidateToScratchpad(input: AiSaveCandidateToScratchpadInput): GeneratedPreview {
    const aiTaskRepo = this.resolveAiTaskRepo(input.projectId);
    return aiTaskRepo.transact(() => {
      const existingCandidate = aiTaskRepo.findCandidateById(input.candidateId);
      const existingTask = aiTaskRepo.findTaskById(existingCandidate.taskId);
      if (existingTask.projectId !== input.projectId) {
        throw new Error("AI 候选不属于当前项目。");
      }
      const candidate = aiTaskRepo.updateCandidateStatus(input.candidateId, "inserted_to_scratchpad");
      const task = aiTaskRepo.updateTask(candidate.taskId, {
        status: "saved_to_scratchpad",
        error: null
      });

      return {
        task,
        candidate
      };
    });
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

  private async generateChatAnswerStream(
    input: AiSendChatMessageStreamInput,
    chatRepo: AiChatRepository,
    history: readonly AiChatMessageRecord[],
    abortController: AbortController,
    handlers: AiChatStreamHandlers,
    options: AiChatStreamExecutionOptions = {}
  ): Promise<{
    readonly content: string;
    readonly assistantAction: AiChatAction | null;
    readonly action: AiChatAction | null;
    readonly activities: readonly AiAgentActivityRecord[];
  }> {
    let memoryContextState: Pick<AiStreamContextEvent, "memoryCompacted" | "memoryCompactedThisRun"> = {
      memoryCompacted: false,
      memoryCompactedThisRun: false
    };
    const streamHandlers = {
      onChunk: (event: { readonly content: string }) => {
        handlers.onChunk?.({ requestId: input.requestId, content: event.content });
      },
      onActivity: (event: { readonly activity: AiAgentActivityRecord }) => {
        handlers.onActivity?.({ requestId: input.requestId, activity: event.activity });
      },
      onContext: (event: Parameters<NonNullable<AiChatStreamHandlers["onContext"]>>[0]) => {
        const previousUsage = chatRepo.getSession({
          projectId: input.projectId,
          sessionId: input.sessionId
        }).lastContextUsage;
        const contextUsage = mergeSessionContextUsage(previousUsage, { ...event, ...memoryContextState, requestId: input.requestId });
        chatRepo.updateSessionContextUsage({
          projectId: input.projectId,
          sessionId: input.sessionId,
          contextUsage
        });
        handlers.onContext?.(contextUsage);
      }
    } satisfies AiChatStreamHandlers;
    const memory = await this.compactChatMemoryIfNeeded(input, chatRepo, history, abortController.signal);
    memoryContextState = {
      memoryCompacted: Boolean(memory.compactedMemorySummary),
      memoryCompactedThisRun: memory.memoryCompacted
    };
    let legacyAgenticGeneration: Awaited<ReturnType<AiTaskService["buildAgenticChatGenerationInput"]>> = null;
    if (options.allowAutoChapterContext !== false) {
      try {
        legacyAgenticGeneration = await this.buildAgenticChatGenerationInput(input, history, memory, abortController.signal, { allowPlanner: false });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (!message.includes("当前没有打开章节") && !message.includes("找不到第")) {
          throw reason;
        }
      }
    }
    const toolCallAgentBaseInput = await this.buildToolCallAgentGenerationInput(input, history, memory, abortController.signal, streamHandlers, {
      allowActions: options.allowActions,
      allowTools: options.allowTools
    });
    if (!toolCallAgentBaseInput) {
      throw new Error("AI 对话工具调用上下文服务未初始化。");
    }
    const toolCallAgentInput = legacyAgenticGeneration
      ? {
          ...toolCallAgentBaseInput,
          chapterId: legacyAgenticGeneration.generationInput.chapterId,
          currentChapterTitle: legacyAgenticGeneration.generationInput.currentChapterTitle,
          chapterExcerpt: legacyAgenticGeneration.generationInput.chapterExcerpt,
          agentContext: legacyAgenticGeneration.generationInput.agentContext
        }
      : toolCallAgentBaseInput;
    const generated = await this.agentRuntime?.run(toolCallAgentInput, streamHandlers, { signal: abortController.signal });
    if (!generated) {
      throw new Error("OpenRouter 对话工具调用服务未初始化。");
    }
    if (options.allowActions === false && generated.actions?.length) {
      throw new Error("重新生成暂不执行草稿纸等工具操作。");
    }
    const action = generated.actions?.[0] ?? null;
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

    return {
      content: generated.content,
      assistantAction: {
        type: "none"
      },
      action,
      activities: generated.activities ?? []
    };
  }

  async sendChatMessageStream(
    input: AiSendChatMessageStreamInput,
    handlers: AiChatStreamHandlers = {},
    options: AiChatStreamExecutionOptions = {}
  ): Promise<AiChatStreamResult> {
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

    if (!this.agentRuntime) {
      return fail("OpenRouter 对话工具调用服务未初始化。");
    }

    const abortController = this.registerStream(input.requestId);

    try {
      const generationHistory = options.includeHistory === false ? [] : history;
      const generated = await this.generateChatAnswerStream(input, chatRepo, generationHistory, abortController, handlers, options);
      const assistantMessage = chatRepo.createMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: generated.content,
        action: generated.assistantAction,
        activities: generated.activities
      });
      const toolMessage = generated.action
        ? chatRepo.createMessage({
            projectId: input.projectId,
            sessionId: input.sessionId,
            role: "tool",
            content: "已加入草稿纸。",
            action: generated.action
          })
        : null;
      const result = {
        messages: toolMessage ? [userMessage, assistantMessage, toolMessage] : [userMessage, assistantMessage],
        action: generated.action
      };
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
      this.unregisterStreamIfCurrent(input.requestId, abortController);
    }
  }

  async regenerateChatMessageStream(input: AiRegenerateChatMessageStreamInput, handlers: AiChatStreamHandlers = {}): Promise<AiChatStreamResult> {
    const chatRepo = this.getAiChatRepo(input.projectId);
    const messages = chatRepo.listMessages({
      projectId: input.projectId,
      sessionId: input.sessionId
    });
    const targetIndex = messages.findIndex((message) => message.id === input.assistantMessageId);
    if (targetIndex < 0) {
      throw new Error("AI 回复不存在，无法重新生成。");
    }
    const targetMessage = messages[targetIndex];
    if (targetMessage.role !== "assistant") {
      throw new Error("只能重新生成 AI 回复。");
    }
    const nextMessage = messages[targetIndex + 1];
    if (nextMessage?.role === "tool") {
      throw new Error("带有工具结果的 AI 回复暂不能重新生成。");
    }
    if (nextMessage) {
      throw new Error("只能重新生成最新的 AI 回复。");
    }
    const userMessageIndex = targetIndex - 1;
    const userMessage = messages[userMessageIndex];
    if (!userMessage || userMessage.role !== "user") {
      throw new Error("找不到这条 AI 回复对应的用户消息。");
    }
    if (inferSafeChatActions(userMessage.content).length > 0) {
      throw new Error("包含草稿纸等工具操作的 AI 回复暂不能重新生成。");
    }

    const generationInput: AiSendChatMessageStreamInput = {
      requestId: input.requestId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: userMessage.content,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.currentChapterTitle ? { currentChapterTitle: input.currentChapterTitle } : {}),
      ...(input.selectionText ? { selectionText: input.selectionText } : {}),
      ...(input.chapterExcerpt ? { chapterExcerpt: input.chapterExcerpt } : {})
    };
    const history = messages.slice(0, userMessageIndex);
    const abortController = this.registerStream(input.requestId);

    try {
      const generated = await this.generateChatAnswerStream(generationInput, chatRepo, history, abortController, handlers, {
        allowActions: false
      });
      const assistantMessage = chatRepo.updateAssistantMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        content: generated.content,
        action: generated.assistantAction,
        activities: generated.activities
      });
      const result = {
        messages: [assistantMessage],
        action: null
      };
      handlers.onDone?.({ requestId: input.requestId, payload: result });
      return result;
    } catch (reason) {
      if (abortController.signal.aborted || isCancellationReason(reason)) {
        return {
          messages: [targetMessage],
          action: null
        };
      }
      const error = reason instanceof Error ? reason.message : String(reason);
      handlers.onError?.({ requestId: input.requestId, error });
      throw new Error(error);
    } finally {
      this.unregisterStreamIfCurrent(input.requestId, abortController);
    }
  }

  rejectCandidate(input: AiRejectCandidateInput): AiTaskCandidateRecord {
    const aiTaskRepo = this.resolveAiTaskRepo(input.projectId);
    return aiTaskRepo.transact(() => {
      const candidate = aiTaskRepo.findCandidateById(input.candidateId);
      const task = aiTaskRepo.findTaskById(candidate.taskId);
      if (task.projectId !== input.projectId) {
        throw new Error("AI 候选不属于当前项目。");
      }
      return aiTaskRepo.updateCandidateStatus(input.candidateId, "rejected");
    });
  }

  private registerStream(requestId: string): AbortController {
    this.cancelStream({ requestId });
    const abortController = new AbortController();
    this.activeStreams.set(requestId, abortController);
    return abortController;
  }

  private createPreviewResult(
    aiTaskRepo: AiTaskRepository,
    task: AiTaskRecord,
    generated: AiTaskGenerationResult,
    outputText: string | null
  ): GeneratedPreview {
    return aiTaskRepo.transact(() => {
      const candidate = aiTaskRepo.createCandidate({
        taskId: task.id,
        kind: task.taskType,
        originalText: task.inputText,
        generatedText: generated.generatedText,
        changeSummary: generated.changeSummary,
        proofreadIssues: generated.proofreadIssues ?? null,
        writingContextPlan: generated.contextPlan ?? null
      });
      const updatedTask = aiTaskRepo.updateTask(task.id, {
        status: "preview_ready",
        outputText,
        error: null
      });
      return {
        task: updatedTask,
        candidate
      };
    });
  }

  private unregisterStreamIfCurrent(requestId: string, abortController: AbortController): void {
    if (this.activeStreams.get(requestId) === abortController) {
      this.activeStreams.delete(requestId);
    }
  }
}
