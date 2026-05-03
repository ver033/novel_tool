import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHAPTER_INDEX_CHUNK_TARGET_UNITS,
  splitChapterForSummaryIndex
} from "../../src/main/ai/summary-service";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { chapterAiSummaryChunkPayloadSchema, computeChapterContentHash } from "../../src/main/shared/summary-index";
import { countWritingUnits } from "../../src/main/shared/text";
import { chapterChunkIndexPayload } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];
const now = "2026-05-02T00:00:00.000Z";

function createDb(): SqliteDatabase {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-summary-chunking-"));
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

describe("chapter summary chunk schema and persistence", () => {
  it("creates the chapter summary chunk table and index", () => {
    const db = createDb();

    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 11 });
    expect(db.prepare("PRAGMA table_info(chapter_ai_summary_chunks)").all().map((row) => row.name)).toEqual(
      expect.arrayContaining(["content_hash", "chunk_index", "chunk_count", "text_start", "text_end", "structured_json", "status"])
    );
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_chapter_ai_summary_chunks_chapter'")
        .get()
    ).toEqual({ name: "idx_chapter_ai_summary_chunks_chapter" });

    db.close();
  });

  it("allows mixed source terms in values and strips extra model fields", () => {
    expect(
      chapterAiSummaryChunkPayloadSchema.parse({
        ...chapterChunkIndexPayload(),
        片段摘要: "本片段记录 U盘 和 AI 标记带来的新线索。",
        englishKey: "不合法但可忽略"
      })
    ).toMatchObject({ 片段摘要: "本片段记录 U盘 和 AI 标记带来的新线索。" });

    expect(
      chapterAiSummaryChunkPayloadSchema.parse({
        ...chapterChunkIndexPayload(),
        关键事件: [
          {
            ...chapterChunkIndexPayload().关键事件[0],
            证据短句: ["Open the door"]
          }
        ]
      })
    ).toMatchObject({ 片段摘要: "本片段记录萧炎测试失利后的处境变化。" });
  });

  it("upserts and lists chunk summaries sorted by chunk index", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);
    const hash = computeChapterContentHash("正文".repeat(2000));

    repo.upsertChapterSummaryChunk({
      id: "chunk_2",
      projectId: "project_1",
      chapterId: "chapter_1",
      chunkIndex: 1,
      chunkCount: 2,
      contentHash: hash,
      textStart: 100,
      textEnd: 200,
      summaryShort: "第二片段",
      structured: chapterChunkIndexPayload({ chunkIndex: 1, chunkCount: 2, summary: "第二片段摘要。" }),
      tokenCount: 20,
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });
    repo.upsertChapterSummaryChunk({
      id: "chunk_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      chunkIndex: 0,
      chunkCount: 2,
      contentHash: hash,
      textStart: 0,
      textEnd: 120,
      summaryShort: "第一片段",
      structured: chapterChunkIndexPayload({ chunkIndex: 0, chunkCount: 2, summary: "第一片段摘要。" }),
      tokenCount: 20,
      status: "ready",
      error: null,
      createdAt: now,
      updatedAt: now
    });

    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", hash).map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);

    db.close();
  });

  it("marks old chunks stale without mixing content hashes", () => {
    const db = createDb();
    seedProjectAndChapter(db);
    const repo = new SummaryRepository(db);
    const oldHash = computeChapterContentHash("旧正文".repeat(1000));
    const newHash = computeChapterContentHash("新正文".repeat(1000));

    for (const [hash, label] of [
      [oldHash, "旧片段"],
      [newHash, "新片段"]
    ] as const) {
      repo.upsertChapterSummaryChunk({
        id: `${label}_1`,
        projectId: "project_1",
        chapterId: "chapter_1",
        chunkIndex: 0,
        chunkCount: 1,
        contentHash: hash,
        textStart: 0,
        textEnd: 100,
        summaryShort: label,
        structured: chapterChunkIndexPayload({ summary: `${label}摘要。` }),
        tokenCount: 10,
        status: "ready",
        error: null,
        createdAt: now,
        updatedAt: now
      });
    }

    repo.markChapterSummaryChunksStale("project_1", "chapter_1", "2026-05-02T00:01:00.000Z");

    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", oldHash)).toHaveLength(1);
    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", newHash)).toHaveLength(1);
    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", oldHash)[0]).toMatchObject({ status: "stale" });
    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", newHash)[0]).toMatchObject({ status: "stale" });

    repo.deleteChapterSummaryChunks("project_1", "chapter_1", oldHash);
    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", oldHash)).toEqual([]);
    expect(repo.listChapterSummaryChunks("project_1", "chapter_1", newHash)).toHaveLength(1);

    db.close();
  });
});

describe("splitChapterForSummaryIndex", () => {
  it("keeps a 2350-unit chapter as one direct chunk", () => {
    const text = "春".repeat(2350);

    expect(splitChapterForSummaryIndex(text)).toEqual([
      {
        chunkIndex: 0,
        chunkCount: 1,
        text,
        textStart: 0,
        textEnd: text.length
      }
    ]);
  });

  it("splits an 18000-unit chapter into ordered non-empty chunks", () => {
    const paragraphs = Array.from({ length: 36 }, (_, index) => `第${index + 1}段。${"春".repeat(500)}`);
    const text = paragraphs.join("\n\n");
    const chunks = splitChapterForSummaryIndex(text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.chunkCount === chunks.length)).toBe(true);
    expect(chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
    expect(chunks.at(0)?.textStart).toBe(0);
    expect(chunks.at(-1)?.textEnd).toBe(text.length);
  });

  it("does not exceed the target by more than one paragraph", () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => `第${index + 1}段。${"山".repeat(900)}`);
    const text = paragraphs.join("\n\n");
    const chunks = splitChapterForSummaryIndex(text);
    const paragraphUnits = countWritingUnits(paragraphs[0]);

    for (const chunk of chunks) {
      expect(countWritingUnits(chunk.text)).toBeLessThanOrEqual(CHAPTER_INDEX_CHUNK_TARGET_UNITS + paragraphUnits);
    }
  });

  it("adds overlap only after the first chunk and keeps source offsets monotonic by chunk body", () => {
    const paragraphs = Array.from({ length: 16 }, (_, index) => `第${index + 1}段。${"雨".repeat(600)}`);
    const text = paragraphs.join("\n\n");
    const chunks = splitChapterForSummaryIndex(text);

    expect(chunks[0].textStart).toBe(0);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].textStart).toBeLessThan(chunks[index - 1].textEnd);
      expect(chunks[index].textEnd).toBeGreaterThan(chunks[index - 1].textEnd);
    }
  });
});
