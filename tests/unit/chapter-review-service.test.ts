import { describe, expect, it, vi } from "vitest";
import { ChapterReviewService, type ChapterReviewClient } from "../../src/main/chapter-review/chapter-review-service";
import type { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import type { ChapterReviewRepository } from "../../src/main/db/repositories/chapter-review-repo";
import type { ChapterReviewProgressEvent } from "../../src/main/shared/chapter-review";

function createChapter(id: string, title: string, sortOrder: number, plainText: string) {
  return {
    id,
    projectId: "project_1",
    title,
    volumeTitle: "第一卷",
    sortOrder,
    contentJson: { type: "doc", content: [] },
    plainText,
    wordCount: plainText.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft" as const,
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    contentUpdatedAt: "2026-05-28T00:00:00.000Z"
  };
}

describe("ChapterReviewService", () => {
  it("reviews selected chapters in chapter order and stores one run", async () => {
    const chapters = [
      createChapter("chapter_2", "第二章", 2, "第二章正文。"),
      createChapter("chapter_1", "第一章", 1, "第一章正文。")
    ];
    const chapterRepo = {
      listByProject: vi.fn(() => chapters.map(({ plainText, contentJson, ...summary }) => summary)),
      getContent: vi.fn((chapterId: string) => chapters.find((chapter) => chapter.id === chapterId) ?? null)
    } as unknown as ChapterRepository;
    const reviewRepo = {
      createRun: vi.fn((input) => ({ ...input, completedAt: null, error: null, issueCount: 0, chapters: [] })),
      saveChapterResult: vi.fn(),
      completeRun: vi.fn(),
      failRun: vi.fn(),
      getRun: vi.fn(() => ({ id: "review_run_1", projectId: "project_1", chapterIds: ["chapter_1", "chapter_2"], status: "completed", issueCount: 0, chapters: [] }))
    } as unknown as ChapterReviewRepository;
    const client: ChapterReviewClient = {
      review: vi.fn(async () => ({
        summary: "本章可读。",
        readabilityScore: 4,
        aiToneRisk: "low" as const,
        issues: []
      }))
    };
    const service = new ChapterReviewService({
      resolveChapterRepo: () => chapterRepo,
      resolveReviewRepo: () => reviewRepo,
      getProjectName: () => "斗破测试",
      createClient: async () => client,
      now: () => "2026-05-28T01:00:00.000Z",
      createId: (prefix) => `${prefix}_1`
    });

    await service.startReview({ projectId: "project_1", chapterIds: ["chapter_2", "chapter_1"] });

    expect(reviewRepo.createRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "chapter_review_run_1",
      chapterIds: ["chapter_1", "chapter_2"],
      status: "running"
    }));
    expect(vi.mocked(client.review).mock.calls.map(([input]) => input.chapterTitle)).toEqual(["第一章", "第二章"]);
    expect(reviewRepo.saveChapterResult).toHaveBeenCalledTimes(2);
    expect(reviewRepo.completeRun).toHaveBeenCalledWith("chapter_review_run_1", "project_1", "2026-05-28T01:00:00.000Z");
  });

  it("splits long chapters into multiple model requests and merges issues", async () => {
    const longText = Array.from({ length: 160 }, (_, index) => `第${index + 1}段，萧炎沿着石阶向前，夜风卷过长街。`).join("\n\n");
    const chapter = createChapter("chapter_1", "第一章", 1, longText);
    const chapterRepo = {
      listByProject: vi.fn(() => [{ ...chapter, plainText: undefined, contentJson: undefined }]),
      getContent: vi.fn(() => chapter)
    } as unknown as ChapterRepository;
    const reviewRepo = {
      createRun: vi.fn((input) => ({ ...input, completedAt: null, error: null, issueCount: 0, chapters: [] })),
      saveChapterResult: vi.fn(),
      completeRun: vi.fn(),
      failRun: vi.fn(),
      getRun: vi.fn(() => ({ id: "review_run_1", projectId: "project_1", chapterIds: ["chapter_1"], status: "completed", issueCount: 1, chapters: [] }))
    } as unknown as ChapterReviewRepository;
    const client: ChapterReviewClient = {
      review: vi.fn(async () => ({
        summary: "分段结果。",
        readabilityScore: 3,
        aiToneRisk: "medium" as const,
        issues: [
          {
            code: "ai_tone" as const,
            severity: "medium" as const,
            quote: "复杂情绪",
            locationHint: "第 1 段",
            explanation: "抽象。",
            suggestion: "具体化。",
            evidence: [{ source: "target" as const, quote: "复杂情绪", note: "目标文本" }],
            canAutoApply: false,
            needsAuthorJudgment: true
          }
        ]
      }))
    };
    const service = new ChapterReviewService({
      resolveChapterRepo: () => chapterRepo,
      resolveReviewRepo: () => reviewRepo,
      getProjectName: () => "斗破测试",
      createClient: async () => client,
      maxChunkTokens: 320,
      now: () => "2026-05-28T01:00:00.000Z",
      createId: (prefix) => `${prefix}_1`
    });

    await service.startReview({ projectId: "project_1", chapterIds: ["chapter_1"] });

    expect(vi.mocked(client.review).mock.calls.length).toBeGreaterThan(1);
    expect(reviewRepo.saveChapterResult).toHaveBeenCalledWith(expect.objectContaining({
      chunkCount: vi.mocked(client.review).mock.calls.length,
      issues: expect.arrayContaining([expect.objectContaining({ code: "ai_tone" })])
    }));
  });

  it("keeps a 10000 character chapter in one default request and emits progress", async () => {
    const chapter = createChapter("chapter_1", "第一章", 1, "玄".repeat(10000));
    const chapterRepo = {
      listByProject: vi.fn(() => [{ ...chapter, plainText: undefined, contentJson: undefined }]),
      getContent: vi.fn(() => chapter)
    } as unknown as ChapterRepository;
    const reviewRepo = {
      createRun: vi.fn((input) => ({ ...input, completedAt: null, error: null, issueCount: 0, chapters: [] })),
      saveChapterResult: vi.fn(),
      completeRun: vi.fn(),
      failRun: vi.fn(),
      getRun: vi.fn(() => ({ id: "chapter_review_run_1", projectId: "project_1", chapterIds: ["chapter_1"], status: "completed", issueCount: 0, chapters: [] }))
    } as unknown as ChapterReviewRepository;
    const client: ChapterReviewClient = {
      review: vi.fn(async () => ({
        summary: "本章可读。",
        readabilityScore: 4,
        aiToneRisk: "none" as const,
        issues: []
      }))
    };
    const progressEvents: ChapterReviewProgressEvent[] = [];
    const service = new ChapterReviewService({
      resolveChapterRepo: () => chapterRepo,
      resolveReviewRepo: () => reviewRepo,
      getProjectName: () => "斗破测试",
      createClient: async () => client,
      now: () => "2026-05-28T01:00:00.000Z",
      createId: (prefix) => `${prefix}_1`
    });

    await service.startReview(
      { projectId: "project_1", chapterIds: ["chapter_1"], requestId: "chapter_review_request_1" },
      (event) => progressEvents.push(event)
    );

    expect(client.review).toHaveBeenCalledTimes(1);
    expect(progressEvents.map((event) => event.phase)).toEqual(expect.arrayContaining(["reviewing", "completed"]));
    expect(progressEvents.at(-1)).toMatchObject({
      requestId: "chapter_review_request_1",
      phase: "completed",
      completedChapters: 1,
      totalChapters: 1,
      completedChunks: 1,
      totalChunks: 1,
      progressPercent: 100
    });
  });
});
