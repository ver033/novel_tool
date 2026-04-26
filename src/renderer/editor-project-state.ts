import type { IpcResponse } from '../shared/ipc-contracts';

type ChapterListResult = IpcResponse<'chapters.list'>;

export function pickInitialChapterId(chapters: ChapterListResult): string | null {
  return chapters.find((chapter) => chapter.paragraphCount > 0)?.id ?? chapters[0]?.id ?? null;
}

export function shouldLoadWorkspaceProject(input: {
  activeChapterId: string | null;
  chapterCount: number;
  skipNextReload: boolean;
}): boolean {
  if (input.skipNextReload) {
    return false;
  }
  return !input.activeChapterId && input.chapterCount === 0;
}
