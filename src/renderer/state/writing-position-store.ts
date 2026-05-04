import type { ChapterSummary } from "../../main/shared/types";

export type WritingPositionRecord = {
  readonly chapterId: string;
  readonly projectId: string;
  readonly updatedAt: string;
};

type SaveWritingPositionInput = {
  readonly chapterId: string;
  readonly projectId: string;
};

const WRITING_POSITION_PREFIX = "moshu-writing-position:";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function storageKey(projectId: string): string {
  return `${WRITING_POSITION_PREFIX}${projectId}`;
}

export function saveLastWritingPosition(input: SaveWritingPositionInput): void {
  const store = storage();
  if (!store) {
    return;
  }

  try {
    store.setItem(
      storageKey(input.projectId),
      JSON.stringify({
        chapterId: input.chapterId,
        projectId: input.projectId,
        updatedAt: new Date().toISOString()
      } satisfies WritingPositionRecord)
    );
  } catch {
    // Last-position recovery is a convenience layer and must never affect editing.
  }
}

export function getLastWritingPosition(projectId: string): WritingPositionRecord | null {
  const store = storage();
  if (!store) {
    return null;
  }

  try {
    const raw = store.getItem(storageKey(projectId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as WritingPositionRecord;
    return parsed?.projectId === projectId && typeof parsed.chapterId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveInitialActiveChapterId(projectId: string, chapters: readonly ChapterSummary[]): string | null {
  const lastChapterId = getLastWritingPosition(projectId)?.chapterId ?? null;
  if (lastChapterId && chapters.some((chapter) => chapter.id === lastChapterId)) {
    return lastChapterId;
  }
  return chapters[0]?.id ?? null;
}
