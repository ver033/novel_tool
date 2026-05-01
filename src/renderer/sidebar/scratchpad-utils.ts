import type { ScratchNoteRecord } from "../../main/shared/types";

export const scratchpadFilters = ["全部", "灵感", "AI 输出", "置顶"] as const;

export type ScratchpadFilter = (typeof scratchpadFilters)[number];

export function getScratchNoteSourceLabel(note: ScratchNoteRecord): "灵感" | "AI 输出" {
  return note.sourceTaskId ? "AI 输出" : "灵感";
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
