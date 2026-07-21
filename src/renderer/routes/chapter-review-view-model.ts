import type { ChapterReviewProgressEvent, ChapterReviewRunRecord } from "../../main/shared/types";

export type ReviewSelectionChapter = {
  readonly id: string;
};

export type ReviewRemainingEstimateInput = {
  readonly completedChunks: number;
  readonly totalChunks: number;
  readonly elapsedMs: number;
  readonly parallelCapacity?: number;
};

export type ReviewRemainingTextInput = {
  readonly estimatedRemainingMs: number | null;
  readonly completedChunks: number;
  readonly totalChunks: number;
};

export type CompleteReviewProgressInput = {
  readonly currentProgress: ChapterReviewProgressEvent | null;
  readonly projectId: string;
  readonly requestId: string;
  readonly run: ChapterReviewRunRecord;
  readonly fallbackTotalChapters: number;
};

export function retainAvailableChapterSelection(currentSelection: readonly string[], chapters: readonly ReviewSelectionChapter[]): string[] {
  const availableIds = new Set(chapters.map((chapter) => chapter.id));
  return currentSelection.filter((id) => availableIds.has(id));
}

export function formatReviewDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

export function estimateReviewRemainingMs(input: ReviewRemainingEstimateInput): number | null {
  if (input.totalChunks <= 0 || input.completedChunks <= 0) {
    return null;
  }
  if (input.completedChunks >= input.totalChunks) {
    return 0;
  }
  const parallelCapacity = Math.max(1, Math.floor(input.parallelCapacity ?? 1));
  if (parallelCapacity <= 1) {
    const averageChunkMs = input.elapsedMs / input.completedChunks;
    return Math.max(0, Math.round(averageChunkMs * (input.totalChunks - input.completedChunks)));
  }

  const completedWaves = Math.floor(input.completedChunks / parallelCapacity);
  const isPartialWave = input.completedChunks % parallelCapacity !== 0;
  if (completedWaves <= 0 || isPartialWave) {
    return null;
  }

  const averageWaveMs = input.elapsedMs / completedWaves;
  const remainingWaves = Math.ceil((input.totalChunks - input.completedChunks) / parallelCapacity);
  return Math.max(0, Math.round(averageWaveMs * remainingWaves));
}

export function formatReviewRemainingText(input: ReviewRemainingTextInput): string {
  if (input.estimatedRemainingMs !== null) {
    return formatReviewDuration(input.estimatedRemainingMs);
  }
  if (input.completedChunks > 0 && input.completedChunks < input.totalChunks) {
    const remainingRequests = Math.max(1, input.totalChunks - input.completedChunks);
    return `等待 ${remainingRequests} 个请求返回`;
  }
  return "计算中";
}

export function completeReviewProgress(input: CompleteReviewProgressInput): ChapterReviewProgressEvent {
  const totalChapters = input.currentProgress?.totalChapters ?? (input.run.chapterIds.length || input.fallbackTotalChapters);
  const totalChunks = input.currentProgress?.totalChunks ?? Math.max(1, input.run.chapters.reduce((total, chapter) => total + Math.max(1, chapter.chunkCount), 0));
  return {
    requestId: input.requestId,
    projectId: input.projectId,
    runId: input.run.id,
    phase: "completed",
    totalChapters,
    completedChapters: totalChapters,
    currentChapterTitle: null,
    totalChunks,
    completedChunks: totalChunks,
    progressPercent: 100,
    message: "审稿完成"
  };
}
