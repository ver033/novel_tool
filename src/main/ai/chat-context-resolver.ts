import type { ChapterRepository } from "../db/repositories/chapter-repo";
import type { AiSendChatMessageStreamInput, ChapterSummary } from "../shared/types";
import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimator";
import { getTokenBudget } from "./token-budget";

const CHAT_FIXED_CONTEXT_RESERVE_TOKENS = 800;
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

type ChatContextInput = AiSendChatMessageStreamInput;

function normalizeFullWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function parseChineseOrdinal(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(/[零〇]/g, "");
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  if (!/^[一二两三四五六七八九十百]+$/.test(normalized)) {
    return null;
  }

  let total = 0;
  let currentDigit = 0;
  for (const char of normalized) {
    if (char === "百") {
      total += (currentDigit || 1) * 100;
      currentDigit = 0;
      continue;
    }

    if (char === "十") {
      total += (currentDigit || 1) * 10;
      currentDigit = 0;
      continue;
    }

    currentDigit = CHINESE_DIGITS[char] ?? 0;
  }

  const result = total + currentDigit;
  return result > 0 ? result : null;
}

export function parseExplicitChapterOrdinal(message: string): number | null {
  const normalized = normalizeFullWidthDigits(message);
  const match = /(?:第\s*)?([0-9一二两三四五六七八九十百零〇]+)\s*[章节回]/.exec(normalized);
  return match ? parseChineseOrdinal(match[1]) : null;
}

function ordinalFromChapterTitle(title: string): number | null {
  return parseExplicitChapterOrdinal(title);
}

export function resolveReferencedChapter(chapters: readonly ChapterSummary[], message: string): ChapterSummary | null {
  const ordinal = parseExplicitChapterOrdinal(message);
  if (!ordinal) {
    return null;
  }

  const explicitTitleMatch = chapters.find((chapter) => ordinalFromChapterTitle(chapter.title) === ordinal);
  if (explicitTitleMatch) {
    return explicitTitleMatch;
  }

  return chapters[ordinal - 1] ?? null;
}

function resolveCurrentChapter(chapters: readonly ChapterSummary[], chapterId: string | undefined): ChapterSummary | null {
  if (!chapterId) {
    return null;
  }

  return chapters.find((chapter) => chapter.id === chapterId) ?? null;
}

function buildBudgetedChapterExcerpt(input: ChatContextInput, title: string, plainText: string): string {
  const budget = getTokenBudget("chat");
  const usedTokens =
    estimateTextTokens(input.message) +
    estimateTextTokens(title) +
    estimateTextTokens(input.selectionText ?? "") +
    CHAT_FIXED_CONTEXT_RESERVE_TOKENS;
  const excerptBudget = Math.max(0, budget.maxInputTokens - usedTokens);
  return truncateTextToTokenBudget(plainText, excerptBudget).text;
}

export function enrichChatInputWithReferencedChapter<T extends ChatContextInput>(input: T, chapterRepo: ChapterRepository): T {
  if (!input.projectId) {
    return input;
  }

  const chapters = chapterRepo.listByProject(input.projectId);
  const requestedOrdinal = parseExplicitChapterOrdinal(input.message);
  const targetChapter = requestedOrdinal ? resolveReferencedChapter(chapters, input.message) : resolveCurrentChapter(chapters, input.chapterId);
  if (!targetChapter) {
    if (requestedOrdinal) {
      throw new Error(`找不到第${requestedOrdinal}章，无法为 AI 对话提供对应章节内容。`);
    }
    return input;
  }

  const content = chapterRepo.getContent(targetChapter.id);
  if (!content) {
    if (requestedOrdinal) {
      throw new Error(`找不到第${requestedOrdinal}章的正文内容。`);
    }
    return input;
  }

  return {
    ...input,
    chapterId: content.id,
    currentChapterTitle: content.title,
    chapterExcerpt: buildBudgetedChapterExcerpt(input, content.title, content.plainText)
  } as T;
}
