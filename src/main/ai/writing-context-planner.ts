import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { SummaryRepository } from "../db/repositories/summary-repo";
import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import type { TokenBudget } from "./token-budget";
import type {
  WritingContextPlan,
  WritingOperationDefinition,
  WritingOperationTarget,
  WritingSupportingContextItem
} from "./writing-operation-types";

export type PlanWritingOperationContextInput = {
  readonly projectId: string;
  readonly operation: WritingOperationDefinition;
  readonly target: WritingOperationTarget;
  readonly chapterRepo: ChapterRepository;
  readonly summaryRepo?: SummaryRepository;
  readonly tokenBudget: TokenBudget;
};

const TARGET_TEXT_RESERVE_TOKENS = 600;

function assertTargetFits(targetText: string, tokenBudget: TokenBudget): void {
  const estimated = estimateTextTokens(targetText) + TARGET_TEXT_RESERVE_TOKENS;
  if (estimated > tokenBudget.maxInputTokens) {
    throw new Error(`目标文本太长，预计输入约 ${estimated} tokens，超过上限 ${tokenBudget.maxInputTokens}。请缩短选区后重试。`);
  }
}

function findTargetRange(plainText: string, targetText: string): { readonly start: number; readonly end: number } | null {
  const exact = plainText.indexOf(targetText);
  if (exact >= 0) {
    return {
      start: exact,
      end: exact + targetText.length
    };
  }

  const compactTarget = targetText.replace(/\s+/g, "");
  if (!compactTarget) {
    return null;
  }

  let compactPlainText = "";
  const originalIndexByCompactIndex: number[] = [];
  for (let index = 0; index < plainText.length; index += 1) {
    const char = plainText[index];
    if (/\s/u.test(char)) {
      continue;
    }
    originalIndexByCompactIndex.push(index);
    compactPlainText += char;
  }

  const compactIndex = compactPlainText.indexOf(compactTarget);
  if (compactIndex < 0) {
    return null;
  }

  const compactEndIndex = compactIndex + compactTarget.length - 1;
  const start = originalIndexByCompactIndex[compactIndex];
  const end = originalIndexByCompactIndex[compactEndIndex] + 1;
  return start === undefined || Number.isNaN(end) ? null : { start, end };
}

function pushContextItem(items: WritingSupportingContextItem[], item: WritingSupportingContextItem): void {
  if (item.content.trim()) {
    items.push(item);
  }
}

function formatChapterSummaryCacheContext(input: PlanWritingOperationContextInput, chapterId: string): WritingSupportingContextItem | null {
  const summary = input.summaryRepo?.getChapterSummary(input.projectId, chapterId);
  if (!summary || summary.status !== "ready") {
    return null;
  }
  const structured = summary.structured;
  const content = [
    `短摘要：${summary.summaryShort}`,
    `详细梗概：${summary.summaryLong}`,
    `人物状态：${JSON.stringify(structured.人物状态)}`,
    `人物认知边界：${JSON.stringify(structured.人物认知边界)}`,
    `关系动态：${JSON.stringify(structured.关系动态)}`,
    `时间与地点：${JSON.stringify(structured.时间与地点)}`,
    `道具状态：${JSON.stringify(structured.道具状态)}`,
    `设定与规则：${JSON.stringify(structured.设定与规则)}`,
    `伏笔与线索：${JSON.stringify(structured.伏笔与线索)}`,
    `可核对事实：${JSON.stringify(structured.可核对事实)}`,
    `连续性风险：${JSON.stringify(structured.连续性风险)}`
  ].join("\n");

  return {
    kind: "same_chapter_summary",
    label: `${summary.chapterTitle} 章节摘要索引`,
    content,
    reason: "辅助校对人物认知、时间线、道具状态、设定规则、因果和伏笔连续性；不可作为修改目标"
  };
}

function resolveSelectionTarget(
  projectId: string,
  target: Extract<WritingOperationTarget, { readonly kind: "selection" }>,
  chapterRepo: ChapterRepository
): string {
  const text = target.text.trim();
  if (!text) {
    throw new Error("目标文本为空，无法执行写作操作。");
  }

  const chapter = chapterRepo.getContent(target.chapterId);
  if (!chapter) {
    throw new Error("找不到选区章节，无法执行写作操作。");
  }
  if (chapter.projectId !== projectId) {
    throw new Error("选区章节不属于当前项目，无法执行写作操作。");
  }

  return text;
}

function buildSelectionContext(input: PlanWritingOperationContextInput, targetText: string): readonly WritingSupportingContextItem[] {
  if (input.target.kind !== "selection") {
    return [];
  }

  const chapter = input.chapterRepo.getContent(input.target.chapterId);
  if (!chapter || chapter.projectId !== input.projectId) {
    return [];
  }

  const range = findTargetRange(chapter.plainText, targetText);
  const items: WritingSupportingContextItem[] = [];

  if (range) {
    const beforeStart = Math.max(0, range.start - input.operation.contextPolicy.includeLocalBeforeChars);
    const afterEnd = Math.min(chapter.plainText.length, range.end + input.operation.contextPolicy.includeLocalAfterChars);
    const before = chapter.plainText.slice(beforeStart, range.start).trim();
    const after = chapter.plainText.slice(range.end, afterEnd).trim();

    pushContextItem(items, {
      kind: "same_chapter_before",
      label: `${chapter.title} 选区前文`,
      content: before,
      reason:
        input.operation.id === "proofread"
          ? "用于判断前文承接、人物状态、时间线和逻辑风险；不可作为修改目标"
          : "保持当前场景、称呼和语气连续"
    });
    pushContextItem(items, {
      kind: "same_chapter_after",
      label: `${chapter.title} 选区后文`,
      content: after,
      reason:
        input.operation.id === "proofread"
          ? "用于判断后文承接、人物状态、时间线和逻辑风险；不可作为修改目标"
          : "避免候选文本破坏后文承接"
    });
  }

  if (input.operation.id === "proofread") {
    const summaryContext = formatChapterSummaryCacheContext(input, input.target.chapterId);
    if (summaryContext) {
      pushContextItem(items, summaryContext);
    }
  }

  return items;
}

function resolveChapterTarget(
  projectId: string,
  target: Extract<WritingOperationTarget, { readonly kind: "chapter" }>,
  chapterRepo: ChapterRepository
): string {
  const chapter = chapterRepo.getContent(target.chapterId);
  if (!chapter) {
    throw new Error("找不到目标章节，无法执行写作操作。");
  }
  if (chapter.projectId !== projectId) {
    throw new Error("目标章节不属于当前项目，无法执行写作操作。");
  }
  return chapter.plainText.trim();
}

function resolveChapterRangeTarget(
  projectId: string,
  target: Extract<WritingOperationTarget, { readonly kind: "chapter_range" }>,
  chapterRepo: ChapterRepository
): string {
  const chapters = chapterRepo.listByProject(projectId);
  if (target.fromOrdinal < 1 || target.toOrdinal < target.fromOrdinal || target.toOrdinal > chapters.length) {
    throw new Error(`章节范围无效：第${target.fromOrdinal}章到第${target.toOrdinal}章。`);
  }

  return chapters
    .slice(target.fromOrdinal - 1, target.toOrdinal)
    .map((chapter, index) => {
      const ordinal = target.fromOrdinal + index;
      const content = chapterRepo.getContent(chapter.id);
      if (!content) {
        throw new Error(`找不到第${ordinal}章的正文内容。`);
      }
      return `[第${ordinal}章 ${content.title}]\n${content.plainText.trim()}`;
    })
    .join("\n\n");
}

function resolveTargetText(projectId: string, target: WritingOperationTarget, chapterRepo: ChapterRepository): string {
  if (target.kind === "selection") {
    return resolveSelectionTarget(projectId, target, chapterRepo);
  }

  if (target.kind === "inline_text") {
    const text = target.text.trim();
    if (!text) {
      throw new Error("目标文本为空，无法执行写作操作。");
    }
    return text;
  }

  const text = target.kind === "chapter" ? resolveChapterTarget(projectId, target, chapterRepo) : resolveChapterRangeTarget(projectId, target, chapterRepo);
  if (!text.trim()) {
    throw new Error("目标文本为空，无法执行写作操作。");
  }
  return text;
}

function trimSupportingContext(
  items: readonly WritingSupportingContextItem[],
  targetText: string,
  tokenBudget: TokenBudget
): { readonly items: readonly WritingSupportingContextItem[]; readonly truncated: boolean } {
  const targetTokens = estimateTextTokens(targetText) + TARGET_TEXT_RESERVE_TOKENS;
  let remaining = Math.max(0, tokenBudget.maxInputTokens - targetTokens);
  let truncated = false;
  const result: WritingSupportingContextItem[] = [];

  for (const item of items) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const trimmed = truncateTextToTokenBudget(item.content, remaining);
    const content = trimmed.text.trim();
    if (content) {
      result.push({
        ...item,
        content
      });
      remaining -= estimateTextTokens(content);
    }
    truncated = truncated || trimmed.truncated;
  }

  return { items: result, truncated };
}

export function planWritingOperationContext(input: PlanWritingOperationContextInput): WritingContextPlan {
  const targetText = resolveTargetText(input.projectId, input.target, input.chapterRepo);
  assertTargetFits(targetText, input.tokenBudget);

  const rawSupportingContext = buildSelectionContext(input, targetText);
  const supportingContext = trimSupportingContext(rawSupportingContext, targetText, input.tokenBudget);
  const estimatedInputTokens =
    estimateTextTokens([targetText, ...supportingContext.items.map((item) => item.content)].join("\n\n")) + TARGET_TEXT_RESERVE_TOKENS;

  return {
    targetText,
    supportingContext: supportingContext.items,
    mode: supportingContext.truncated ? "mixed" : "direct",
    estimatedInputTokens,
    maxInputTokens: input.tokenBudget.maxInputTokens,
    reason:
      input.operation.id === "proofread"
        ? supportingContext.items.length > 0
          ? "校对目标文本为唯一检查目标；前后文和章节摘要缓存只用于逻辑和连续性判断，不写回正文。"
          : "校对默认只检查目标文本，避免把参考上下文误判为可修改目标。"
        : "选区是唯一修改目标，前后文只作为参考上下文。"
  };
}
