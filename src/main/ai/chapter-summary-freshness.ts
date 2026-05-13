import type { ChapterAiSummaryRecord } from "../db/repositories/summary-repo";
import { computeChapterContentHash } from "../shared/summary-index";
import type { ChapterContent, ChapterSummary } from "../shared/types";

export type ChapterSummaryCacheState = "missing" | "ready" | "skipped_too_short" | "stale";

type ChapterFreshnessSource = Pick<ChapterSummary, "contentUpdatedAt" | "updatedAt"> & Partial<Pick<ChapterContent, "plainText">>;

function isSummaryFreshForChapter(summary: ChapterAiSummaryRecord, chapter: ChapterFreshnessSource): boolean {
  if (typeof chapter.plainText === "string") {
    return summary.contentHash === computeChapterContentHash(chapter.plainText);
  }

  return summary.updatedAt >= (chapter.contentUpdatedAt ?? chapter.updatedAt);
}

export function isFreshReadyChapterSummary(
  summary: ChapterAiSummaryRecord | null | undefined,
  chapter: ChapterFreshnessSource
): summary is ChapterAiSummaryRecord {
  return Boolean(summary && summary.status === "ready" && isSummaryFreshForChapter(summary, chapter));
}

export function isFreshSkippedTooShortChapterSummary(
  summary: ChapterAiSummaryRecord | null | undefined,
  chapter: ChapterFreshnessSource
): summary is ChapterAiSummaryRecord {
  return Boolean(summary && summary.status === "skipped_too_short" && isSummaryFreshForChapter(summary, chapter));
}

export function getChapterSummaryCacheState(
  summary: ChapterAiSummaryRecord | null | undefined,
  chapter: ChapterFreshnessSource
): ChapterSummaryCacheState {
  if (!summary) {
    return "missing";
  }
  if (isFreshReadyChapterSummary(summary, chapter)) {
    return "ready";
  }
  if (isFreshSkippedTooShortChapterSummary(summary, chapter)) {
    return "skipped_too_short";
  }
  return "stale";
}
