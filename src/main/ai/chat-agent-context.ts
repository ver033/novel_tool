import type { ChatAgentContext, ChatAgentPlan, ChatAgentScope, ChatContextSummaryItem } from "./chat-agent-types";
import { parseChapterOrdinalFromText } from "./chat-reference-parser";
import { getTokenBudget, type TokenBudget } from "./token-budget";
import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ChapterContent, ChapterSummary } from "../shared/types";

const CHAT_AGENT_CONTEXT_RESERVE_TOKENS = 500;

export type ChatContextRequest = {
  readonly projectId: string;
  readonly message: string;
  readonly chapterId?: string;
  readonly selectionText?: string;
};

export type ChapterContextItem = {
  readonly ordinal: number;
  readonly content: ChapterContent;
};

export type ResolvedChatAgentContext = {
  readonly agentContext: ChatAgentContext;
  readonly chapters: readonly ChapterContextItem[];
  readonly primaryChapterId: string | null;
  readonly requiresSummaries: boolean;
};

function findChapterSummaryByOrdinal(chapters: readonly ChapterSummary[], ordinal: number): ChapterSummary | null {
  return chapters.find((chapter) => parseChapterOrdinalFromText(chapter.title) === ordinal) ?? chapters[ordinal - 1] ?? null;
}

function loadChapterContent(chapterRepo: ChapterRepository, chapter: ChapterSummary, ordinal: number): ChapterContextItem {
  const content = chapterRepo.getContent(chapter.id);
  if (!content) {
    throw new Error(`找不到第${ordinal}章的正文内容。`);
  }
  return {
    ordinal,
    content
  };
}

function buildChapterContextText(chapters: readonly ChapterContextItem[]): string {
  return chapters.map((chapter) => buildChapterContextBlock(chapter, chapter.content.plainText)).join("\n\n");
}

function buildChapterContextBlock(chapter: ChapterContextItem, plainText: string): string {
  return [[`[第${chapter.ordinal}章 ${chapter.content.title} | 字数 ${chapter.content.wordCount}]`, plainText.trim() || "（本章暂无正文）"].join("\n")].join(
    "\n"
  );
}

function formatSummaryItem(item: ChatContextSummaryItem): string {
  const title = parseChapterOrdinalFromText(item.title) === item.ordinal ? item.title : `第${item.ordinal}章 ${item.title}`;
  return [`[${title} | 摘要]`, item.summary.trim() || "（摘要为空）"].join("\n");
}

function buildBatchTitle(chapters: readonly ChapterContextItem[]): string {
  const first = chapters[0];
  const last = chapters.at(-1) ?? first;
  if (!first) {
    return "空章节批次";
  }
  if (first.ordinal === last.ordinal) {
    return `第${first.ordinal}章 ${first.content.title}`;
  }
  return `第${first.ordinal}-${last.ordinal}章 ${first.content.title} 至 ${last.content.title}`;
}

function buildScopeLabel(scope: ChatAgentScope): string {
  switch (scope.type) {
    case "selection":
      return "选中文本";
    case "current_chapter":
      return "本章";
    case "chapter":
      return `第${scope.ordinal}章`;
    case "chapter_range":
      return `第${scope.from}-${scope.to}章`;
    case "all_chapters":
      return "全部章节";
  }
}

export function isChatAgentContextTooLarge(message: string, contextText: string, budget: TokenBudget = getTokenBudget("chat")): boolean {
  const estimated = estimateTextTokens(message) + estimateTextTokens(contextText) + CHAT_AGENT_CONTEXT_RESERVE_TOKENS;
  return estimated > budget.maxInputTokens;
}

export function buildChatContextSummaryBatches(
  message: string,
  chapters: readonly ChapterContextItem[],
  budget: TokenBudget = getTokenBudget("chat")
): readonly (readonly ChapterContextItem[])[] {
  const maxBatchTokens = Math.max(1200, budget.maxInputTokens - estimateTextTokens(message) - CHAT_AGENT_CONTEXT_RESERVE_TOKENS - 900);
  const batches: ChapterContextItem[][] = [];
  let current: ChapterContextItem[] = [];
  let currentTokens = 0;

  for (const chapter of chapters) {
    const blockTokens = estimateTextTokens(buildChapterContextBlock(chapter, chapter.content.plainText));
    const nextWouldOverflow = current.length > 0 && currentTokens + blockTokens > maxBatchTokens;
    if (nextWouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }

    if (blockTokens > maxBatchTokens) {
      batches.push([chapter]);
      continue;
    }

    current.push(chapter);
    currentTokens += blockTokens;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function buildBudgetedSingleChapterContext(message: string, chapter: ChapterContextItem, budget: TokenBudget): string {
  const header = `[第${chapter.ordinal}章 ${chapter.content.title} | 字数 ${chapter.content.wordCount}]`;
  const textBudget = Math.max(0, budget.maxInputTokens - estimateTextTokens(message) - estimateTextTokens(header) - CHAT_AGENT_CONTEXT_RESERVE_TOKENS);
  const truncated = truncateTextToTokenBudget(chapter.content.plainText, textBudget);
  return buildChapterContextBlock(chapter, truncated.truncated ? `${truncated.text}\n（本章内容已按输入预算截断。）` : truncated.text);
}

function resolveChapterScope(
  chapterRepo: ChapterRepository,
  projectId: string,
  scope: ChatAgentScope,
  currentChapterId?: string
): readonly ChapterContextItem[] {
  const chapters = chapterRepo.listByProject(projectId);
  if (chapters.length === 0) {
    throw new Error("当前项目没有章节，无法为 AI 对话提供章节上下文。");
  }

  if (scope.type === "all_chapters") {
    return chapters.map((chapter, index) => loadChapterContent(chapterRepo, chapter, index + 1));
  }

  if (scope.type === "current_chapter") {
    if (!currentChapterId) {
      throw new Error("当前没有打开章节，请先选择章节，或使用 @第N章 指定范围。");
    }
    const index = chapters.findIndex((chapter) => chapter.id === currentChapterId);
    const current = index >= 0 ? chapters[index] : null;
    if (!current) {
      throw new Error("当前章节不在项目中，请重新打开章节后再试。");
    }
    return [loadChapterContent(chapterRepo, current, index + 1)];
  }

  if (scope.type === "chapter") {
    const chapter = findChapterSummaryByOrdinal(chapters, scope.ordinal);
    if (!chapter) {
      throw new Error(`找不到第${scope.ordinal}章，无法为 AI 对话提供对应章节内容。`);
    }
    return [loadChapterContent(chapterRepo, chapter, scope.ordinal)];
  }

  if (scope.type === "chapter_range") {
    if (scope.from > scope.to) {
      throw new Error(`章节范围无效：第${scope.from}章到第${scope.to}章。`);
    }
    if (scope.to > chapters.length) {
      throw new Error(`找不到第${scope.to}章，当前项目只有 ${chapters.length} 章。`);
    }
    return chapters
      .slice(scope.from - 1, scope.to)
      .map((chapter, index) => loadChapterContent(chapterRepo, chapter, scope.from + index));
  }

  return [];
}

export function resolveChatAgentContext(
  request: ChatContextRequest,
  plan: ChatAgentPlan,
  chapterRepo: ChapterRepository,
  budget: TokenBudget = getTokenBudget("chat")
): ResolvedChatAgentContext {
  const scopeLabel = buildScopeLabel(plan.scope);
  if (plan.scope.type === "selection") {
    const selectionText = request.selectionText?.trim();
    if (!selectionText) {
      throw new Error("当前没有选中文本，请先选择正文，或使用 @本章/@全部章节 指定范围。");
    }
    const agentContext = {
      scopeLabel,
      contextText: `选中文本：\n${selectionText}`,
      sourceChapterIds: request.chapterId ? [request.chapterId] : [],
      mode: "direct"
    } satisfies ChatAgentContext;
    return {
      agentContext,
      chapters: [],
      primaryChapterId: request.chapterId ?? null,
      requiresSummaries: false
    };
  }

  const chapters = resolveChapterScope(chapterRepo, request.projectId, plan.scope, request.chapterId);
  let contextText = buildChapterContextText(chapters);
  let requiresSummaries = isChatAgentContextTooLarge(request.message, contextText, budget);
  if (requiresSummaries && chapters.length === 1) {
    contextText = buildBudgetedSingleChapterContext(request.message, chapters[0], budget);
    requiresSummaries = false;
  }
  const sourceChapterIds = chapters.map((chapter) => chapter.content.id);
  const agentContext = {
    scopeLabel,
    contextText,
    sourceChapterIds,
    mode: "direct"
  } satisfies ChatAgentContext;

  return {
    agentContext,
    chapters,
    primaryChapterId: sourceChapterIds.length === 1 ? sourceChapterIds[0] : null,
    requiresSummaries
  };
}

export function buildSummarizedAgentContext(
  baseContext: ResolvedChatAgentContext,
  summaries: readonly string[]
): ChatAgentContext {
  const items = baseContext.chapters.map((chapter, index) => ({
    chapterId: chapter.content.id,
    title: chapter.content.title,
    ordinal: chapter.ordinal,
    summary: summaries[index] ?? ""
  }));
  return buildSummarizedAgentContextFromItems(baseContext, items);
}

export function buildSummarizedAgentContextFromItems(
  baseContext: ResolvedChatAgentContext,
  summaries: readonly ChatContextSummaryItem[]
): ChatAgentContext {
  const summaryText = summaries.map(formatSummaryItem).join("\n\n");
  return {
    scopeLabel: baseContext.agentContext.scopeLabel,
    contextText: summaryText,
    sourceChapterIds: baseContext.agentContext.sourceChapterIds,
    mode: "summarized"
  };
}

export function buildSummaryItemFromBatch(chapters: readonly ChapterContextItem[], summary: string): ChatContextSummaryItem {
  const first = chapters[0];
  if (!first) {
    throw new Error("AI 对话摘要批次为空。");
  }

  return {
    chapterId: first.content.id,
    title: buildBatchTitle(chapters),
    ordinal: first.ordinal,
    summary
  };
}
