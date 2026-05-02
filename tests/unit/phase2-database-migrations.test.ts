import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-db-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("phase 2 database migrations", () => {
  it("creates all v1 tables from a clean sqlite database", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tables).toEqual([
      "ai_chat_messages",
      "ai_chat_sessions",
      "ai_task_candidates",
      "ai_tasks",
      "arc_ai_summaries",
      "book_ai_summaries",
      "chapter_ai_summaries",
      "chapter_ai_summary_chunks",
      "chapter_snapshots",
      "chapters",
      "import_jobs",
      "projects",
      "prompt_presets",
      "schema_migrations",
      "scratch_notes",
      "settings",
      "summary_jobs"
    ]);
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 }
    ]);
    expect(db.prepare("PRAGMA table_info(import_jobs)").all().find((row) => row.name === "project_id")).toMatchObject({ notnull: 0 });
    expect(db.prepare("PRAGMA table_info(ai_task_candidates)").all().find((row) => row.name === "metadata_json")).toMatchObject({
      notnull: 0
    });
    expect(db.prepare("PRAGMA table_info(ai_chat_messages)").all().find((row) => row.name === "action_json")).toMatchObject({
      notnull: 0
    });
    expect(db.prepare("PRAGMA table_info(chapters)").all().find((row) => row.name === "daily_word_count_date")).toMatchObject({
      notnull: 0
    });
    expect(db.prepare("PRAGMA table_info(ai_chat_sessions)").all().find((row) => row.name === "context_usage_json")).toMatchObject({
      notnull: 0
    });
    expect(db.prepare("PRAGMA table_info(ai_chat_sessions)").all().find((row) => row.name === "memory_summary")).toMatchObject({
      notnull: 0
    });
    expect(db.prepare("PRAGMA table_info(ai_chat_sessions)").all().find((row) => row.name === "memory_compacted_through_message_id")).toMatchObject({
      notnull: 0
    });

    db.close();
  });

  it("can run migrations repeatedly without duplicating versions", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    runMigrations(db);

    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 10 });

    db.close();
  });

  it("clears persisted summary caches when moving to the V2 chapter fact index", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "project_1",
      "归途",
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000Z"
    );
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("chapter_1", "project_1", "第1章", 0, JSON.stringify({ type: "doc", content: [] }), "正文", 2, 0, "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO chapter_ai_summaries
       (id, project_id, chapter_id, chapter_title, chapter_order, content_hash, summary_short, summary_long, structured_json, token_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("summary_1", "project_1", "chapter_1", "第1章", 1, "old_hash", "旧摘要", "旧摘要", JSON.stringify({ oneLine: "旧摘要" }), 1, "ready", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO arc_ai_summaries
       (id, project_id, arc_key, chapter_from, chapter_to, source_hash, summary, structured_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("arc_1", "project_1", "auto:001-001", 1, 1, "old_source", "旧阶段", JSON.stringify({ synopsis: "旧阶段" }), "ready", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO book_ai_summaries
       (id, project_id, source_hash, summary_short, summary_long, structured_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("book_1", "project_1", "old_source", "旧全书", "旧全书", JSON.stringify({ synopsis: "旧全书" }), "ready", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO summary_jobs
       (id, project_id, job_type, target_id, source_hash, status, priority, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("job_1", "project_1", "chapter_summary", "chapter_1", "old_hash", "queued", 1, 0, "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");

    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(8);
    runMigrations(db);

    expect(db.prepare("SELECT COUNT(*) AS count FROM chapter_ai_summaries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM arc_ai_summaries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM book_ai_summaries").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM summary_jobs").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 10 });

    db.close();
  });

  it("enforces v1 AI task and candidate status boundaries", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "project_1",
      "归途",
      "2026-04-27T00:00:00.000Z",
      "2026-04-27T00:00:00.000Z"
    );

    expect(() =>
      db.prepare(
        "INSERT INTO ai_tasks (id, project_id, task_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("task_bad", "project_1", "polish", "unknown", "2026-04-27T00:00:00.000Z", "2026-04-27T00:00:00.000Z")
    ).toThrow();

    db.prepare("INSERT INTO ai_tasks (id, project_id, task_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "task_1",
      "project_1",
      "expand",
      "preview_ready",
      "2026-04-27T00:00:00.000Z",
      "2026-04-27T00:00:00.000Z"
    );
    db.prepare(
      "INSERT INTO ai_task_candidates (id, task_id, kind, generated_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "candidate_1",
      "task_1",
      "expand",
      "扩写结果",
      "inserted",
      "2026-04-27T00:00:00.000Z",
      "2026-04-27T00:00:00.000Z"
    );

    expect(db.prepare("SELECT status FROM ai_task_candidates WHERE id = ?").get("candidate_1")).toEqual({ status: "inserted" });

    db.close();
  });

  it("enforces prompt preset and import job boundaries", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "project_1",
      "归途",
      "2026-04-27T00:00:00.000Z",
      "2026-04-27T00:00:00.000Z"
    );

    expect(() =>
      db.prepare(
        "INSERT INTO prompt_presets (id, project_id, name, task_type, system_prompt, user_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("preset_bad", "project_1", "摘要", "summarize", "system", "user", "2026-04-27T00:00:00.000Z", "2026-04-27T00:00:00.000Z")
    ).toThrow();
    expect(() =>
      db.prepare(
        "INSERT INTO import_jobs (id, project_id, source_path, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run("import_bad", "project_1", "/tmp/a.txt", "epub", "unknown", "2026-04-27T00:00:00.000Z", "2026-04-27T00:00:00.000Z")
    ).toThrow();
    db.prepare(
      "INSERT INTO import_jobs (id, source_path, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("import_staging", "/tmp/new-project.txt", "txt", "preview", "2026-04-27T00:00:00.000Z", "2026-04-27T00:00:00.000Z");

    db.prepare(
      "INSERT INTO import_jobs (id, project_id, source_path, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("import_1", "project_1", "/tmp/a.txt", "txt", "preview", "2026-04-27T00:00:00.000Z", "2026-04-27T00:00:00.000Z");

    expect(db.prepare("SELECT source_type, status FROM import_jobs WHERE id = ?").get("import_1")).toEqual({
      source_type: "txt",
      status: "preview"
    });

    db.close();
  });
});
