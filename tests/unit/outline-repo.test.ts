import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { OutlineRepository } from "../../src/main/db/repositories/outline-repo";

const tempDirs: string[] = [];
let db: SqliteDatabase;
let repo: OutlineRepository;

function createTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-outline-repo-"));
  tempDirs.push(dir);
  return join(dir, "novel-tool.sqlite3");
}

function createProject(projectId = "project_1"): void {
  db.prepare("INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    projectId,
    projectId,
    null,
    "2026-05-21T00:00:00.000Z",
    "2026-05-21T00:00:00.000Z"
  );
}

function createChapter(projectId: string, chapterId: string, title: string, sortOrder: number): void {
  db.prepare(
    `INSERT INTO chapters (
      id, project_id, title, volume_title, sort_order, content_json, plain_text,
      word_count, daily_word_count, daily_word_count_date, target_word_count, status, created_at, updated_at, content_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    chapterId,
    projectId,
    title,
    null,
    sortOrder,
    JSON.stringify({ type: "doc", content: [] }),
    "",
    0,
    0,
    null,
    null,
    "draft",
    "2026-05-21T00:00:00.000Z",
    "2026-05-21T00:00:00.000Z",
    "2026-05-21T00:00:00.000Z"
  );
}

beforeEach(() => {
  db = createDatabase(createTempDbPath());
  runMigrations(db);
  repo = new OutlineRepository(db);
  createProject("project_1");
  createChapter("project_1", "chapter_1", "第一章", 1);
  createChapter("project_1", "chapter_2", "第二章", 2);
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("OutlineRepository", () => {
  it("creates events with multiple threads and lists them by chapter", () => {
    const thread = repo.createThread({
      id: "thread_1",
      projectId: "project_1",
      name: "主线",
      color: "#2f80ed",
      sortOrder: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z"
    });

    const event = repo.createEvent({
      id: "event_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "雨夜相遇",
      summary: "主角遇见线人。",
      storyDate: null,
      storyTimeLabel: "案发当晚",
      weekdayLabel: "雨夜",
      storyTimeOrder: 1,
      daySegment: "night",
      customDaySegment: null,
      location: "旧码头",
      povCharacter: "主角",
      characters: ["主角", "线人"],
      goal: "",
      conflict: "",
      outcome: "",
      foreshadowing: "",
      notes: "",
      status: "planned",
      eventOrder: 1,
      importBatchId: null,
      threadIds: [thread.id],
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z"
    });

    expect(event.threadIds).toEqual(["thread_1"]);
    expect(repo.listEvents({ projectId: "project_1", chapterId: "chapter_1" })).toEqual([event]);
  });

  it("deleting a thread removes links but keeps events", () => {
    repo.createThread({
      id: "thread_1",
      projectId: "project_1",
      name: "主线",
      color: "#2f80ed",
      sortOrder: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z"
    });
    repo.createEvent({
      id: "event_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "雨夜相遇",
      summary: "主角遇见线人。",
      storyDate: null,
      storyTimeLabel: "案发当晚",
      weekdayLabel: "",
      storyTimeOrder: 1,
      daySegment: "night",
      customDaySegment: null,
      location: "",
      povCharacter: "",
      characters: [],
      goal: "",
      conflict: "",
      outcome: "",
      foreshadowing: "",
      notes: "",
      status: "planned",
      eventOrder: 1,
      importBatchId: null,
      threadIds: ["thread_1"],
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z"
    });

    repo.deleteThread("project_1", "thread_1");

    expect(repo.listThreads("project_1")).toEqual([]);
    expect(repo.getEvent("project_1", "event_1")?.threadIds).toEqual([]);
  });

  it("clears nullable event fields when the author removes optional outline metadata", () => {
    repo.createEvent({
      id: "event_1",
      projectId: "project_1",
      chapterId: "chapter_1",
      title: "雨夜相遇",
      summary: "主角遇见线人。",
      storyDate: "2026-05-21",
      storyTimeLabel: "案发当晚",
      weekdayLabel: "星期四",
      storyTimeOrder: 3,
      daySegment: "custom",
      customDaySegment: "午夜",
      location: "",
      povCharacter: "",
      characters: [],
      goal: "",
      conflict: "",
      outcome: "",
      foreshadowing: "",
      notes: "",
      status: "planned",
      eventOrder: 1,
      importBatchId: "outline_import_1",
      threadIds: [],
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z"
    });

    const updated = repo.updateEvent({
      projectId: "project_1",
      eventId: "event_1",
      patch: {
        chapterId: null,
        storyDate: null,
        storyTimeOrder: null,
        customDaySegment: null,
        importBatchId: null,
        updatedAt: "2026-05-21T01:00:00.000Z"
      }
    });

    expect(updated.chapterId).toBeNull();
    expect(updated.storyDate).toBeNull();
    expect(updated.storyTimeOrder).toBeNull();
    expect(updated.customDaySegment).toBeNull();
    expect(updated.importBatchId).toBeNull();
  });

  it("saves chapter notes and deletes imported batches atomically", () => {
    const note = repo.saveChapterNote({
      projectId: "project_1",
      chapterId: "chapter_1",
      content: "本章先铺悬念。",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z"
    });
    expect(note.content).toBe("本章先铺悬念。");

    repo.createEventsBulk([
      {
        id: "event_1",
        projectId: "project_1",
        chapterId: "chapter_1",
        title: "导入 1",
        summary: "导入事件 1",
        storyDate: null,
        storyTimeLabel: "",
        weekdayLabel: "",
        storyTimeOrder: 1,
        daySegment: "unknown",
        customDaySegment: null,
        location: "",
        povCharacter: "",
        characters: [],
        goal: "",
        conflict: "",
        outcome: "",
        foreshadowing: "",
        notes: "",
        status: "planned",
        eventOrder: 1,
        importBatchId: "outline_import_1",
        threadIds: [],
        createdAt: "2026-05-21T00:00:00.000Z",
        updatedAt: "2026-05-21T00:00:00.000Z"
      }
    ]);

    expect(repo.deleteImportBatch("project_1", "outline_import_1")).toBe(1);
    expect(repo.listEvents({ projectId: "project_1" })).toEqual([]);
  });
});
