import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";

const tempDirs: string[] = [];

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-outline-db-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("outline migrations", () => {
  it("creates outline planning tables and indexes", () => {
    const db = createDatabase(createTempDbPath());

    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(["outline_threads", "outline_events", "outline_event_threads", "outline_chapter_notes"]));

    const eventColumns = db.prepare("PRAGMA table_info(outline_events)").all().map((row) => row.name);
    expect(eventColumns).toEqual(
      expect.arrayContaining([
        "id",
        "project_id",
        "chapter_id",
        "story_date",
        "story_time_label",
        "weekday_label",
        "story_time_order",
        "day_segment",
        "event_order",
        "import_batch_id"
      ])
    );

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('outline_threads', 'outline_events', 'outline_event_threads')")
      .all()
      .map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_outline_threads_project_sort",
        "idx_outline_events_project_order",
        "idx_outline_events_project_chapter",
        "idx_outline_events_project_date",
        "idx_outline_events_project_time_order",
        "idx_outline_events_project_import_batch",
        "idx_outline_event_threads_thread"
      ])
    );
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()).toEqual({ version: 22 });

    db.close();
  });
});
