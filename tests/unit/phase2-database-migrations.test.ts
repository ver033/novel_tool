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
      "author_relationship_characters",
      "author_relationships",
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
      "summary_jobs",
      "writing_daily_stats",
      "writing_goal_daily_plans",
      "writing_goals",
      "writing_word_events"
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
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 15 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 }
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
    expect(db.prepare("PRAGMA table_info(chapters)").all().find((row) => row.name === "content_updated_at")).toMatchObject({
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

    expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 18 });

    db.close();
  });

  it("creates author relationship tables for manual graph data", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('author_relationship_characters', 'author_relationships')")
      .all()
      .map((row) => row.name);

    expect(tables.sort()).toEqual(["author_relationship_characters", "author_relationships"]);

    const characterColumns = db.prepare("PRAGMA table_info(author_relationship_characters)").all().map((row) => row.name);
    expect(characterColumns).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "name",
        "normalized_name",
        "aliases_json",
        "entity_kind",
        "importance",
        "role_summary",
        "faction",
        "notes",
        "layout_x",
        "layout_y",
        "created_at",
        "updated_at"
      ])
    );

    const relationColumns = db.prepare("PRAGMA table_info(author_relationships)").all().map((row) => row.name);
    expect(relationColumns).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "source_character_id",
        "target_character_id",
        "source_to_target_label",
        "target_to_source_label",
        "normalized_relation_key",
        "created_at",
        "updated_at"
      ])
    );

    db.close();
  });

  it("creates writing goal and statistics tables for project-level planning", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);

    const goalColumns = db.prepare("PRAGMA table_info(writing_goals)").all().map((row) => row.name);
    expect(goalColumns).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "goal_type",
        "target_word_count",
        "baseline_word_count",
        "active_weekdays_json",
        "rest_dates_json",
        "status"
      ])
    );

    const eventColumns = db.prepare("PRAGMA table_info(writing_word_events)").all().map((row) => row.name);
    expect(eventColumns).toEqual(
      expect.arrayContaining([
        "goal_id",
        "chapter_id",
        "chapter_title",
        "chapter_sort_order",
        "delta_words",
        "previous_project_word_count",
        "next_project_word_count",
        "source"
      ])
    );

    const planColumns = db.prepare("PRAGMA table_info(writing_goal_daily_plans)").all().map((row) => row.name);
    expect(planColumns).toEqual(expect.arrayContaining(["goal_id", "project_id", "local_date", "planned_words", "is_writing_day", "is_rest_day"]));

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'writing_%' ORDER BY name").all().map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_writing_goals_one_open_goal",
        "idx_writing_goals_project_status",
        "idx_writing_word_events_project_date",
        "idx_writing_goal_daily_plans_project_date"
      ])
    );

    db.close();
  });

  it("backfills chapter content version timestamps for existing projects", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "project_content_version",
      "归途",
      "2026-05-06T00:00:00.000Z",
      "2026-05-06T00:00:00.000Z"
    );
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "chapter_content_version",
      "project_content_version",
      "第1章",
      0,
      JSON.stringify({ type: "doc", content: [] }),
      "正文",
      2,
      0,
      "2026-05-06T00:00:00.000Z",
      "2026-05-06T00:01:00.000Z",
      null
    );

    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(12);
    runMigrations(db);

    expect(db.prepare("SELECT content_updated_at FROM chapters WHERE id = ?").get("chapter_content_version")).toEqual({
      content_updated_at: "2026-05-06T00:01:00.000Z"
    });

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
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 21 });

    db.close();
  });

  it("invalidates legacy proofread candidate metadata instead of converting it", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "project_legacy_proofread",
      "归途",
      "2026-05-02T00:00:00.000Z",
      "2026-05-02T00:00:00.000Z"
    );
    db.prepare("INSERT INTO ai_tasks (id, project_id, task_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "task_legacy_proofread",
      "project_legacy_proofread",
      "proofread",
      "preview_ready",
      "2026-05-02T00:00:00.000Z",
      "2026-05-02T00:00:00.000Z"
    );
    db.prepare(
      `INSERT INTO ai_task_candidates
       (id, task_id, kind, generated_text, change_summary, metadata_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "candidate_legacy_proofread",
      "task_legacy_proofread",
      "proofread",
      "",
      "发现 1 个问题",
      JSON.stringify({
        proofreadIssues: [
          {
            type: "表达不顺",
            quote: "雨声里停下脚步",
            suggestion: "林远听着雨声停下脚步。",
            reason: "语序更自然"
          }
        ]
      }),
      "preview",
      "2026-05-02T00:00:00.000Z",
      "2026-05-02T00:00:00.000Z"
    );

    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(11);
    runMigrations(db);

    expect(
      db.prepare("SELECT status, change_summary, metadata_json FROM ai_task_candidates WHERE id = ?").get("candidate_legacy_proofread")
    ).toEqual({
      status: "rejected",
      change_summary: "旧版校对结果已失效，请重新生成。",
      metadata_json: null
    });
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 21 });

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
