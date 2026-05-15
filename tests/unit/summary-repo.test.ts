import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import {
  computeChapterContentHash,
  computeSourceHash,
  getChapterSummaryLongText,
  getChapterSummaryShortText,
  summaryJobTypeSchema,
  type ChapterAiSummaryPayload
} from "../../src/main/shared/summary-index";
import { arcIndexPayloadV2, bookIndexPayloadV2, chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];

const createdAt = "2026-05-01T00:00:00.000Z";
const updatedAt = "2026-05-01T00:01:00.000Z";

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-summary-repo-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createDb(): SqliteDatabase {
  const db = createDatabase(createTempDbPath());
  runMigrations(db);
  return db;
}

function seedProjectAndChapter(db: SqliteDatabase): void {
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_1", "归途", createdAt, createdAt);
  db.prepare(
    `INSERT INTO chapters
     (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("chapter_1", "project_1", "第1章", 0, JSON.stringify({ type: "doc", content: [] }), "正文", 2, 0, createdAt, createdAt);
}

function validChapterPayload(): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    oneLine: "少年在测试中失利。",
    synopsis: "萧炎在测试中遭遇低谷，众人态度发生变化。",
    detail: "萧炎在测试中遭遇低谷，众人态度发生变化，家族评价和主角心理状态都发生明显转折。这个章节索引用于验证仓储层可以保存并解析中文事实缓存结构。"
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("summary index migrations and repository", () => {
  it("creates summary index tables from a clean sqlite database", () => {
    const db = createDb();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining(["chapter_ai_summaries", "chapter_ai_summary_chunks", "arc_ai_summaries", "book_ai_summaries", "summary_jobs"])
    );
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 17 });
    expect(db.prepare("PRAGMA table_info(chapter_ai_summaries)").all().map((row) => row.name)).toEqual(
      expect.arrayContaining(["content_hash", "summary_short", "summary_long", "structured_json", "status", "error"])
    );

    db.close();
  });

  it("upserts, reads, lists, and marks chapter summaries stale", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);
    const payload = validChapterPayload();
    const oldHash = computeChapterContentHash("旧正文");
    const newHash = computeChapterContentHash("新正文");

    repo.upsertChapterSummary({
      id: "summary_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第1章",
      chapterOrder: 1,
      contentHash: oldHash,
      summaryShort: getChapterSummaryShortText(payload),
      summaryLong: getChapterSummaryLongText(payload),
      structured: payload,
      tokenCount: 128,
      status: "ready",
      error: null,
      createdAt,
      updatedAt
    });

    expect(repo.getChapterSummary("project_1", "chapter_1")).toMatchObject({
      id: "summary_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      contentHash: oldHash,
      status: "ready",
      structured: payload
    });
    expect(repo.listChapterSummaries("project_1")).toHaveLength(1);

    repo.markChapterStale("project_1", "chapter_1", newHash, "2026-05-01T00:02:00.000Z");

    expect(repo.getChapterSummary("project_1", "chapter_1")).toMatchObject({
      contentHash: newHash,
      status: "stale",
      error: null,
      updatedAt: "2026-05-01T00:02:00.000Z"
    });

    db.close();
  });

  it("upserts arc and book summaries with parsed structured payloads", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);
    const arcStructured = arcIndexPayloadV2();
    const bookStructured = bookIndexPayloadV2();

    repo.upsertArcSummary({
      id: "arc_summary_1",
      projectId: "project_1",
      arcKey: "auto:001-020",
      chapterFrom: 1,
      chapterTo: 20,
      sourceHash: computeSourceHash(["chapter_1:hash"]),
      summary: arcStructured.阶段详细梗概,
      structured: arcStructured,
      status: "ready",
      error: null,
      createdAt,
      updatedAt
    });
    repo.upsertBookSummary({
      id: "book_summary_1",
      projectId: "project_1",
      sourceHash: computeSourceHash(["arc_1:hash"]),
      summaryShort: bookStructured.全文短摘要,
      summaryLong: bookStructured.全文详细梗概,
      structured: bookStructured,
      status: "ready",
      error: null,
      createdAt,
      updatedAt
    });

    expect(repo.listArcSummaries("project_1")[0]).toMatchObject({ arcKey: "auto:001-020", structured: arcStructured });
    expect(repo.getLatestBookSummary("project_1")).toMatchObject({ id: "book_summary_1", structured: bookStructured });

    db.close();
  });

  it("coalesces queued summary jobs by project, type, and target", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);

    const first = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_1",
      priority: 1,
      now: createdAt
    });
    const second = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_2",
      priority: 5,
      now: updatedAt
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ sourceHash: "hash_2", priority: 5, status: "queued", updatedAt });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 1 });

    db.close();
  });

  it("queues a newer source for the same target while an older source is running", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);

    const older = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_old",
      priority: 1,
      now: createdAt
    });
    repo.claimNextSummaryJob("project_1", "2026-05-01T00:01:00.000Z");

    const newer = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_new",
      priority: 11,
      now: "2026-05-01T00:02:00.000Z"
    });

    expect(newer.id).not.toBe(older.id);
    expect(newer).toMatchObject({ status: "queued", sourceHash: "hash_new", priority: 11 });
    expect(
      db.prepare("SELECT status, source_hash FROM summary_jobs WHERE target_id = ? ORDER BY status, source_hash").all("chapter_1")
    ).toEqual([
      { status: "queued", source_hash: "hash_new" },
      { status: "running", source_hash: "hash_old" }
    ]);
    db.close();
  });

  it("claims, completes, fails, requeues, and resets summary jobs", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);
    const low = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_low",
      priority: 1,
      now: createdAt
    });
    const high = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "book_summary",
      targetId: null,
      sourceHash: "hash_high",
      priority: 10,
      now: createdAt
    });

    const claimed = repo.claimNextSummaryJob("project_1", updatedAt);
    expect(claimed).toMatchObject({ id: high.id, status: "running", startedAt: updatedAt });

    repo.completeSummaryJob(high.id, "2026-05-01T00:03:00.000Z");
    expect(db.prepare("SELECT status FROM summary_jobs WHERE id = ?").get(high.id)).toEqual({ status: "completed" });

    const claimedLow = repo.claimNextSummaryJob("project_1", "2026-05-01T00:04:00.000Z");
    expect(claimedLow).toMatchObject({ id: low.id, status: "running" });
    repo.failSummaryJob(low.id, "OpenRouter 429", "2026-05-01T00:10:00.000Z", "2026-05-01T00:05:00.000Z");
    expect(db.prepare("SELECT status, error, next_run_at FROM summary_jobs WHERE id = ?").get(low.id)).toEqual({
      status: "failed",
      error: "OpenRouter 429",
      next_run_at: "2026-05-01T00:10:00.000Z"
    });

    const requeued = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_retry",
      priority: 2,
      now: "2026-05-01T00:11:00.000Z"
    });
    expect(requeued.id).not.toBe(low.id);
    expect(db.prepare("SELECT status, error, next_run_at FROM summary_jobs WHERE id = ?").get(low.id)).toEqual({
      status: "failed",
      error: "OpenRouter 429",
      next_run_at: "2026-05-01T00:10:00.000Z"
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs WHERE target_id = ?").get("chapter_1")).toEqual({ count: 2 });

    repo.claimNextSummaryJob("project_1", "2026-05-01T00:12:00.000Z");
    repo.resetRunningJobs("project_1", "2026-05-01T00:13:00.000Z");
    expect(db.prepare("SELECT status FROM summary_jobs WHERE id = ?").get(requeued.id)).toEqual({ status: "queued" });

    db.close();
  });

  it("claims queued chapter summary jobs from the newest chapter backward when priorities match", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("chapter_2", "project_1", "第2章", 1, JSON.stringify({ type: "doc", content: [] }), "第二章正文", 5, 0, createdAt, createdAt);
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("chapter_3", "project_1", "第3章", 2, JSON.stringify({ type: "doc", content: [] }), "第三章正文", 5, 0, createdAt, createdAt);
    const repo = new SummaryRepository(db);

    repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_1",
      priority: 8,
      now: createdAt
    });
    repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: "hash_2",
      priority: 8,
      now: createdAt
    });
    repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_3",
      sourceHash: "hash_3",
      priority: 8,
      now: createdAt
    });

    expect(repo.claimNextSummaryJob("project_1", updatedAt)).toMatchObject({ targetId: "chapter_3" });
    expect(repo.claimNextSummaryJob("project_1", "2026-05-01T00:02:00.000Z")).toMatchObject({ targetId: "chapter_2" });
    expect(repo.claimNextSummaryJob("project_1", "2026-05-01T00:03:00.000Z")).toMatchObject({ targetId: "chapter_1" });

    db.close();
  });

  it("can claim queued chapter summary jobs from front to back when configured", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("chapter_2", "project_1", "第2章", 1, JSON.stringify({ type: "doc", content: [] }), "第二章正文", 5, 0, createdAt, createdAt);
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("chapter_3", "project_1", "第3章", 2, JSON.stringify({ type: "doc", content: [] }), "第三章正文", 5, 0, createdAt, createdAt);
    const repo = new SummaryRepository(db);

    for (const chapterId of ["chapter_1", "chapter_2", "chapter_3"]) {
      repo.enqueueSummaryJob({
        projectId: "project_1",
        jobType: "chapter_summary",
        targetId: chapterId,
        sourceHash: `hash_${chapterId}`,
        priority: 8,
        now: createdAt
      });
    }

    expect(repo.claimNextSummaryJob("project_1", updatedAt, { chapterCacheBuildOrder: "front_to_back" })).toMatchObject({
      targetId: "chapter_1"
    });
    expect(
      repo.claimNextSummaryJob("project_1", "2026-05-01T00:02:00.000Z", { chapterCacheBuildOrder: "front_to_back" })
    ).toMatchObject({ targetId: "chapter_2" });
    expect(
      repo.claimNextSummaryJob("project_1", "2026-05-01T00:03:00.000Z", { chapterCacheBuildOrder: "front_to_back" })
    ).toMatchObject({ targetId: "chapter_3" });

    db.close();
  });

  it("keeps summary job priority above chapter cache build order", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("chapter_2", "project_1", "第2章", 1, JSON.stringify({ type: "doc", content: [] }), "第二章正文", 5, 0, createdAt, createdAt);
    const repo = new SummaryRepository(db);

    repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_1",
      priority: 20,
      now: createdAt
    });
    repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_2",
      sourceHash: "hash_2",
      priority: 8,
      now: createdAt
    });

    expect(repo.claimNextSummaryJob("project_1", updatedAt)).toMatchObject({ targetId: "chapter_1" });

    db.close();
  });

  it("drops stale cancelled jobs when the same target is requeued", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);
    const cancelled = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_cancelled",
      priority: 1,
      now: createdAt
    });
    repo.cancelQueuedAndRunningJobs("project_1", "用户停止后台索引任务。", updatedAt);

    const requeued = repo.enqueueSummaryJob({
      projectId: "project_1",
      jobType: "chapter_summary",
      targetId: "chapter_1",
      sourceHash: "hash_retry",
      priority: 2,
      now: "2026-05-01T00:11:00.000Z"
    });

    expect(requeued.id).not.toBe(cancelled.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs WHERE status = 'cancelled'").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs WHERE status = 'queued'").get()).toEqual({ count: 1 });
    db.close();
  });

  it("persists whether automatic background indexing is enabled for the project", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);

    expect(repo.getBackgroundIndexEnabled("project_1")).toBe(true);

    repo.setBackgroundIndexEnabled("project_1", false, "2026-05-01T00:02:00.000Z");
    expect(repo.getBackgroundIndexEnabled("project_1")).toBe(false);

    repo.setBackgroundIndexEnabled("project_1", true, "2026-05-01T00:03:00.000Z");
    expect(repo.getBackgroundIndexEnabled("project_1")).toBe(true);
    db.close();
  });
});
