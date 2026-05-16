import type { ChatAgentContext, ChatAgentPlan, ChatAgentScope, ChatContextSummaryItem } from "./chat-agent-types";
import { parseChapterOrdinalFromText } from "./chat-reference-parser";
import { getTokenBudget, type TokenBudget } from "./token-budget";
import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { ArcAiSummaryRecord, BookAiSummaryRecord, ChapterAiSummaryRecord, SummaryRepository } from "../db/repositories/summary-repo";
import {
  getBookSummaryCoverage,
  getChapterSummaryCharacterKnowledge,
  getChapterSummaryCharacterStates,
  getChapterSummaryFacts,
  getChapterSummaryForeshadowing,
  getChapterSummaryKeyEvents,
  getChapterSummaryMustKeep,
  getChapterSummaryRelationships,
  getChapterSummaryRisks,
  getChapterSummaryTimePlace,
  getChapterSummaryUnresolvedQuestions,
  type BookSummaryCoverage
} from "../shared/summary-index";
import type { ChapterContent, ChapterSummary } from "../shared/types";
import { getChapterSummaryCacheState, isFreshReadyChapterSummary, isFreshSkippedTooShortChapterSummary } from "./chapter-summary-freshness";

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

export type ChatAgentContextOptions = {
  readonly summaryRepo?: SummaryRepository;
  readonly summaryFocus?: SummaryIndexFocus;
};

export type SummaryIndexFocus = "overview" | "characters" | "foreshadowing" | "facts" | "timeline";

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

function formatChapterCoverageLabel(chapterOrder: number, title: string): string {
  if (title.startsWith(`第${chapterOrder}章`)) {
    return title;
  }
  return `第${chapterOrder}章 ${title}`;
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

function formatList(title: string, items: readonly string[]): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return "";
  }
  return [`${title}：`, ...cleaned.map((item) => `- ${item}`)].join("\n");
}

function formatCoverageStatus(coverage: BookSummaryCoverage): string {
  const warnings: string[] = [];
  if (coverage.staleChapterIds.length > 0) {
    warnings.push(`过期 ${coverage.staleChapterIds.length} 章`);
  }
  if (coverage.missingChapterIds.length > 0) {
    warnings.push(`缺失 ${coverage.missingChapterIds.length} 章`);
  }
  if (coverage.skippedTooShortChapterIds.length > 0) {
    warnings.push(`过短跳过 ${coverage.skippedTooShortChapterIds.length} 章`);
  }
  return warnings.length > 0 ? warnings.join("，") : "最新";
}

function formatLimitedLabels(labels: readonly string[]): string {
  const cleaned = labels.map((label) => label.trim()).filter(Boolean);
  if (cleaned.length <= 12) {
    return cleaned.join("、");
  }
  return `${cleaned.slice(0, 12).join("、")} 等 ${cleaned.length} 章`;
}

function formatCoverageWarnings(coverage: BookSummaryCoverage): string[] {
  const warnings: string[] = [];
  if (coverage.staleChapterIds.length > 0) {
    warnings.push(`过期章节：${formatLimitedLabels(coverage.staleChapterIds)}`);
  }
  if (coverage.missingChapterIds.length > 0) {
    warnings.push(`缺失章节：${formatLimitedLabels(coverage.missingChapterIds)}`);
  }
  if (coverage.skippedTooShortChapterIds.length > 0) {
    warnings.push(`过短跳过章节：${formatLimitedLabels(coverage.skippedTooShortChapterIds)}`);
  }
  return warnings;
}

function getCoverageStaleCount(coverage: BookSummaryCoverage): number {
  return coverage.staleChapterIds.length + coverage.missingChapterIds.length;
}

function getCoverageIndexMode(coverage: BookSummaryCoverage, hasReadyBookSummary: boolean): ChatAgentContext["indexMode"] {
  if (!hasReadyBookSummary) {
    return coverage.indexedChapterCount > 0 ? "hybrid" : "missing";
  }
  return getCoverageStaleCount(coverage) > 0 ? "stale" : "summary_cache";
}

function buildComputedCoverage(chapters: readonly ChapterSummary[], summaries: readonly ChapterAiSummaryRecord[]): BookSummaryCoverage {
  const byChapterId = new Map(summaries.map((summary) => [summary.chapterId, summary]));
  const staleChapterIds: string[] = [];
  const missingChapterIds: string[] = [];
  const skippedTooShortChapterIds: string[] = [];
  let indexedChapterCount = 0;

  for (const chapter of chapters) {
    const summary = byChapterId.get(chapter.id);
    const cacheState = getChapterSummaryCacheState(summary, chapter);
    if (cacheState === "missing") {
      missingChapterIds.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
      continue;
    }
    if (cacheState === "ready") {
      indexedChapterCount += 1;
      continue;
    }
    if (cacheState === "skipped_too_short") {
      skippedTooShortChapterIds.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
      continue;
    }
    staleChapterIds.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
  }

  return {
    totalChapterCount: chapters.length,
    indexedChapterCount,
    staleChapterIds,
    missingChapterIds,
    skippedTooShortChapterIds
  };
}

function canUseRawSmallProjectContext(message: string, chapters: readonly ChapterSummary[], budget: TokenBudget): boolean {
  const estimatedChapterTokens = chapters.reduce((total, chapter) => {
    return total + estimateTextTokens(chapter.title) + Math.max(0, chapter.wordCount) + 32;
  }, 0);
  const estimated = estimateTextTokens(message) + estimatedChapterTokens + CHAT_AGENT_CONTEXT_RESERVE_TOKENS;
  return estimated <= budget.maxInputTokens;
}

function buildBookSummaryIndexText(input: {
  readonly bookSummary: BookAiSummaryRecord | null;
  readonly arcSummaries: readonly ArcAiSummaryRecord[];
  readonly chapterSummaries: readonly ChapterAiSummaryRecord[];
  readonly chapters: readonly ChapterSummary[];
  readonly message: string;
  readonly budget: TokenBudget;
}): string {
  const coverage = input.bookSummary ? getBookSummaryCoverage(input.bookSummary.structured) : buildComputedCoverage(input.chapters, input.chapterSummaries);
  const sections: string[] = [
    "[全书摘要索引]",
    `覆盖：${coverage.indexedChapterCount}/${coverage.totalChapterCount} 章`,
    `状态：${input.bookSummary?.status === "ready" ? formatCoverageStatus(coverage) : "全书摘要尚未生成"}`
  ];
  sections.push(...formatCoverageWarnings(coverage));

  if (input.bookSummary?.status === "ready") {
    const structured = input.bookSummary.structured;
    sections.push(
      `短摘要：${input.bookSummary.summaryShort}`,
      `全书摘要：${input.bookSummary.summaryLong}`,
      formatList("主线剧情", structured.主线剧情),
      formatList("主要人物线", structured.主要人物线),
      formatList("重要关系线", structured.重要关系线),
      formatList("人物认知线", structured.人物认知线),
      formatList("伏笔线", structured.伏笔线),
      formatList("道具线", structured.道具线),
      formatList("世界规则与设定", structured.世界规则与设定),
      formatList("核心冲突", structured.核心冲突),
      formatList("未解决问题", structured.未解决问题)
    );
  } else {
    sections.push("全书摘要索引还在建立或尚未建立。回答时必须说明当前只能基于已完成的章节/阶段摘要，不能声称已经阅读全文。");
  }

  const readyArcs = input.arcSummaries.filter((summary) => summary.status === "ready");
  if (readyArcs.length > 0) {
    sections.push(
      "阶段摘要：",
      ...readyArcs.map((summary) => `[第${summary.chapterFrom}-${summary.chapterTo}章] ${summary.summary}`)
    );
  }

  const chapterById = new Map(input.chapters.map((chapter) => [chapter.id, chapter]));
  const readyChapters = input.chapterSummaries.filter((summary) => {
    const chapter = chapterById.get(summary.chapterId);
    return Boolean(chapter && isFreshReadyChapterSummary(summary, chapter));
  });
  if (readyChapters.length > 0) {
    sections.push(
      "章节索引：",
      ...readyChapters.map((summary) => `[第${summary.chapterOrder}章 ${summary.chapterTitle}] ${summary.summaryShort}`)
    );
  }

  const fullText = sections.filter(Boolean).join("\n");
  if (!isChatAgentContextTooLarge(input.message, fullText, input.budget)) {
    return fullText;
  }

  const compactSections = sections
    .filter((section) => section !== "章节索引：")
    .filter((section) => !section.startsWith("[第") || !section.includes("章 "));
  const compactText = compactSections.filter(Boolean).join("\n");
  if (!isChatAgentContextTooLarge(input.message, compactText, input.budget)) {
    return `${compactText}\n章节索引已按当前模型窗口省略部分逐章细节；需要更细结果时请指定章节范围。`;
  }

  const textBudget = Math.max(0, input.budget.maxInputTokens - estimateTextTokens(input.message) - CHAT_AGENT_CONTEXT_RESERVE_TOKENS);
  return truncateTextToTokenBudget(compactText, textBudget).text;
}

function getSummaryFocusLabel(focus: SummaryIndexFocus): string {
  switch (focus) {
    case "characters":
      return "人物";
    case "foreshadowing":
      return "伏笔";
    case "facts":
      return "事实";
    case "timeline":
      return "时间线";
    case "overview":
      return "概览";
  }
}

function isTimelineRelatedText(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /时间|地点|空间|移动|日期|年|月|日|清晨|上午|中午|下午|傍晚|夜|先后|顺序|跨度/.test(text);
}

function getTimelineRelatedFacts(summary: ChapterAiSummaryRecord): readonly string[] {
  return getChapterSummaryFacts(summary.structured, "facts").filter(isTimelineRelatedText).slice(0, 12);
}

function getTimelineRelatedRisks(summary: ChapterAiSummaryRecord): readonly string[] {
  return getChapterSummaryRisks(summary.structured).filter(isTimelineRelatedText).slice(0, 8);
}

function selectFocusScopeChapters(input: {
  readonly scope: Exclude<ChatAgentScope, { readonly type: "selection" }>;
  readonly chapters: readonly ChapterSummary[];
  readonly currentChapterId?: string;
}): readonly ChapterSummary[] {
  if (input.scope.type === "all_chapters") {
    return input.chapters;
  }
  if (input.scope.type === "current_chapter") {
    if (!input.currentChapterId) {
      throw new Error("当前没有打开章节，请先选择章节，或使用 @第N章 指定范围。");
    }
    const current = input.chapters.find((chapter) => chapter.id === input.currentChapterId) ?? null;
    if (!current) {
      throw new Error("当前章节不在项目中，请重新打开章节后再试。");
    }
    return [current];
  }
  if (input.scope.type === "chapter") {
    const chapter = findChapterSummaryByOrdinal(input.chapters, input.scope.ordinal);
    if (!chapter) {
      throw new Error(`找不到第${input.scope.ordinal}章，无法读取摘要索引。`);
    }
    return [chapter];
  }
  if (input.scope.from > input.scope.to) {
    throw new Error(`章节范围无效：第${input.scope.from}章到第${input.scope.to}章。`);
  }
  if (input.scope.to > input.chapters.length) {
    throw new Error(`找不到第${input.scope.to}章，当前项目只有 ${input.chapters.length} 章。`);
  }
  return input.chapters.slice(input.scope.from - 1, input.scope.to);
}

function buildFocusedSummaryBlock(summary: ChapterAiSummaryRecord, focus: SummaryIndexFocus): string {
  const base = {
    章节: formatChapterCoverageLabel(summary.chapterOrder, summary.chapterTitle),
    短摘要: summary.summaryShort
  };

  if (focus === "overview") {
    return JSON.stringify(
      {
        ...base,
        长摘要: summary.summaryLong,
        关键事件: getChapterSummaryKeyEvents(summary.structured),
        不可丢失信息: getChapterSummaryMustKeep(summary.structured),
        未解决问题: getChapterSummaryUnresolvedQuestions(summary.structured)
      },
      null,
      2
    );
  }

  if (focus === "characters") {
    return JSON.stringify(
      {
        ...base,
        人物状态: getChapterSummaryCharacterStates(summary.structured),
        人物认知边界: getChapterSummaryCharacterKnowledge(summary.structured),
        关系动态: getChapterSummaryRelationships(summary.structured),
        可核对事实: getChapterSummaryFacts(summary.structured, focus)
      },
      null,
      2
    );
  }

  if (focus === "foreshadowing") {
    return JSON.stringify(
      {
        ...base,
        伏笔与线索: getChapterSummaryForeshadowing(summary.structured),
        未解决问题: getChapterSummaryUnresolvedQuestions(summary.structured),
        连续性风险: getChapterSummaryRisks(summary.structured),
        可核对事实: getChapterSummaryFacts(summary.structured, focus)
      },
      null,
      2
    );
  }

  if (focus === "timeline") {
    return JSON.stringify(
      {
        ...base,
        时间与地点: getChapterSummaryTimePlace(summary.structured),
        关键事件: getChapterSummaryKeyEvents(summary.structured),
        可核对事实: getTimelineRelatedFacts(summary),
        连续性风险: getTimelineRelatedRisks(summary)
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      ...base,
      人物状态: getChapterSummaryCharacterStates(summary.structured),
      人物认知边界: getChapterSummaryCharacterKnowledge(summary.structured),
      关系动态: getChapterSummaryRelationships(summary.structured),
      伏笔与线索: getChapterSummaryForeshadowing(summary.structured),
      可核对事实: getChapterSummaryFacts(summary.structured, "facts")
    },
    null,
    2
  );
}

function resolveFocusedSummaryIndexContext(
  request: ChatContextRequest,
  scope: Exclude<ChatAgentScope, { readonly type: "selection" }>,
  chapterRepo: ChapterRepository,
  summaryRepo: SummaryRepository,
  budget: TokenBudget,
  focus: SummaryIndexFocus
): ResolvedChatAgentContext {
  const chapters = chapterRepo.listByProject(request.projectId);
  if (chapters.length === 0) {
    throw new Error("当前项目没有章节，无法读取摘要索引。");
  }

  const selectedChapters = selectFocusScopeChapters({
    scope,
    chapters,
    currentChapterId: request.chapterId
  });
  const summaryByChapterId = new Map(summaryRepo.listChapterSummaries(request.projectId).map((summary) => [summary.chapterId, summary]));
  const readySummaries: ChapterAiSummaryRecord[] = [];
  const missingLabels: string[] = [];
  const staleLabels: string[] = [];
  const skippedLabels: string[] = [];

  for (const chapter of selectedChapters) {
    const summary = summaryByChapterId.get(chapter.id);
    const label = formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title);
    if (isFreshReadyChapterSummary(summary, chapter)) {
      readySummaries.push(summary);
      continue;
    }
    if (isFreshSkippedTooShortChapterSummary(summary, chapter)) {
      skippedLabels.push(label);
      continue;
    }
    if (summary) {
      staleLabels.push(label);
    } else {
      missingLabels.push(label);
    }
  }

  const focusLabel = getSummaryFocusLabel(focus);
  const header = [
    `[${focusLabel}摘要索引]`,
    `范围：${buildScopeLabel(scope)}`,
    `覆盖：${readySummaries.length}/${selectedChapters.length} 章`,
    missingLabels.length + staleLabels.length > 0 ? "状态：摘要索引缺失或过期" : "状态：最新",
    missingLabels.length > 0 ? `缺失章节：${formatLimitedLabels(missingLabels)}` : "",
    staleLabels.length > 0 ? `过期章节：${formatLimitedLabels(staleLabels)}` : "",
    skippedLabels.length > 0 ? `过短跳过章节：${formatLimitedLabels(skippedLabels)}` : "",
    "请只根据以下章节摘要索引回答；缺失或过期章节必须说明，不能编造。"
  ];
  const body =
    readySummaries.length > 0
      ? readySummaries.map((summary) => buildFocusedSummaryBlock(summary, focus))
      : ["当前范围没有可用章节摘要索引。回答时请提示作者先建立摘要索引，不能声称已经读取正文。"];
  const rawText = [...header.filter(Boolean), ...body].join("\n");
  const contextText = isChatAgentContextTooLarge(request.message, rawText, budget)
    ? `${truncateTextToTokenBudget(rawText, Math.max(0, budget.maxInputTokens - estimateTextTokens(request.message) - CHAT_AGENT_CONTEXT_RESERVE_TOKENS)).text}\n（摘要索引已按当前模型窗口压缩；需要更完整结果时请缩小章节范围。）`
    : rawText;
  const missingOrStaleCount = missingLabels.length + staleLabels.length;

  return {
    agentContext: {
      scopeLabel: `${buildScopeLabel(scope)}${focusLabel}索引`,
      contextText,
      sourceChapterIds: selectedChapters.map((chapter) => chapter.id),
      mode: "summarized",
      indexMode: readySummaries.length === 0 ? "missing" : missingOrStaleCount > 0 ? "hybrid" : "summary_cache",
      indexedChapterCount: readySummaries.length,
      totalChapterCount: selectedChapters.length,
      staleChapterCount: missingOrStaleCount,
      skippedTooShortChapterCount: skippedLabels.length
    },
    chapters: [],
    primaryChapterId: selectedChapters.length === 1 ? selectedChapters[0].id : null,
    requiresSummaries: false
  };
}

function resolveSummaryIndexContext(
  request: ChatContextRequest,
  chapterRepo: ChapterRepository,
  summaryRepo: SummaryRepository,
  budget: TokenBudget
): ResolvedChatAgentContext | null {
  const chapters = chapterRepo.listByProject(request.projectId);
  if (chapters.length === 0) {
    throw new Error("当前项目没有章节，无法为 AI 对话提供章节上下文。");
  }

  const bookSummary = summaryRepo.getLatestBookSummary(request.projectId);
  const chapterSummaries = summaryRepo.listChapterSummaries(request.projectId);
  const arcSummaries = summaryRepo.listArcSummaries(request.projectId);
  const hasAnySummary = Boolean(bookSummary) || chapterSummaries.length > 0 || arcSummaries.length > 0;
  if (!hasAnySummary) {
    if (canUseRawSmallProjectContext(request.message, chapters, budget)) {
      const rawChapters = chapters.map((chapter, index) => loadChapterContent(chapterRepo, chapter, index + 1));
      return {
        agentContext: {
          scopeLabel: "全部章节",
          contextText: buildChapterContextText(rawChapters),
          sourceChapterIds: rawChapters.map((chapter) => chapter.content.id),
          mode: "direct",
          indexMode: "raw_small_project",
          indexedChapterCount: 0,
          totalChapterCount: chapters.length,
          staleChapterCount: 0,
          skippedTooShortChapterCount: 0
        },
        chapters: rawChapters,
        primaryChapterId: null,
        requiresSummaries: false
      };
    }
    const contextText = [
      "[全书摘要索引]",
      `覆盖：0/${chapters.length} 章`,
      "状态：全书摘要索引尚未建立。",
      "当前不能直接读取全书原文来回答全文问题。请等待后台索引完成，或指定单章、章节范围、当前章节或选中文本。"
    ].join("\n");
    return {
      agentContext: {
        scopeLabel: "全书摘要索引",
        contextText,
        sourceChapterIds: chapters.map((chapter) => chapter.id),
        mode: "summarized",
        indexMode: "missing",
        indexedChapterCount: 0,
        totalChapterCount: chapters.length,
        staleChapterCount: 0,
        skippedTooShortChapterCount: 0
      },
      chapters: [],
      primaryChapterId: null,
      requiresSummaries: false
    };
  }
  const coverage = bookSummary ? getBookSummaryCoverage(bookSummary.structured) : buildComputedCoverage(chapters, chapterSummaries);
  const readyBookSummary = bookSummary?.status === "ready" ? bookSummary : null;

  return {
    agentContext: {
      scopeLabel: "全书摘要索引",
      contextText: buildBookSummaryIndexText({
        bookSummary: readyBookSummary,
        arcSummaries,
        chapterSummaries,
        chapters,
        message: request.message,
        budget
      }),
      sourceChapterIds: chapters.map((chapter) => chapter.id),
      mode: "summarized",
      indexMode: getCoverageIndexMode(coverage, Boolean(readyBookSummary)),
      indexedChapterCount: coverage.indexedChapterCount,
      totalChapterCount: coverage.totalChapterCount,
      staleChapterCount: getCoverageStaleCount(coverage),
      skippedTooShortChapterCount: coverage.skippedTooShortChapterIds.length
    },
    chapters: [],
    primaryChapterId: null,
    requiresSummaries: false
  };
}

function resolveChapterRangeSummaryIndexContext(
  request: ChatContextRequest,
  scope: Extract<ChatAgentScope, { readonly type: "chapter_range" }>,
  chapterRepo: ChapterRepository,
  summaryRepo: SummaryRepository,
  budget: TokenBudget
): ResolvedChatAgentContext {
  const chapters = chapterRepo.listByProject(request.projectId);
  if (chapters.length === 0) {
    throw new Error("当前项目没有章节，无法为 AI 对话提供章节上下文。");
  }
  if (scope.from > scope.to) {
    throw new Error(`章节范围无效：第${scope.from}章到第${scope.to}章。`);
  }
  if (scope.to > chapters.length) {
    throw new Error(`找不到第${scope.to}章，当前项目只有 ${chapters.length} 章。`);
  }

  const rangeChapters = chapters.slice(scope.from - 1, scope.to);
  const summaryByChapterId = new Map(summaryRepo.listChapterSummaries(request.projectId).map((summary) => [summary.chapterId, summary]));
  const readySummaries: ChapterAiSummaryRecord[] = [];
  const staleChapterLabels: string[] = [];
  const missingChapterLabels: string[] = [];
  const skippedTooShortChapterLabels: string[] = [];
  let staleChapterCount = 0;
  let skippedTooShortChapterCount = 0;
  for (const chapter of rangeChapters) {
    const summary = summaryByChapterId.get(chapter.id);
    if (isFreshReadyChapterSummary(summary, chapter)) {
      readySummaries.push(summary);
      continue;
    }
    if (isFreshSkippedTooShortChapterSummary(summary, chapter)) {
      skippedTooShortChapterCount += 1;
      skippedTooShortChapterLabels.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
      continue;
    }
    staleChapterCount += 1;
    if (summary) {
      staleChapterLabels.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
    } else {
      missingChapterLabels.push(formatChapterCoverageLabel(chapter.sortOrder + 1, chapter.title));
    }
  }
  const hasCompleteCachedCoverage = readySummaries.length + skippedTooShortChapterCount === rangeChapters.length && staleChapterCount === 0;
  const shouldPreferSummaryIndex = hasCompleteCachedCoverage || rangeChapters.length > 3;

  if (!shouldPreferSummaryIndex && canUseRawSmallProjectContext(request.message, rangeChapters, budget)) {
    const rawChapters = rangeChapters.map((chapter, index) => loadChapterContent(chapterRepo, chapter, scope.from + index));
    return {
      agentContext: {
        scopeLabel: `第${scope.from}-${scope.to}章`,
        contextText: buildChapterContextText(rawChapters),
        sourceChapterIds: rawChapters.map((chapter) => chapter.content.id),
        mode: "direct",
        indexMode: "raw_small_project",
        indexedChapterCount: 0,
        totalChapterCount: rangeChapters.length,
        staleChapterCount: 0,
        skippedTooShortChapterCount: 0
      },
      chapters: rawChapters,
      primaryChapterId: null,
      requiresSummaries: false
    };
  }

  const header = [
    "[章节范围摘要索引]",
    `范围：第${scope.from}-${scope.to}章`,
    `覆盖：${readySummaries.length}/${rangeChapters.length} 章`,
    staleChapterCount > 0 ? `状态：摘要缺失或过期 ${staleChapterCount} 章` : "状态：最新",
    staleChapterLabels.length > 0 ? `过期章节：${formatLimitedLabels(staleChapterLabels)}` : "",
    missingChapterLabels.length > 0 ? `缺失章节：${formatLimitedLabels(missingChapterLabels)}` : "",
    skippedTooShortChapterLabels.length > 0 ? `过短跳过章节：${formatLimitedLabels(skippedTooShortChapterLabels)}` : ""
  ];
  const summaryLines =
    readySummaries.length > 0
      ? readySummaries.flatMap((summary) => [`[第${summary.chapterOrder}章 ${summary.chapterTitle}]`, `短摘要：${summary.summaryShort}`, `长摘要：${summary.summaryLong}`])
      : ["当前范围摘要索引尚未建立。回答时必须说明不能声称已经读取这些章节原文。"];
  const contextText = [...header.filter(Boolean), ...summaryLines].join("\n");

  return {
    agentContext: {
      scopeLabel: `第${scope.from}-${scope.to}章摘要索引`,
      contextText,
      sourceChapterIds: rangeChapters.map((chapter) => chapter.id),
      mode: "summarized",
      indexMode: hasCompleteCachedCoverage ? "summary_cache" : readySummaries.length > 0 ? "hybrid" : "missing",
      indexedChapterCount: readySummaries.length,
      totalChapterCount: rangeChapters.length,
      staleChapterCount,
      skippedTooShortChapterCount
    },
    chapters: [],
    primaryChapterId: null,
    requiresSummaries: false
  };
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
  return buildChapterContextBlock(chapter, truncated.truncated ? `${truncated.text}\n（本章内容已按当前模型窗口压缩。）` : truncated.text);
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
  budget: TokenBudget = getTokenBudget("chat"),
  options: ChatAgentContextOptions = {}
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

  if (options.summaryRepo && options.summaryFocus) {
    return resolveFocusedSummaryIndexContext(request, plan.scope, chapterRepo, options.summaryRepo, budget, options.summaryFocus);
  }

  if (plan.scope.type === "all_chapters" && options.summaryRepo) {
    const summaryContext = resolveSummaryIndexContext(request, chapterRepo, options.summaryRepo, budget);
    if (summaryContext) {
      return summaryContext;
    }
  }

  if (plan.scope.type === "chapter_range" && options.summaryRepo) {
    return resolveChapterRangeSummaryIndexContext(request, plan.scope, chapterRepo, options.summaryRepo, budget);
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
