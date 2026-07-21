import { describe, expect, it } from "vitest";
import {
  completeReviewProgress,
  estimateReviewRemainingMs,
  formatReviewDuration,
  formatReviewRemainingText,
  retainAvailableChapterSelection
} from "../../src/renderer/routes/chapter-review-view-model";

describe("chapter review view model", () => {
  it("does not auto-select the first chapter when the current selection is empty", () => {
    const chapters = [
      { id: "chapter_1" },
      { id: "chapter_2" }
    ];

    expect(retainAvailableChapterSelection([], chapters)).toEqual([]);
  });

  it("retains only selected chapters that still exist", () => {
    const chapters = [
      { id: "chapter_2" },
      { id: "chapter_3" }
    ];

    expect(retainAvailableChapterSelection(["chapter_1", "chapter_2"], chapters)).toEqual(["chapter_2"]);
  });

  it("formats elapsed review time for the progress panel", () => {
    expect(formatReviewDuration(0)).toBe("0秒");
    expect(formatReviewDuration(59_000)).toBe("59秒");
    expect(formatReviewDuration(61_000)).toBe("1分01秒");
    expect(formatReviewDuration(3_661_000)).toBe("61分01秒");
  });

  it("estimates remaining time from completed progress", () => {
    expect(estimateReviewRemainingMs({ completedChunks: 0, totalChunks: 4, elapsedMs: 30_000 })).toBeNull();
    expect(estimateReviewRemainingMs({ completedChunks: 2, totalChunks: 4, elapsedMs: 60_000 })).toBe(60_000);
    expect(estimateReviewRemainingMs({ completedChunks: 4, totalChunks: 4, elapsedMs: 60_000 })).toBe(0);
  });

  it("avoids fake remaining-time estimates while parallel review requests are still in the same wave", () => {
    expect(estimateReviewRemainingMs({ completedChunks: 1, totalChunks: 2, elapsedMs: 261_000, parallelCapacity: 2 })).toBeNull();
    expect(estimateReviewRemainingMs({ completedChunks: 2, totalChunks: 4, elapsedMs: 261_000, parallelCapacity: 2 })).toBe(261_000);
  });

  it("shows a concrete waiting state instead of a vague parallel-review label", () => {
    expect(formatReviewRemainingText({
      estimatedRemainingMs: null,
      completedChunks: 0,
      totalChunks: 2
    })).toBe("计算中");
    expect(formatReviewRemainingText({
      estimatedRemainingMs: null,
      completedChunks: 1,
      totalChunks: 2
    })).toBe("等待 1 个请求返回");
    expect(formatReviewRemainingText({
      estimatedRemainingMs: 61_000,
      completedChunks: 2,
      totalChunks: 4
    })).toBe("1分01秒");
  });

  it("forces a completed 100 percent progress state after a successful review response", () => {
    const progress = completeReviewProgress({
      currentProgress: {
        requestId: "chapter_review_request_1",
        projectId: "project_1",
        runId: "chapter_review_run_1",
        phase: "saving",
        totalChapters: 2,
        completedChapters: 2,
        currentChapterTitle: "第二章",
        totalChunks: 3,
        completedChunks: 3,
        progressPercent: 99,
        message: "已保存：第二章"
      },
      projectId: "project_1",
      requestId: "chapter_review_request_1",
      run: {
        id: "chapter_review_run_1",
        projectId: "project_1",
        chapterIds: ["chapter_1", "chapter_2"],
        status: "completed",
        issueCount: 0,
        requestedAt: "2026-06-15T00:00:00.000Z",
        completedAt: "2026-06-15T00:01:00.000Z",
        error: null,
        chapters: []
      },
      fallbackTotalChapters: 2
    });

    expect(progress).toMatchObject({
      phase: "completed",
      completedChapters: 2,
      completedChunks: 3,
      progressPercent: 100,
      message: "审稿完成"
    });
  });
});
