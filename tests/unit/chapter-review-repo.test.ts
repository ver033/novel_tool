import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterReviewRepository } from "../../src/main/db/repositories/chapter-review-repo";

const tempDirs: string[] = [];
let db: SqliteDatabase;
let repo: ChapterReviewRepository;

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-chapter-review-repo-"));
  tempDirs.push(dir);
  return join(dir, "review.sqlite3");
}

beforeEach(() => {
  db = createDatabase(createTempDbPath());
  runMigrations(db);
  repo = new ChapterReviewRepository(db);
  db.prepare("INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "project_1",
    "斗破测试",
    null,
    "2026-05-28T00:00:00.000Z",
    "2026-05-28T00:00:00.000Z"
  );
  db.prepare(
    `INSERT INTO chapters (
      id, project_id, title, volume_title, sort_order, content_json, plain_text,
      word_count, daily_word_count, daily_word_count_date, target_word_count, status, created_at, updated_at, content_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "chapter_1",
    "project_1",
    "第一章",
    "第一卷",
    1,
    JSON.stringify({ type: "doc", content: [] }),
    "萧炎站在门前。",
    7,
    0,
    null,
    null,
    "draft",
    "2026-05-28T00:00:00.000Z",
    "2026-05-28T00:00:00.000Z",
    "2026-05-28T00:00:00.000Z"
  );
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ChapterReviewRepository", () => {
  it("stores a run and chapter review details locally", () => {
    const run = repo.createRun({
      id: "review_run_1",
      projectId: "project_1",
      chapterIds: ["chapter_1"],
      status: "running",
      requestedAt: "2026-05-28T01:00:00.000Z"
    });

    repo.saveChapterResult({
      id: "review_chapter_1",
      runId: run.id,
      projectId: "project_1",
      chapterId: "chapter_1",
      chapterTitle: "第一章",
      chapterSortOrder: 1,
      summary: "本章没有明显硬伤。",
      readabilityScore: 4,
      aiToneRisk: "low",
      issues: [],
      chunkCount: 1,
      reviewedAt: "2026-05-28T01:01:00.000Z"
    });
    repo.completeRun(run.id, "project_1", "2026-05-28T01:01:00.000Z");

    expect(repo.getRun("project_1", run.id)).toMatchObject({
      id: "review_run_1",
      status: "completed",
      issueCount: 0,
      chapters: [
        expect.objectContaining({
          chapterId: "chapter_1",
          summary: "本章没有明显硬伤。",
          aiToneRisk: "low"
        })
      ]
    });
    expect(repo.listRuns("project_1", 10)[0]).toMatchObject({ id: "review_run_1", status: "completed", issueCount: 0 });
  });

  it("marks failed runs without losing selected chapter scope", () => {
    const run = repo.createRun({
      id: "review_run_1",
      projectId: "project_1",
      chapterIds: ["chapter_1"],
      status: "running",
      requestedAt: "2026-05-28T01:00:00.000Z"
    });

    repo.failRun(run.id, "project_1", "OpenRouter 请求失败", "2026-05-28T01:01:00.000Z");

    expect(repo.getRun("project_1", run.id)).toMatchObject({
      chapterIds: ["chapter_1"],
      status: "failed",
      error: "OpenRouter 请求失败"
    });
  });
});
