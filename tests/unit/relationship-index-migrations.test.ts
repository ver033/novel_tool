import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-db-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("relationship index database migration", () => {
  it("creates relationship index tables without removing existing summary tables", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "chapters",
        "chapter_ai_summaries",
        "summary_jobs",
        "relationship_index_chapters",
        "relationship_index_jobs",
        "relationship_entities",
        "relationship_mentions"
      ])
    );
    expect(db.prepare("SELECT version, name FROM schema_migrations WHERE version = ?").get(13)).toEqual({
      version: 13,
      name: "relationship_index_v2"
    });

    db.close();
  });

  it("adds the relationship fields needed for dynamic dimensions and dual-layer edges", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);

    const mentionColumns = db
      .prepare("PRAGMA table_info(relationship_mentions)")
      .all()
      .map((row) => row.name);
    expect(mentionColumns).toEqual(
      expect.arrayContaining([
        "base_relation_label",
        "plot_relation_label",
        "primary_dimension_name",
        "relationship_dimensions_json",
        "semantic_markers_json",
        "evidence_quote"
      ])
    );

    const entityColumns = db
      .prepare("PRAGMA table_info(relationship_entities)")
      .all()
      .map((row) => row.name);
    expect(entityColumns).toEqual(expect.arrayContaining(["entity_kind", "importance", "source_chapter_ids_json"]));

    db.close();
  });

  it("does not delete chapters, chapter summaries, or summary jobs when v13 is applied", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "project_relationship_migration",
      "迁移测试",
      "2026-05-13T00:00:00.000Z",
      "2026-05-13T00:00:00.000Z"
    );
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "chapter_relationship_migration",
      "project_relationship_migration",
      "第1章",
      1,
      JSON.stringify({ type: "doc", content: [] }),
      "正文",
      2,
      0,
      "2026-05-13T00:00:00.000Z",
      "2026-05-13T00:01:00.000Z",
      "2026-05-13T00:01:00.000Z"
    );
    db.prepare(
      `INSERT INTO chapter_ai_summaries
       (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, summary_short, summary_long, structured_json,
        token_count, status, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "summary_relationship_migration",
      "project_relationship_migration",
      "chapter_relationship_migration",
      "第1章",
      1,
      "hash_1",
      "短摘要",
      "长摘要",
      JSON.stringify({}),
      10,
      "ready",
      null,
      "2026-05-13T00:00:00.000Z",
      "2026-05-13T00:00:00.000Z"
    );
    db.prepare(
      `INSERT INTO summary_jobs
       (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count, next_run_at,
        error, created_at, updated_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "summary_job_relationship_migration",
      "project_relationship_migration",
      "chapter_summary",
      "chapter_relationship_migration",
      "hash_1",
      "queued",
      0,
      0,
      null,
      null,
      "2026-05-13T00:00:00.000Z",
      "2026-05-13T00:00:00.000Z",
      null,
      null
    );

    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(13);
    runMigrations(db);

    expect(db.prepare("SELECT COUNT(*) AS count FROM chapters").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM chapter_ai_summaries").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 1 });

    db.close();
  });
});
