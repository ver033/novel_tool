import type { ChapterSummary, ScratchNoteRecord } from "../../main/shared/types";
import type { AppLocale } from "../../main/shared/language";

export const scratchpadFilters = ["全部", "灵感", "AI 输出", "置顶"] as const;

export type ScratchpadFilter = (typeof scratchpadFilters)[number];

export function getScratchpadFilterLabel(filter: ScratchpadFilter, locale: AppLocale): string {
  if (locale !== "ja-JP") return filter;
  return { "全部": "すべて", "灵感": "アイデア", "AI 输出": "AI 出力", "置顶": "固定" }[filter];
}

export function getLocalizedScratchNoteSourceLabel(note: ScratchNoteRecord, locale: AppLocale): string {
  const label = getScratchNoteSourceLabel(note);
  return locale === "ja-JP" ? (label === "AI 输出" ? "AI 出力" : "アイデア") : label;
}

export function getScratchNoteSourceLabel(note: ScratchNoteRecord): "灵感" | "AI 输出" {
  return note.sourceTaskId ? "AI 输出" : "灵感";
}

export function getScratchNoteChapterLabel(note: ScratchNoteRecord, chapters: readonly ChapterSummary[]): string {
  if (!note.chapterId) {
    return "未绑定章节";
  }

  return chapters.find((chapter) => chapter.id === note.chapterId)?.title ?? "章节已删除";
}

export function getLocalizedScratchNoteChapterLabel(note: ScratchNoteRecord, chapters: readonly ChapterSummary[], locale: AppLocale): string {
  if (note.chapterId) return chapters.find((chapter) => chapter.id === note.chapterId)?.title ?? (locale === "ja-JP" ? "削除された章" : "章节已删除");
  return locale === "ja-JP" ? "章との関連なし" : "未绑定章节";
}

export function sortScratchNotes(notes: readonly ScratchNoteRecord[]): ScratchNoteRecord[] {
  return [...notes].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return right.id.localeCompare(left.id);
  });
}

export function filterScratchNotes(notes: readonly ScratchNoteRecord[], filter: ScratchpadFilter): ScratchNoteRecord[] {
  const sorted = sortScratchNotes(notes);

  if (filter === "全部") {
    return sorted;
  }

  if (filter === "置顶") {
    return sorted.filter((note) => note.pinned);
  }

  return sorted.filter((note) => getScratchNoteSourceLabel(note) === filter);
}
