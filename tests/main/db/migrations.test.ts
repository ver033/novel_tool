import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { initializeDatabase } from "../../../src/main/db/migrations";

describe("database migrations", () => {
  test("are idempotent and create the Gate A schema", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "novel-tool-db-"));
    const dbPath = path.join(root, "book.db");

    initializeDatabase(dbPath);
    initializeDatabase(dbPath);

    const db = new Database(dbPath);
    const userVersion = db.pragma("user_version", { simple: true });
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name")
      .all() as Array<{ name: string }>;
    db.close();

    expect(userVersion).toBeGreaterThanOrEqual(1);
    expect(names.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "projects",
        "books",
        "chapters",
        "paragraphs",
        "paragraph_versions",
        "issues",
        "issue_evidence",
        "entities",
        "facts",
        "events",
        "ai_tasks",
        "jobs",
        "job_events",
        "paragraphs_fts"
      ])
    );
  });
});
