import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { RelationshipIndexRepository } from "../../src/main/db/repositories/relationship-index-repo";
import {
  RELATIONSHIP_INDEX_EXTRACTOR_VERSION,
  RELATIONSHIP_INDEX_MIN_AUTO_UNITS,
  RELATIONSHIP_INDEX_MIN_MANUAL_UNITS,
  RELATIONSHIP_INDEX_STABLE_IDLE_MS,
  RelationshipIndexService
} from "../../src/main/relationships/relationship-index-service";
import type { ChapterContent } from "../../src/main/shared/types";

const tempDirs: string[] = [];
const baseNow = "2026-05-13T01:00:00.000Z";

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-service-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createTestDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  new ProjectRepository(db).create({
    id: "project_1",
    name: "关系索引服务测试",
    rootPath: null,
    createdAt: baseNow,
    updatedAt: baseNow
  });
  return db;
}

function textWithUnits(units: number): string {
  return "雨".repeat(units);
}

function createChapter(repo: ChapterRepository, input: { readonly id: string; readonly title: string; readonly text: string; readonly sortOrder?: number }): void {
  repo.create({
    id: input.id,
    projectId: "project_1",
    title: input.title,
    volumeTitle: "第一卷",
    sortOrder: input.sortOrder ?? 0,
    contentJson: { type: "doc", content: [] },
    plainText: input.text,
    wordCount: input.text.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: baseNow,
    updatedAt: baseNow,
    contentUpdatedAt: baseNow
  } satisfies ChapterContent);
}

function createService(db: SqliteDatabase): { readonly chapterRepo: ChapterRepository; readonly repo: RelationshipIndexRepository; readonly service: RelationshipIndexService } {
  const chapterRepo = new ChapterRepository(db);
  const repo = new RelationshipIndexRepository(db);
  return {
    chapterRepo,
    repo,
    service: new RelationshipIndexService(repo, chapterRepo)
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RelationshipIndexService", () => {
  it("marks changed chapter content as stale for summary-derived relationship cache", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS) });

    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1),
      nextPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS),
      previousWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1,
      nextWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS,
      updatedAt: baseNow
    });

    const state = repo.getChapterIndexState("project_1", "chapter_1");
    expect(state).toMatchObject({
      status: "stale",
      extractorVersion: RELATIONSHIP_INDEX_EXTRACTOR_VERSION,
      eligibleAt: null
    });

    db.close();
  });

  it("updates stale source hash and cancels queued old-hash jobs when content changes again", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 10) });

    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS),
      nextPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 10),
      previousWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS,
      nextWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 10,
      updatedAt: baseNow
    });
    const firstState = repo.getChapterIndexState("project_1", "chapter_1");
    const oldJob = repo.enqueueChapterJob({
      projectId: "project_1",
      chapterId: "chapter_1",
      sourceHash: firstState!.contentHash,
      priority: 1,
      eligibleAt: firstState!.eligibleAt,
      now: baseNow
    });

    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 10),
      nextPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 20),
      previousWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 10,
      nextWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS + 20,
      updatedAt: "2026-05-13T01:30:00.000Z"
    });

    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({
      status: "stale",
      eligibleAt: null
    });
    expect(repo.listRelationshipJobs("project_1").find((job) => job.id === oldJob.id)).toMatchObject({
      status: "cancelled",
      error: "章节内容已更新，旧关系索引任务已取消。"
    });

    db.close();
  });

  it("does not auto queue chapters under 200 writing units", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1) });
    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: "",
      nextPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1),
      previousWordCount: 0,
      nextWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1,
      updatedAt: baseNow
    });

    const queued = service.enqueueEligibleStableChapters("project_1", "2026-05-13T02:00:01.000Z");

    expect(queued).toEqual([]);
    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({ status: "skipped_too_short" });

    db.close();
  });

  it("manual rebuild queues a recently edited chapter when it has at least 80 writing units", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_MANUAL_UNITS) });

    service.rebuildProjectRelationshipIndex("project_1", baseNow, { force: false });

    const job = repo.peekNextRelationshipJob("project_1", baseNow);
    expect(job).toMatchObject({
      chapterId: "chapter_1",
      status: "queued",
      eligibleAt: baseNow
    });
    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({ status: "queued" });

    db.close();
  });

  it("manual rebuild marks chapters under 80 writing units as skipped too short", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_MANUAL_UNITS - 1) });

    service.rebuildProjectRelationshipIndex("project_1", baseNow, { force: true });

    expect(repo.peekNextRelationshipJob("project_1", baseNow)).toBeNull();
    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({ status: "skipped_too_short" });

    db.close();
  });

  it("import queues eligible chapters immediately", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS) });

    service.enqueueImportedChapters("project_1", ["chapter_1"], baseNow);

    expect(repo.peekNextRelationshipJob("project_1", baseNow)).toMatchObject({
      chapterId: "chapter_1",
      status: "queued",
      eligibleAt: baseNow
    });
    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({
      status: "queued",
      eligibleAt: baseNow
    });

    db.close();
  });

  it("tracks non-adjacent edited chapters with independent stale cache states", () => {
    const db = createTestDb();
    const { chapterRepo, repo, service } = createService(db);
    createChapter(chapterRepo, { id: "chapter_1", title: "第1章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS), sortOrder: 0 });
    createChapter(chapterRepo, { id: "chapter_3", title: "第3章", text: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS), sortOrder: 2 });

    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_1",
      previousPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1),
      nextPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS),
      previousWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 1,
      nextWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS,
      updatedAt: "2026-05-13T01:00:00.000Z"
    });
    service.markChapterContentChanged({
      projectId: "project_1",
      chapterId: "chapter_3",
      previousPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 2),
      nextPlainText: textWithUnits(RELATIONSHIP_INDEX_MIN_AUTO_UNITS),
      previousWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS - 2,
      nextWordCount: RELATIONSHIP_INDEX_MIN_AUTO_UNITS,
      updatedAt: "2026-05-13T01:30:00.000Z"
    });

    expect(repo.getChapterIndexState("project_1", "chapter_1")).toMatchObject({
      chapterOrder: 1,
      status: "stale",
      eligibleAt: null
    });
    expect(repo.getChapterIndexState("project_1", "chapter_3")).toMatchObject({
      chapterOrder: 3,
      status: "stale",
      eligibleAt: null
    });

    const firstBatch = service.enqueueEligibleStableChapters("project_1", "2026-05-13T02:05:00.000Z");
    expect(firstBatch.map((job) => job.chapterId)).toEqual(["chapter_1", "chapter_3"]);
    expect(repo.getChapterIndexState("project_1", "chapter_3")).toMatchObject({ status: "queued" });

    const secondBatch = service.enqueueEligibleStableChapters("project_1", "2026-05-13T02:35:00.000Z");
    expect(secondBatch).toEqual([]);

    db.close();
  });
});
