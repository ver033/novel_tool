import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryService, splitChapterForSummaryIndex, type SummaryIndexGenerator } from "../../src/main/ai/summary-service";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { computeChapterContentHash, computeSourceHash, type ChapterAiSummaryPayload } from "../../src/main/shared/summary-index";
import { arcIndexPayloadV2, bookIndexPayloadV2, chapterChunkIndexPayload, chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

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

function summaryPayloadV2(): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    title: "第1章",
    oneLine: "林远回到故乡。",
    synopsis: "林远在风雨中回到故乡，旧日关系重新浮出水面。",
    detail: "林远在风雨中回到故乡，旧日关系重新浮出水面。旧信和旧宅共同构成本章需要后续承接的核心线索，人物状态、关系悬念和调查动机都被建立。"
  });
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
    structured: summaryPayloadV2(),
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
      now: "2026-05-01T00:24:01.000Z"
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
      structured: summaryPayloadV2(),
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

    const earlyJob = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "auto_idle",
      now: "2026-05-01T00:24:00.000Z"
    });
    expect(earlyJob).toBeNull();

    const job = service.maybeEnqueueChapterSummary({
      projectId: "project_1",
      chapterId: "chapter_1",
      trigger: "auto_idle",
      now: "2026-05-01T00:25:00.000Z"
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

    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:24:00.000Z")).toEqual([]);
    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:25:00.000Z")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 1 });
    db.close();
  });

  it("enqueues a missing chapter summary after a newly written long chapter becomes idle", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    const service = new SummaryService(summaryRepo, chapterRepo);
    service.recordActiveChapterEdit("project_1", "chapter_1", "2026-05-01T00:10:00.000Z");

    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:24:00.000Z")).toEqual([]);
    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:25:00.000Z")).toHaveLength(1);
    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:26:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      targetId: "chapter_1"
    });
    db.close();
  });

  it("does not enqueue automatic background chapter summaries while the background index is disabled", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const oldContent = "春".repeat(620);
    const newContent = "春".repeat(700);
    createChapter(chapterRepo, "chapter_1", newContent);
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: oldContent });
    const service = new SummaryService(summaryRepo, chapterRepo);
    summaryRepo.setBackgroundIndexEnabled("project_1", false, "2026-05-01T00:09:00.000Z");
    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: oldContent,
      nextPlainText: newContent,
      previousWordCount: 620,
      nextWordCount: 700,
      updatedAt: "2026-05-01T00:10:00.000Z"
    });

    expect(service.enqueueEligibleStaleChapterSummaries("project_1", "2026-05-01T00:40:00.000Z")).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 0 });
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
      summarizeChapterForIndex: async () => summaryPayloadV2()
    };
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    const summary = await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z");

    expect(summary).toMatchObject({
      projectId: "project_1",
      chapterId: "chapter_1",
      contentHash: computeChapterContentHash(content),
      summaryShort: "林远回到故乡。",
      summaryLong: "林远在风雨中回到故乡，旧日关系重新浮出水面。旧信和旧宅共同构成本章需要后续承接的核心线索，人物状态、关系悬念和调查动机都被建立。",
      status: "ready"
    });
    expect(summary.structured).toEqual(summaryPayloadV2());
    db.close();
  });

  it("stores V2 chapter fact indexes with Chinese summary fields as canonical display text", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(620);
    createChapter(chapterRepo, "chapter_1", content);
    const payload = chapterIndexPayloadV2({
      title: "第1章",
      oneLine: "林远在雨夜回到故乡并发现旧信。",
      synopsis: "林远冒雨回到多年未归的故乡，旧宅中的旧信让他意识到失踪往事仍有线索，决定继续追查。",
      detail: "林远在雨夜回到故乡，旧宅环境和旧信共同触发了他对失踪往事的追查。本章记录了他的回归状态、旧信作为关键道具的出现，以及后续必须承接的调查动机。"
    });
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => payload
      }
    });

    const summary = await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z");

    expect(summary.summaryShort).toBe("林远在雨夜回到故乡并发现旧信。");
    expect(summary.summaryLong).toBe("林远在雨夜回到故乡，旧宅环境和旧信共同触发了他对失踪往事的追查。本章记录了他的回归状态、旧信作为关键道具的出现，以及后续必须承接的调查动机。");
    expect(summary.structured).toEqual(payload);
    db.close();
  });

  it("indexes a 15000-unit chapter directly when the selected model has a large context window", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(15_000);
    createChapter(chapterRepo, "chapter_1", content);
    const calls: string[] = [];
    const generator = {
      getSummaryIndexBudget: async () => ({
        maxInputTokens: 90_000,
        modelContextTokens: 160_000
      }),
      summarizeChapterForIndex: async (input) => {
        calls.push(`direct:${input.plainText.length}`);
        return chapterIndexPayloadV2();
      },
      summarizeChapterChunkForIndex: async () => {
        throw new Error("large-context 15000-unit chapters should not be split");
      }
    } satisfies SummaryIndexGenerator;
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    const summary = await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z");

    expect(summary.status).toBe("ready");
    expect(calls).toEqual([`direct:${content.length}`]);
    expect(summaryRepo.listChapterSummaryChunks("project_1", "chapter_1", computeChapterContentHash(content))).toEqual([]);
    db.close();
  });

  it("uses larger chapter chunks on large-context models when the chapter is still too long for direct indexing", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(42_000);
    createChapter(chapterRepo, "chapter_1", content);
    const chunkInputs: Array<{ readonly index: number; readonly units: number }> = [];
    const generator = {
      getSummaryIndexBudget: async () => ({
        maxInputTokens: 90_000,
        modelContextTokens: 160_000
      }),
      summarizeChapterForIndex: async () => {
        throw new Error("very long chapters should still use chunk indexing");
      },
      summarizeChapterChunkForIndex: async (input) => {
        chunkInputs.push({ index: input.chunkIndex, units: input.plainText.length });
        return chapterChunkIndexPayload({
          chunkIndex: input.chunkIndex,
          chunkCount: input.chunkCount,
          summary: `第${input.chunkIndex + 1}个大片段缓存摘要`
        });
      }
    } satisfies SummaryIndexGenerator;
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z");

    expect(chunkInputs.length).toBeGreaterThan(1);
    expect(chunkInputs.length).toBeLessThanOrEqual(5);
    expect(Math.max(...chunkInputs.map((chunk) => chunk.units))).toBeGreaterThan(10_000);
    expect(chunkInputs.slice(0, -1).every((chunk) => chunk.units > 7000)).toBe(true);
    db.close();
  });

  it("indexes long chapters by locally aggregating chunk summaries without a model merge step", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = Array.from({ length: 14 }, (_, index) => `第${index + 1}段。${"春".repeat(650)}`).join("\n\n");
    createChapter(chapterRepo, "chapter_1", content);
    const expectedChunks = splitChapterForSummaryIndex(content);
    const chunkInputs: number[] = [];
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => {
          throw new Error("long chapters must use chunk indexing");
        },
        summarizeChapterChunkForIndex: async (input) => {
          chunkInputs.push(input.chunkIndex);
          return {
            ...chapterChunkIndexPayload({
            chunkIndex: input.chunkIndex,
            chunkCount: input.chunkCount,
            summary: `第${input.chunkIndex + 1}个片段缓存摘要`
            }),
            空间与行动逻辑: [
              {
                人物: "林远",
                移动或行动: `第${input.chunkIndex + 1}个片段中穿过旧宅走廊`,
                起点: "旧宅门口",
                终点: "旧宅内室",
                耗时或距离: "片刻",
                是否可能需要核对: "是",
                风险说明: "后文若声称林远未进入旧宅，需要核对移动线。",
                证据短句: ["穿过旧宅走廊"]
              }
            ],
            限制与否定事实: [
              {
                对象: "林远",
                限制或否定: `第${input.chunkIndex + 1}个片段尚未找到旧信来源`,
                影响范围: "旧信线索",
                后文检查意义: "后文不能直接声称旧信来源已经确认。",
                证据短句: ["旧信来源仍未解释"]
              }
            ]
          } as ReturnType<typeof chapterChunkIndexPayload>;
        },
        mergeChapterChunksForIndex: async () => {
          throw new Error("long chapter chunk merge should be deterministic and local");
        }
      }
    });

    const summary = await service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z");

    expect(chunkInputs).toEqual(expectedChunks.map((chunk) => chunk.chunkIndex));
    expect(summary).toMatchObject({ status: "ready", contentHash: computeChapterContentHash(content) });
    expect(summary.structured.章节信息).toMatchObject({
      章节标题: "第1章",
      正文覆盖: "完整章节",
      缓存版本: "三-Lite"
    });
    const structured = summary.structured as Record<string, unknown>;
    expect(summary.structured.详细梗概).toContain("第1个片段缓存摘要");
    expect(summary.structured.详细梗概).toContain(`第${expectedChunks.length}个片段缓存摘要`);
    expect(summary.structured.关键事件.length).toBeGreaterThan(0);
    expect(summary.structured.关键事件.length).toBeLessThanOrEqual(10);
    expect(summary.structured.可核对事实.length).toBeGreaterThan(0);
    expect(summary.structured.可核对事实.length).toBeLessThanOrEqual(12);
    expect(structured).not.toHaveProperty("空间与行动逻辑");
    expect(structured).not.toHaveProperty("限制与否定事实");
    expect(structured).not.toHaveProperty("场景列表");
    expect(structured).toHaveProperty("场景推进");
    expect(JSON.stringify(summary.structured).length).toBeLessThan(16000);
    expect(summary.structured.缓存质量).toMatchObject({
      覆盖完整度: "完整",
      需要回读原文: "否",
      缺失说明: []
    });
    expect(summaryRepo.listChapterSummaryChunks("project_1", "chapter_1", computeChapterContentHash(content))).toHaveLength(expectedChunks.length);
    db.close();
  });

  it("discards long chapter chunk output when the source changes before chunk persistence", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const oldContent = Array.from({ length: 14 }, (_, index) => `第${index + 1}段。${"春".repeat(650)}`).join("\n\n");
    const newContent = `${oldContent}\n\n新正文`;
    createChapter(chapterRepo, "chapter_1", oldContent);
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayloadV2(),
        summarizeChapterChunkForIndex: async (input) => {
          if (input.chunkIndex === 0) {
            chapterRepo.saveContent(
              "chapter_1",
              { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: newContent }] }] },
              newContent,
              newContent.length,
              0,
              "2026-05-01",
              "2026-05-01T00:11:00.000Z"
            );
          }
          return chapterChunkIndexPayload({ chunkIndex: input.chunkIndex, chunkCount: input.chunkCount });
        },
        mergeChapterChunksForIndex: async () => {
          throw new Error("changed source must stop before local chunk aggregation");
        }
      }
    });

    await expect(
      service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(oldContent), "2026-05-01T00:10:00.000Z")
    ).rejects.toThrow("章节内容已变化");

    expect(summaryRepo.listChapterSummaryChunks("project_1", "chapter_1", computeChapterContentHash(oldContent))).toEqual([]);
    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toBeNull();
    expect(summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:12:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: computeChapterContentHash(newContent)
    });
    db.close();
  });

  it("does not create a ready chapter summary when any long chapter chunk fails", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = Array.from({ length: 14 }, (_, index) => `第${index + 1}段。${"春".repeat(650)}`).join("\n\n");
    createChapter(chapterRepo, "chapter_1", content);
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayloadV2(),
        summarizeChapterChunkForIndex: async (input) => {
          if (input.chunkIndex === 1) {
            throw new Error("片段生成失败");
          }
          return chapterChunkIndexPayload({ chunkIndex: input.chunkIndex, chunkCount: input.chunkCount });
        },
        mergeChapterChunksForIndex: async () => {
          throw new Error("should not merge after failed chunk");
        }
      }
    });

    await expect(
      service.summarizeChapter("project_1", "chapter_1", computeChapterContentHash(content), "2026-05-01T00:10:00.000Z")
    ).rejects.toThrow("片段生成失败");

    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toBeNull();
    db.close();
  });

  it("reuses ready chunks with the same hash when retrying a long chapter", async () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = Array.from({ length: 14 }, (_, index) => `第${index + 1}段。${"春".repeat(650)}`).join("\n\n");
    createChapter(chapterRepo, "chapter_1", content);
    const chunks = splitChapterForSummaryIndex(content);
    const sourceHash = computeChapterContentHash(content);
    summaryRepo.upsertChapterSummaryChunk({
      id: "existing_chunk_0",
      projectId: "project_1",
      chapterId: "chapter_1",
      chunkIndex: chunks[0].chunkIndex,
      chunkCount: chunks.length,
      contentHash: sourceHash,
      textStart: chunks[0].textStart,
      textEnd: chunks[0].textEnd,
      summaryShort: "已有片段摘要",
      structured: chapterChunkIndexPayload({ chunkIndex: chunks[0].chunkIndex, chunkCount: chunks.length }),
      tokenCount: 20,
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const generatedChunkIndexes: number[] = [];
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayloadV2(),
        summarizeChapterChunkForIndex: async (input) => {
          generatedChunkIndexes.push(input.chunkIndex);
          return chapterChunkIndexPayload({ chunkIndex: input.chunkIndex, chunkCount: input.chunkCount });
        },
        mergeChapterChunksForIndex: async () => {
          throw new Error("ready chunks should be aggregated locally");
        }
      }
    });

    await service.summarizeChapter("project_1", "chapter_1", sourceHash, "2026-05-01T00:10:00.000Z");

    expect(generatedChunkIndexes).toEqual(chunks.slice(1).map((chunk) => chunk.chunkIndex));
    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toMatchObject({ status: "ready", contentHash: sourceHash });
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
        summarizeChapterForIndex: async () => summaryPayloadV2()
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
      structured: summaryPayloadV2(),
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
        return chapterIndexPayloadV2({
          title: "第1章",
          oneLine: "不应该写入的新摘要",
          synopsis: "不应该写入的新摘要。",
          detail: "不应该写入的新摘要，因为章节内容已经在生成过程中发生变化，服务应丢弃这次结果并重新排队最新内容的摘要任务。"
        });
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
    chapterRepo.rename("chapter_2", "第2章", "2026-05-01T00:09:00.000Z");
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_1", title: "第1章", order: 1, content: "春".repeat(620) });
    upsertReadyChapterSummary(summaryRepo, { chapterId: "chapter_2", title: "第2章", order: 2, content: "夏".repeat(620) });
    const sourceHash = computeSourceHash([computeChapterContentHash("春".repeat(620)), computeChapterContentHash("夏".repeat(620))]);
    const generator = {
      summarizeChapterForIndex: async () => summaryPayloadV2(),
      summarizeArcForIndex: async () => arcIndexPayloadV2()
    };
    const service = new SummaryService(summaryRepo, chapterRepo, { generator });

    const summary = await service.summarizeArc("project_1", "auto:001-002", 1, 2, sourceHash, "2026-05-01T00:10:00.000Z");

    expect(summary).toMatchObject({
      projectId: "project_1",
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash,
      summary: arcIndexPayloadV2().阶段详细梗概,
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
        summarizeChapterForIndex: async () => summaryPayloadV2(),
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
      structured: summaryPayloadV2(),
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
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const service = new SummaryService(summaryRepo, chapterRepo, {
      generator: {
        summarizeChapterForIndex: async () => summaryPayloadV2(),
        summarizeBookForIndex: async () => ({
          ...bookIndexPayloadV2(),
          全书信息: {
            ...bookIndexPayloadV2().全书信息,
            总章节数: 999,
            已索引章节数: 999
          },
          全文短摘要: "全书摘要。",
          全文详细梗概: "全书摘要。林远回到旧城后发现旧信，旧事未解，追查旧信来源成为当前阶段的主线推进方向。这个全书缓存还记录了覆盖范围、过期章节和后续回答时必须说明的索引限制。"
        })
      }
    });

    await expect(service.summarizeBook("project_1", "stale-source", "2026-05-01T00:09:00.000Z")).rejects.toThrow("全书摘要来源已变化");
    const currentJob = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:09:30.000Z");
    expect(currentJob).toMatchObject({ jobType: "book_summary" });
    const sourceHash = currentJob?.sourceHash ?? "";
    const summary = await service.summarizeBook("project_1", sourceHash, "2026-05-01T00:10:00.000Z");

    expect(summary.structured.全书信息).toMatchObject({
      总章节数: 2,
      已索引章节数: 1,
      过期章节: ["第1章"],
      缺失章节: [],
      过短跳过章节: []
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
      structured: summaryPayloadV2(),
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
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_4",
      sourceHash: "hash_4",
      priority: 4,
      now: "2026-05-01T00:15:30.000Z",
      nextRunAt: "2026-05-01T00:21:00.000Z"
    });

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
      cancelledJobCount: 0,
      queuedJobCount: 1,
      runningJobLabel: "正在摘要：第2章",
      nextRetryAt: "2026-05-01T00:21:00.000Z",
      nextRetryJobLabel: "第1章",
      backgroundEnabled: true,
      retryingJobs: [
        {
          label: "第1章",
          error: null,
          attemptCount: 0,
          nextRunAt: "2026-05-01T00:21:00.000Z"
        }
      ],
      recentFailedJobs: [
        {
          label: "全书摘要",
          error: "上游限流",
          failureCategory: "上游限流",
          actionHint: "OpenRouter 或模型供应商暂时限流。系统只会延迟自动重试一次；如果反复失败，请稍后重试或换用更稳定的模型。",
          attemptCount: 1,
          nextRunAt: null
        }
      ],
      pausedReason: "foreground_ai_active",
      updatedAt: "2026-05-01T00:16:00.000Z"
    });
    db.close();
  });

  it("reports disabled background indexing as a paused index state", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    summaryRepo.setBackgroundIndexEnabled("project_1", false, "2026-05-01T00:05:00.000Z");
    const service = new SummaryService(summaryRepo, chapterRepo);

    expect(service.getIndexStatus("project_1", "2026-05-01T00:10:00.000Z")).toMatchObject({
      backgroundEnabled: false,
      pausedReason: "background_disabled"
    });
    db.close();
  });

  it("does not surface stale failed chapter jobs after the same source hash has cached successfully", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(620);
    createChapter(chapterRepo, "chapter_1", content);
    const contentHash = computeChapterContentHash(content);
    const service = new SummaryService(summaryRepo, chapterRepo);
    const job = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: contentHash,
      priority: 5,
      now: "2026-05-01T00:10:00.000Z"
    });
    const running = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:11:00.000Z");
    summaryRepo.failSummaryJob(running?.id ?? job.id, "旧的结构校验错误", null, "2026-05-01T00:12:00.000Z");
    summaryRepo.upsertChapterSummary({
      id: "summary_chapter_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      chapterOrder: 1,
      contentHash,
      summaryShort: "第1章短摘要",
      summaryLong: "第1章长摘要",
      structured: summaryPayloadV2(),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt,
      updatedAt: "2026-05-01T00:13:00.000Z"
    });

    const status = service.getIndexStatus("project_1", "2026-05-01T00:13:00.000Z");
    const [entry] = service.listChapterCacheEntries("project_1", "2026-05-01T00:13:00.000Z");

    expect(status.failedJobCount).toBe(0);
    expect(status.recentFailedJobs).toEqual([]);
    expect(entry).toMatchObject({
      cacheState: "ready",
      jobStatus: null,
      jobError: null
    });
    db.close();
  });

  it("does not show a later failed job once a ready summary already covers the same source hash", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(620);
    createChapter(chapterRepo, "chapter_1", content);
    const contentHash = computeChapterContentHash(content);
    summaryRepo.upsertChapterSummary({
      id: "summary_chapter_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      chapterOrder: 1,
      contentHash,
      summaryShort: "第1章短摘要",
      summaryLong: "第1章长摘要",
      structured: summaryPayloadV2(),
      tokenCount: 30,
      status: "ready",
      error: null,
      createdAt,
      updatedAt: "2026-05-01T00:12:00.000Z"
    });
    const service = new SummaryService(summaryRepo, chapterRepo);
    const job = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: contentHash,
      priority: 5,
      now: "2026-05-01T00:13:00.000Z"
    });
    const running = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:14:00.000Z");
    summaryRepo.failSummaryJob(running?.id ?? job.id, "晚到的结构校验错误", null, "2026-05-01T00:15:00.000Z");

    const status = service.getIndexStatus("project_1", "2026-05-01T00:16:00.000Z");
    const [entry] = service.listChapterCacheEntries("project_1", "2026-05-01T00:16:00.000Z");

    expect(status.failedJobCount).toBe(0);
    expect(status.recentFailedJobs).toEqual([]);
    expect(entry).toMatchObject({
      cacheState: "ready",
      jobStatus: null,
      jobError: null
    });
    db.close();
  });

  it("does not surface covered derived summary failures or retry-scheduled attempts as active failures", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const firstContent = "春".repeat(620);
    const secondContent = "夏".repeat(620);
    createChapter(chapterRepo, "chapter_1", firstContent);
    createChapter(chapterRepo, "chapter_2", secondContent);
    const firstHash = computeChapterContentHash(firstContent);
    const secondHash = computeChapterContentHash(secondContent);
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content: firstContent
    });
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_2",
      title: "第2章",
      order: 2,
      content: secondContent
    });
    const arcSourceHash = computeSourceHash([firstHash, secondHash]);
    summaryRepo.upsertArcSummary({
      id: "arc_ready_1_2",
      projectId: "project_1",
      arcKey: "auto:001-002",
      chapterFrom: 1,
      chapterTo: 2,
      sourceHash: arcSourceHash,
      summary: "阶段摘要已完成",
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt,
      updatedAt: "2026-05-01T00:12:00.000Z"
    });
    const bookSourceHash = computeSourceHash([
      arcSourceHash,
      JSON.stringify({
        indexed: 2,
        total: 2,
        stale: [],
        missing: [],
        skipped: []
      })
    ]);
    summaryRepo.upsertBookSummary({
      id: "book_ready",
      projectId: "project_1",
      sourceHash: bookSourceHash,
      summaryShort: "全书短摘要已完成",
      summaryLong: "全书长摘要已完成",
      structured: bookIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt,
      updatedAt: "2026-05-01T00:13:00.000Z"
    });
    const failedArc = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "arc_summary",
      targetId: "auto:001-002",
      sourceHash: arcSourceHash,
      priority: 6,
      now: "2026-05-01T00:14:00.000Z"
    });
    const runningArc = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:15:00.000Z");
    summaryRepo.failSummaryJob(runningArc?.id ?? failedArc.id, "旧的阶段摘要错误", null, "2026-05-01T00:16:00.000Z");
    const failedBook = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "book_summary",
      targetId: null,
      sourceHash: bookSourceHash,
      priority: 4,
      now: "2026-05-01T00:17:00.000Z"
    });
    const runningBook = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:18:00.000Z");
    summaryRepo.failSummaryJob(runningBook?.id ?? failedBook.id, "旧的全书摘要错误", null, "2026-05-01T00:19:00.000Z");
    const retryingChapter = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: secondHash,
      priority: 5,
      now: "2026-05-01T00:20:00.000Z"
    });
    const runningRetry = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:21:00.000Z");
    summaryRepo.failSummaryJob(runningRetry?.id ?? retryingChapter.id, "上游限流", "2026-05-01T00:36:00.000Z", "2026-05-01T00:22:00.000Z");
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: secondHash,
      priority: 5,
      attemptCount: 1,
      now: "2026-05-01T00:22:00.000Z",
      nextRunAt: "2026-05-01T00:36:00.000Z"
    });
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.getIndexStatus("project_1", "2026-05-01T00:23:00.000Z");

    expect(status.readyChapterCount).toBe(2);
    expect(status.failedJobCount).toBe(0);
    expect(status.recentFailedJobs).toEqual([]);
    expect(status.retryingJobs).toHaveLength(1);
    expect(status.nextRetryJobLabel).toBe("第1章");
    db.close();
  });

  it("classifies chapter cache entry failures so the UI does not need to show raw schema dumps", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(620);
    createChapter(chapterRepo, "chapter_1", content);
    const service = new SummaryService(summaryRepo, chapterRepo);
    const job = summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: computeChapterContentHash(content),
      priority: 5,
      now: "2026-05-01T00:10:00.000Z"
    });
    const running = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:11:00.000Z");
    summaryRepo.failSummaryJob(running?.id ?? job.id, "章节索引摘要无效：模型返回的 JSON 结构不符合章节缓存模板。", null, "2026-05-01T00:12:00.000Z");

    const [entry] = service.listChapterCacheEntries("project_1", "2026-05-01T00:13:00.000Z");

    expect(entry).toMatchObject({
      cacheState: "failed",
      jobFailureCategory: "模型输出结构无效",
      jobActionHint: expect.stringContaining("不是章节正文内容问题")
    });
    db.close();
  });

  it("enables background indexing when the user explicitly rebuilds the project index", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    summaryRepo.setBackgroundIndexEnabled("project_1", false, "2026-05-01T00:05:00.000Z");
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.rebuildProjectIndex("project_1", "2026-05-01T00:10:00.000Z");

    expect(status.backgroundEnabled).toBe(true);
    expect(status.pausedReason).toBeNull();
    expect(summaryRepo.getBackgroundIndexEnabled("project_1")).toBe(true);
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
      failedJobCount: 0,
      cancelledJobCount: 0,
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

  it("continues indexing without requeueing ready chapters that already match the current content", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content: "春".repeat(620)
    });
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.rebuildProjectIndex("project_1", "2026-05-01T00:30:00.000Z");
    const nextJob = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:31:00.000Z");

    expect(status).toMatchObject({
      readyChapterCount: 1,
      queuedJobCount: 1
    });
    expect(nextJob).toMatchObject({
      targetId: "chapter_2"
    });
    db.close();
  });

  it("can force a full project index rebuild when explicitly requested", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content: "春".repeat(620)
    });
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.rebuildProjectIndex("project_1", "2026-05-01T00:30:00.000Z", { force: true });

    expect(status).toMatchObject({
      readyChapterCount: 1,
      queuedJobCount: 2
    });
    db.close();
  });

  it("lists chapter cache entries with current jobs and full summary preview details", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content: "春".repeat(620)
    });
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: computeChapterContentHash("夏".repeat(620)),
      priority: 10,
      now: "2026-05-01T00:40:00.000Z"
    });
    const service = new SummaryService(summaryRepo, chapterRepo);

    const entries = service.listChapterCacheEntries("project_1", "2026-05-01T00:41:00.000Z");
    const detail = service.getChapterCacheDetail("project_1", "chapter_1");

    expect(entries).toEqual([
      expect.objectContaining({
        chapterId: "chapter_1",
        cacheState: "ready",
        summaryShort: "第1章短摘要",
        jobStatus: null
      }),
      expect.objectContaining({
        chapterId: "chapter_2",
        cacheState: "queued",
        summaryShort: null,
        jobStatus: "queued"
      })
    ]);
    expect(detail).toMatchObject({
      chapterId: "chapter_1",
      cacheState: "ready",
      summary: {
        summaryShort: "第1章短摘要",
        structured: summaryPayloadV2()
      },
      chunks: []
    });
    db.close();
  });

  it("clears a chapter cache and retries the chapter without leaving stale arc or book caches", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    const content = "春".repeat(620);
    createChapter(chapterRepo, "chapter_1", content);
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content
    });
    summaryRepo.upsertArcSummary({
      id: "arc_summary_1",
      projectId: "project_1",
      arcKey: "auto:001-001",
      chapterFrom: 1,
      chapterTo: 1,
      sourceHash: computeChapterContentHash(content),
      summary: arcIndexPayloadV2().阶段详细梗概,
      structured: arcIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    summaryRepo.upsertBookSummary({
      id: "book_summary_1",
      projectId: "project_1",
      sourceHash: "book_hash",
      summaryShort: bookIndexPayloadV2().全文短摘要,
      summaryLong: bookIndexPayloadV2().全文详细梗概,
      structured: bookIndexPayloadV2(),
      status: "ready",
      error: null,
      createdAt,
      updatedAt: createdAt
    });
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.clearAndRetryChapterCache("project_1", "chapter_1", "2026-05-01T00:50:00.000Z");
    const nextJob = summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:51:00.000Z");

    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toBeNull();
    expect(summaryRepo.listArcSummaries("project_1")).toEqual([]);
    expect(summaryRepo.getLatestBookSummary("project_1")).toBeNull();
    expect(status).toMatchObject({
      readyChapterCount: 0,
      missingChapterCount: 1,
      queuedJobCount: 1
    });
    expect(nextJob).toMatchObject({
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: computeChapterContentHash(content)
    });
    db.close();
  });

  it("queues a chapter cache retry while another chapter is currently running", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    createChapter(chapterRepo, "chapter_2", "夏".repeat(620));
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content: "春".repeat(620)
    });
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: computeChapterContentHash("夏".repeat(620)),
      priority: 10,
      now: "2026-05-01T00:40:00.000Z"
    });
    summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:41:00.000Z");
    const service = new SummaryService(summaryRepo, chapterRepo);

    const status = service.clearAndRetryChapterCache("project_1", "chapter_1", "2026-05-01T00:50:00.000Z");

    expect(status).toMatchObject({
      runningJobLabel: "正在摘要：第1章",
      queuedJobCount: 1
    });
    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toBeNull();
    expect(summaryRepo.listSummaryJobs("project_1").filter((job) => job.jobType === "chapter_summary")).toEqual([
      expect.objectContaining({
        status: "running",
        targetId: "chapter_2"
      }),
      expect.objectContaining({
        status: "queued",
        targetId: "chapter_1"
      })
    ]);
    db.close();
  });

  it("refuses to clear a chapter cache while that same chapter is already running", () => {
    const db = createDb();
    const { chapterRepo, summaryRepo } = seedProject(db);
    createChapter(chapterRepo, "chapter_1", "春".repeat(620));
    upsertReadyChapterSummary(summaryRepo, {
      chapterId: "chapter_1",
      title: "第1章",
      order: 1,
      content: "春".repeat(620)
    });
    summaryRepo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: computeChapterContentHash("春".repeat(620)),
      priority: 10,
      now: "2026-05-01T00:40:00.000Z"
    });
    summaryRepo.claimNextSummaryJob("project_1", "2026-05-01T00:41:00.000Z");
    const service = new SummaryService(summaryRepo, chapterRepo);

    expect(() => service.clearAndRetryChapterCache("project_1", "chapter_1", "2026-05-01T00:50:00.000Z")).toThrow("本章缓存正在运行");
    expect(summaryRepo.getChapterSummary("project_1", "chapter_1")).toMatchObject({ status: "ready" });
    db.close();
  });
});
