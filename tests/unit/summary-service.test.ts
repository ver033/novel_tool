import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryService } from "../../src/main/ai/summary-service";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { computeChapterContentHash, computeSourceHash, type ChapterAiSummaryPayload } from "../../src/main/shared/summary-index";

const tempDirs: string[] = [];
const createdAt = "2026-05-01T00:00:00.000Z";

function createDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-summary-service-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  return db;
}

function seedProject(db: SqliteDatabase): { readonly chapterRepo: ChapterRepository; readonly summaryRepo: SummaryRepository } {
  new ProjectRepository(db).create({
    id: "project_1",
    name: "归途",
    rootPath: null,
    createdAt,
    updatedAt: createdAt
  });
  return {
    chapterRepo: new ChapterRepository(db),
    summaryRepo: new SummaryRepository(db)
  };
}

function createChapter(chapterRepo: ChapterRepository, chapterId: string, plainText: string) {
  return chapterRepo.create({
    id: chapterId,
    projectId: "project_1",
    title: "第1章",
    volumeTitle: "第一卷",
    sortOrder: 0,
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: plainText }] }] },
    plainText,
    wordCount: plainText.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt
  });
}

function summaryPayload(): ChapterAiSummaryPayload {
  return {
    oneLine: "林远回到故乡。",
    synopsis: "林远在风雨中回到故乡，旧日关系重新浮出水面。",
    keyEvents: ["林远回乡"],
    characterMentions: [{ name: "林远", roleInChapter: "主角", stateOrChange: "回到故乡" }],
    relationshipHints: [],
    timeAndPlace: ["故乡"],
    foreshadowingHints: [],
    unresolvedQuestions: [],
    emotionalArc: "从犹疑到平静",
    importantQuotes: []
  };
}

function upsertReadyChapterSummary(summaryRepo: SummaryRepository, input: { readonly chapterId: string; readonly title: string; readonly order: number; readonly content: string }) {
  return summaryRepo.upsertChapterSummary({
    id: `summary_${input.chapterId}`,
    projectId: "project_1",
    chapterId: input.chapterId,
    chapterTitle: input.title,
    chapterOrder: input.order,
    contentHash: computeChapterContentHash(input.content),
    summaryShort: `${input.title}短摘要`,
    summaryLong: `${input.title}长摘要`,
    structured: summaryPayload(),
    tokenCount: 30,
    status: "ready",
    error: null,
    createdAt,
    updatedAt: createdAt
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("summary service queue policy", () => {
  it("does not enqueue automatic summaries for a newly started tiny chapter", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "开头");
    const service = new SummaryService(summaryRepo, chapterRepo);

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "auto_idle",
      now: "2026-05-01T00:10:00.000Z"
    });

    expect(job).toBeNull();
    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 0 });
    db.close();
  });

  it("marks very short manual rebuild targets as skipped without enqueueing a model job", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "开头");
    const service = new SummaryService(summaryRepo, chapterRepo);

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "manual_rebuild",
      now: "2026-05-01T00:10:00.000Z"
    });

    expect(job).toBeNull();
    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toMatchObject({
      status: "skipped_too_short"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 0 });
    db.close();
  });

  it("does not enqueue automatic summaries for short draft chapters below the auto threshold", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(300));
    const service = new SummaryService(summaryRepo, chapterRepo);

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "chapter_inactive",
      now: "2026-05-01T00:10:00.000Z"
    });

    expect(job).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 0 });
    db.close();
  });

  it("waits for the active chapter to become idle before enqueueing", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(600));
    const service = new SummaryService(summaryRepo, chapterRepo);
    service.recordActiveChapterEdit("project_1", "chapter_1", "2026-05-01T00:09:00.000Z");

    expect(
      service.maybeEnqueueChapterSummary({
        projectId: "project_1",
        chapterId: "chapter_1",
        trigger: "auto_idle",
        now: "2026-05-01T00:10:00.000Z"
      })
    ).toBeNull();

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "auto_idle",
      now: "2026-05-01T00:15:01.000Z"
    });

    expect(job).toMatchObject({ jobType: "chapter_summary", targetId: "chapter_1", status: "queued" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 1 });
    db.close();
  });

  it("coalesces repeated eligible checks into one job", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(600));
    const service = new SummaryService(summaryRepo, chapterRepo);

    const first = service.onChapterBecameInactive("project_1", "chapter_1", "2026-05-01T00:10:00.000Z");
    const second = service.onChapterBecameInactive("project_1", "chapter_1", "2026-05-01T00:11:00.000Z");

    expect(second?.id).toBe(first?.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 1 });
    db.close();
  });

  it("does not enqueue an automatic job when the ready summary already matches the chapter content", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(600);
    createChapter(chapterRepo, "chapter_1", content);
    summaryRepo.upsertChapterSummary({
      id: "summary_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      chapterOrder: 1,
      contentHash: computeChapterContentHash(content),
      summaryShort: "林远回到故乡。",
      summaryLong: "林远在风雨中回到故乡，旧日关系重新浮出水面。",
      structured: summaryPayload(),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const service = new SummaryService(summaryRepo, chapterRepo);

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "import",
      now: "2026-05-01T00:10:00.000Z"
    });

    expect(job).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 0 });
    db.close();
  });

  it("queues minor edits with low priority", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(600));
    const service = new SummaryService(summaryRepo, chapterRepo);

    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: "春".repeat(600),
      nextPlainText: "春".repeat(620),
      previousWordCount: 600,
      nextWordCount: 620,
      updatedAt: "2026-05-01T00:10:00.000Z"
    });
    service.recordActiveChapterEdit("project_1", "chapter_1", "2026-05-01T00:10:00.000Z");

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "auto_idle",
      now: "2026-05-01T00:16:00.000Z"
    });

    expect(job).toMatchObject({ priority: 1 });
    db.close();
  });

  it("enqueues stale chapter summaries only after the edited chapter becomes idle", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const oldContent = "春".repeat(620);
    const newContent = "春".repeat(700);
    createChapter(chapterRepo, "chapter_1", newContent);
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: oldContent });
    const service = new SummaryService(summaryRepo, chapterRepo);
    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: oldContent,
      nextPlainText: newContent,
      previousWordCount: 620,
      nextWordCount: 700,
      updatedAt: "2026-05-01T00:10:00.000Z"
    });

    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:11:00.000Z")).toEqual([]);
    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:16:00.000Z")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 1 });
    db.close();
  });

  it("enqueues a missing chapter summary after a newly written long chapter becomes idle", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    const service = new SummaryService(summaryRepo, chapterRepo);
    service.recordActiveChapterEdit("project_1", "chapter_1", "2026-05-01T00:10:00.000Z");

    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:11:00.000Z")).toEqual([]);
    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:16:00.000Z")).toHaveLength(1);
    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:17:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      targetId: "chapter_1"
    });
    db.close();
  });
});

describe("summary service generation", () => {
  it("generates and stores a ready chapter summary when the source hash still matches", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(620);
    createChapter(chapterRepo, "chapter_1", content);
    const generator = {
      summarizeChapterForIndex: async () => summaryPayload()
    };
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    const summary = await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z");

    expect(summary).toMatchObject({
      projectId: "project_1",
      chapterId: "chapter_1",
      contentHash: computeChapterContentHash(content),
      summaryShort: "林远回到故乡。",
      summaryLong: "林远在风雨中回到故乡，旧日关系重新浮出水面。",
      status: "ready"
    });
    expect(summary.structured).toEqual(summaryPayload());
    db.close();
  });

  it("queues the affected arc after a chapter summary becomes ready and the arc range is complete", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content1 = "春".repeat(620);
    const content2 = "夏".repeat(620);
    createChapter(chapterRepo, "chapter_1", content1);
    createChapter(chapterRepo, "chapter_2", content2);
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_2", title: "第2章", order: 2, content: content2 });
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayload()
      }
    });

    await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content1), "2026-05-01T00:10:00.000Z");

    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:11:00.000Z")).toMatchObject({
      jobType: "arc_summary",
      targetId: "auto:001-002",
      sourceHash: computeSourceHash([computeChapterContentHash(content1), computeChapterContentHash(content2)])
    });
    db.close();
  });

  it("discards an in-flight chapter summary when the chapter content changes before persistence", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const oldContent = "春".repeat(620);
    const newContent = "夏".repeat(660);
    createChapter(chapterRepo, "chapter_1", oldContent);
    summaryRepo.upsertChapterSummary({
      id: "summary_old",
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      chapterOrder: 1,
      contentHash: computeChapterContentHash(oldContent),
      summaryShort: "旧摘要",
      summaryLong: "旧摘要仍应保留。",
      structured: summaryPayload(),
      tokenCount: 10,
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const generator = {
      summarizeChapterForIndex: async () => {
        chapterRepo.saveContent(
          "chapter_1",
          { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: newContent }] }] },
          newContent,
          newContent.length,
          0,
          "2026-05-01",
          "2026-05-01T00:11:00.000Z"
        );
        return {
          ...summaryPayload(),
          oneLine: "不应该写入的新摘要",
          synopsis: "不应该写入的新摘要。"
        };
      }
    };
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    await expect(
      service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(oldContent), "2026-05-01T00:10:00.000Z")
    ).rejects.toThrow("章节内容已变化");

    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toMatchObject({
      summaryShort: "旧摘要",
      contentHash: computeChapterContentHash(oldContent),
      status: "ready"
    });
    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:12:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: computeChapterContentHash(newContent)
    });
    db.close();
  });

  it("generates an arc summary only from ready chapter summaries", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: "春".repeat(620) });
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_2", title: "第2章", order: 2, content: "夏".repeat(620) });
    const sourceHash = computeSourceHash([computeChapterContentHash("春".repeat(620)), computeChapterContentHash("夏".repeat(620))]);
    const generator = {
      summarizeChapterForIndex: async () => summaryPayload(),
      summarizeArcForIndex: async () => ({
        chapterFrom: 1,
        chapterTo: 2,
        synopsis: "第1-2章阶段摘要。",
        keyEvents: ["主角回乡", "新冲突出现"],
        characterChanges: ["林远开始面对往事"],
        relationshipChanges: ["旧友关系重新浮现"],
        foreshadowingHints: ["旧信仍未解释"],
        unresolvedQuestions: ["旧信来源未知"]
      })
    };
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    const summary = await service.summarizeArc("project_1", "auto:001-002", 1, 2, sourceHash, "2026-05-01T00:10:00.000Z");

    expect(summary).toMatchObject({
      projectId: "project_1",
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash,
      summary: "第1-2章阶段摘要。",
      status: "ready"
    });
    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:11:00.000Z")).toMatchObject({
      jobType: "book_summary"
    });
    db.close();
  });

  it("does not generate an arc summary while any child chapter summary is missing", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: "春".repeat(620) });
    let generatorCalls = 0;
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayload(),
        summarizeArcForIndex: async () => {
          generatorCalls += 1;
          throw new Error("should not generate");
        }
      }
    });

    await expect(
      service.summarizeArc("project_1", "auto:001-002", 1, 2, "source", "2026-05-01T00:10:00.000Z")
    ).rejects.toThrow("阶段摘要等待章节摘要完成");

    expect(generatorCalls).toBe(0);
    db.close();
  });

  it("stores a book summary with authoritative coverage from the summary index", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: "春".repeat(620) });
    summaryRepo.upsertChapterSummary({
      id: "summary_chapter_2",
      projectId: "project_1",
      chapterId: "chapter_2",
      chapterTitle: "第2章",
      chapterOrder: 2,
      contentHash: computeChapterContentHash("夏".repeat(620)),
      summaryShort: "过期摘要",
      summaryLong: "过期摘要",
      structured: summaryPayload(),
      tokenCount: 30,
      status: "stale",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    summaryRepo.upsertArcSummary({
      id: "arc_1",
      projectId: "project_1",
      arcKey: "auto:001-001",
      chapterFrom: 1,
      chapterTo: 1,
      sourceHash: computeChapterContentHash("春".repeat(620)),
      summary: "第1章阶段摘要。",
      structured: {
        chapterFrom: 1,
        chapterTo: 1,
        synopsis: "第1章阶段摘要。",
        keyEvents: ["主角回乡"],
        characterChanges: [],
        relationshipChanges: [],
        foreshadowingHints: [],
        unresolvedQuestions: []
      },
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const sourceHash = computeSourceHash([
      computeChapterContentHash("春".repeat(620)),
      JSON.stringify({ indexed: 1, total: 2, stale: ["chapter_2"], missing: [], skipped: [] })
    ]);
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayload(),
        summarizeBookForIndex: async () => ({
          coverage: {
            totalChapterCount: 999,
            indexedChapterCount: 999,
            staleChapterIds: [],
            missingChapterIds: [],
            skippedTooShortChapterIds: []
          },
          synopsis: "全书摘要。",
          mainPlot: ["主角回乡"],
          majorCharacters: [{ name: "林远", summary: "回到故乡" }],
          majorConflicts: ["旧事未解"],
          relationshipChanges: [],
          foreshadowingHints: [],
          unresolvedQuestions: ["旧信来源未知"]
        })
      }
    });

    const summary = await service.summarizeBook("project_1", sourceHash, "2026-05-01T00:10:00.000Z");

    expect(summary.structured.coverage).toEqual({
      totalChapterCount: 2,
      indexedChapterCount: 1,
      staleChapterIds: ["chapter_2"],
      missingChapterIds: [],
      skippedTooShortChapterIds: []
    });
    expect(summary.summaryShort).toBe("全书摘要。");
    db.close();
  });
});

describe("summary index status and rebuild controls", () => {
  it("reports summary coverage, stale chapters, skipped chapters, failed jobs, and the running job label", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    createChapter(chapterRepo, "chapter_3", "秋".repeat(20));
    createChapter(chapterRepo, "chapter_4", "冬".repeat(620));
    chapterRepo.rename("chapter_2", "第2章", "2026-05-01T00:09:00.000Z");
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: "春".repeat(620) });
    summaryRepo.upsertChapterSummary({
      id: "summary_chapter_2",
      projectId: "project_1",
      chapterId: "chapter_2",
      chapterTitle: "第2章",
      chapterOrder: 2,
      contentHash: computeChapterContentHash("夏".repeat(620)),
      summaryShort: "第2章旧摘要",
      summaryLong: "第2章旧摘要",
      structured: summaryPayload(),
      tokenCount: 30,
      status: "stale",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const service = new SummaryService(summaryRepo, chapterRepo);
    service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_3",
      trigger: "manual_rebuild",
      now: "2026-05-01T00:10:00.000Z"
    });
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: "hash_2",
      priority: 5,
      now: "2026-05-01T00:11:00.000Z"
    });
    const running = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:12:00.000Z");
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "book_summary",
      targetId: null,
      sourceHash: "book_hash",
      priority: 4,
      now: "2026-05-01T00:13:00.000Z"
    });
    const failed = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:14:00.000Z");
    summaryRepo.failSummaryJob(failed?.id ?? "missing", "上游限流", null, "2026-05-01T00:15:00.000Z");

    const status = service.getIndexStatus("project_1", "2026-05-01T00:16:00.000Z", { pausedReason: "foreground_ai_active" });

    expect(running).toMatchObject({ status: "running", targetId: "chapter_2" });
    expect(status).toMatchObject({
      projectId: "project_1",
      totalChapterCount: 4,
      readyChapterCount: 1,
      staleChapterCount: 1,
      skippedTooShortChapterCount: 1,
      missingChapterCount: 1,
      failedJobCount: 1,
      queuedJobCount: 0,
      runningJobLabel: "正在摘要：第2章",
      pausedReason: "foreground_ai_active",
      updatedAt: "2026-05-01T00:16:00.000Z"
    });
    db.close();
  });

  it("rebuilds the project index by enqueueing eligible chapters without requiring a generator", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(100));
    createChapter(chapterRepo, "chapter_3", "开头");
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.rebuildProjectIndex("project_1", "2026-05-01T00:20:00.000Z");

    expect(status).toMatchObject({
      totalChapterCount: 3,
      readyChapterCount: 0,
      staleChapterCount: 0,
      skippedTooShortChapterCount: 1,
      missingChapterCount: 2,
      queuedJobCount: 2,
      runningJobLabel: null,
      pausedReason: null
    });
    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:21:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      status: "running"
    });
    db.close();
  });
});
