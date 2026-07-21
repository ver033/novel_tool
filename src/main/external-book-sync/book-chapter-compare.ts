import type { ChapterSummary, ImportPreviewChapter } from "../shared/types";
import { parseChapterOrdinal } from "./book-chapter-ordinal";

export type ExternalBookMissingChapter = ImportPreviewChapter & {
  readonly ordinal: number | null;
  readonly key: string;
};

export type ExternalBookReferenceChapter = ImportPreviewChapter & {
  readonly ordinal: number | null;
  readonly key: string;
  readonly projectChapterTitle: string;
};

export type ExternalBookComparisonResult = {
  readonly currentLatestOrdinal: number | null;
  readonly currentChapterCount: number;
  readonly externalLatestOrdinal: number | null;
  readonly externalChapterCount: number;
  readonly latestProjectChapterInExternal: ExternalBookReferenceChapter | null;
  readonly missingChapters: readonly ExternalBookMissingChapter[];
  readonly warnings: readonly string[];
};

export type CompareExternalBookChaptersInput = {
  readonly projectChapters: readonly Pick<ChapterSummary, "id" | "title" | "sortOrder" | "wordCount">[];
  readonly externalChapters: readonly ImportPreviewChapter[];
};

function normalizeTitle(title: string): string {
  return title.replace(/[\s　、:：.-]+/gu, "").toLocaleLowerCase("zh-CN");
}

function maxOrdinal(titles: readonly string[]): number | null {
  const ordinals = titles.map(parseChapterOrdinal).filter((value): value is number => value !== null);
  return ordinals.length > 0 ? Math.max(...ordinals) : null;
}

function createMissingChapterKey(chapter: ImportPreviewChapter, ordinal: number | null): string {
  return `book_${ordinal ?? "unknown"}_${chapter.order}_${chapter.lineStart}_${normalizeTitle(chapter.title).slice(0, 48)}`;
}

function findLatestProjectChapterInExternal(
  projectChapters: readonly Pick<ChapterSummary, "id" | "title" | "sortOrder" | "wordCount">[],
  externalChapters: readonly ImportPreviewChapter[]
): ExternalBookReferenceChapter | null {
  const latestProjectChapter = projectChapters.at(-1);
  if (!latestProjectChapter) {
    return null;
  }

  const latestTitleKey = normalizeTitle(latestProjectChapter.title);
  const latestOrdinal = parseChapterOrdinal(latestProjectChapter.title);
  const externalChapter =
    externalChapters.find((chapter) => latestTitleKey && normalizeTitle(chapter.title) === latestTitleKey) ??
    (latestOrdinal !== null ? externalChapters.find((chapter) => parseChapterOrdinal(chapter.title) === latestOrdinal) : undefined);
  if (!externalChapter) {
    return null;
  }

  const ordinal = parseChapterOrdinal(externalChapter.title);
  return {
    ...externalChapter,
    ordinal,
    key: createMissingChapterKey(externalChapter, ordinal),
    projectChapterTitle: latestProjectChapter.title
  };
}

function duplicateTitleWarnings(chapters: readonly ImportPreviewChapter[]): string[] {
  const counts = new Map<string, number>();
  for (const chapter of chapters) {
    const key = normalizeTitle(chapter.title);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([title]) => `外部 .Book 中存在重复章节标题：${title}`);
}

function gapWarnings(missingChapters: readonly ExternalBookMissingChapter[], currentLatestOrdinal: number | null): string[] {
  if (currentLatestOrdinal === null || missingChapters.length === 0) {
    return [];
  }
  const ordinals = missingChapters.map((chapter) => chapter.ordinal).filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (ordinals.length === 0) {
    return [];
  }
  const warnings: string[] = [];
  let expected = currentLatestOrdinal + 1;
  for (const ordinal of ordinals) {
    while (expected < ordinal) {
      warnings.push(`外部 .Book 缺少第 ${expected} 章，检测结果存在章节序号跳跃。`);
      expected += 1;
    }
    expected = ordinal + 1;
  }
  return warnings;
}

export function compareExternalBookChapters(input: CompareExternalBookChaptersInput): ExternalBookComparisonResult {
  const projectChapters = [...input.projectChapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const projectTitleKeys = new Set(projectChapters.map((chapter) => normalizeTitle(chapter.title)));
  const projectOrdinals = new Set(projectChapters.map((chapter) => parseChapterOrdinal(chapter.title)).filter((value): value is number => value !== null));
  const currentLatestOrdinal = maxOrdinal(projectChapters.map((chapter) => chapter.title));
  const externalLatestOrdinal = maxOrdinal(input.externalChapters.map((chapter) => chapter.title));
  const missingChapters: ExternalBookMissingChapter[] = [];

  for (const chapter of input.externalChapters) {
    const ordinal = parseChapterOrdinal(chapter.title);
    const titleKey = normalizeTitle(chapter.title);
    const existsByTitle = projectTitleKeys.has(titleKey);
    const existsByOrdinal = ordinal !== null && projectOrdinals.has(ordinal);
    if (existsByTitle || existsByOrdinal) {
      continue;
    }
    const isMissingByOrdinal = currentLatestOrdinal !== null && ordinal !== null;
    const isMissingByOrder = currentLatestOrdinal === null && chapter.order >= projectChapters.length;
    if (!isMissingByOrdinal && !isMissingByOrder) {
      continue;
    }
    missingChapters.push({
      ...chapter,
      ordinal,
      key: createMissingChapterKey(chapter, ordinal)
    });
  }

  return {
    currentLatestOrdinal,
    currentChapterCount: projectChapters.length,
    externalLatestOrdinal,
    externalChapterCount: input.externalChapters.length,
    latestProjectChapterInExternal: findLatestProjectChapterInExternal(projectChapters, input.externalChapters),
    missingChapters,
    warnings: [...duplicateTitleWarnings(input.externalChapters), ...gapWarnings(missingChapters, currentLatestOrdinal)]
  };
}
