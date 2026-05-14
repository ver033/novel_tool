import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import {
  arcAiSummaryPayloadSchema,
  bookAiSummaryPayloadSchema,
  computeChapterContentHash,
  getBookSummaryCoverage
} from "../../src/main/shared/summary-index";
import { arcIndexPayloadV2, bookIndexPayloadV2, chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];
const now = "2026-05-02T00:00:00.000Z";

function createDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-arc-book-v2-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  return db;
}

function seedProjectAndChapter(db: SqliteDatabase): void {
  db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_1", "归途", now, now);
  db.prepare(
    `INSERT INTO chapters
     (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("chapter_1", "project_1", "第1章", 0, JSON.stringify({ type: "doc", content: [] }), "正文", 2, 0, now, now);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("arc and book summary V2 schemas", () => {
  it("accepts Chinese durable arc and book indexes", () => {
    expect(arcAiSummaryPayloadSchema.parse(arcIndexPayloadV2())).toEqual(arcIndexPayloadV2());
    expect(bookAiSummaryPayloadSchema.parse(bookIndexPayloadV2())).toEqual(bookIndexPayloadV2());
    expect(getBookSummaryCoverage(bookIndexPayloadV2())).toEqual({
      totalChapterCount: 2,
      indexedChapterCount: 2,
      staleChapterIds: [],
      missingChapterIds: [],
      skippedTooShortChapterIds: []
    });
  });

  it("rejects old English arc and book payloads", () => {
    expect(() =>
      arcAiSummaryPayloadSchema.parse({
        chapterFrom: 1,
        chapterTo: 2,
        synopsis: "旧阶段摘要",
        keyEvents: ["旧事件"],
        characterChanges: [],
        relationshipChanges: [],
        foreshadowingHints: [],
        unresolvedQuestions: []
      })
    ).toThrow();

    expect(() =>
      bookAiSummaryPayloadSchema.parse({
        coverage: {
          totalChapterCount: 2,
          indexedChapterCount: 2,
          staleChapterIds: [],
          missingChapterIds: [],
          skippedTooShortChapterIds: []
        },
        synopsis: "旧全书摘要",
        mainPlot: ["旧主线"],
        majorCharacters: [{ name: "林远", summary: "主角" }],
        majorConflicts: [],
        relationshipChanges: [],
        foreshadowingHints: [],
        unresolvedQuestions: []
      })
    ).toThrow();
  });
});

describe("arc and book V2 cache reset migration", () => {
  it("clears old arc/book cache rows and jobs but keeps ready chapter summaries", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    db.prepare(
      `INSERT INTO chapter_ai_summaries
       (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, summary_short, summary_long, structured_json, token_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "summary_1",
      "project_1",
      "chapter_1",
      "第1章",
      1,
      computeChapterContentHash("正文"),
      "章节短摘要",
      "章节长摘要",
      JSON.stringify(chapterIndexPayloadV2()),
      1,
      "ready",
      now,
      now
    );
    db.prepare(
      `INSERT INTO arc_ai_summaries
       (id, project_id, arc_key, chapter_from, chapter_to, source_hash, summary, structured_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("arc_1", "project_1", "auto:001-001", 1, 1, "old_source", "旧阶段", JSON.stringify({ synopsis: "旧阶段" }), "ready", now, now);
    db.prepare(
      `INSERT INTO book_ai_summaries
       (id, project_id, source_hash, summary_short, summary_long, structured_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("book_1", "project_1", "old_source", "旧全书", "旧全书", JSON.stringify({ synopsis: "旧全书" }), "ready", now, now);
    db.prepare(
      `INSERT INTO summary_jobs
       (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("job_chapter", "project_1", "chapter_summary", "chapter_1", "hash", "queued", 1, 0, now, now);
    db.prepare(
      `INSERT INTO summary_jobs
       (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("job_arc", "project_1", "arc_summary", "auto:001-001", "hash", "queued", 1, 0, now, now);
    db.prepare(
      `INSERT INTO summary_jobs
       (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("job_book", "project_1", "book_summary", null, "hash", "queued", 1, 0, now, now);

    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(10);
    runMigrations(db);

    expect(db.prepare("SELECT COUNT(*) AS count FROM chapter_ai_summaries").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM arc_ai_summaries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM book_ai_summaries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT id FROM summary_jobs ORDER BY id").all()).toEqual([{ id: "job_chapter" }]);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 13 });

    db.close();
  });
});
