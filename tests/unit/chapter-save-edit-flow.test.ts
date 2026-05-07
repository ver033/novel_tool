import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyChapterContent } from "../../src/main/chapter/default-content";
import { ChapterService, type SummaryIndexInvalidator } from "../../src/main/chapter/chapter-service";
import { createDatabase, type SqliteDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { createTiptapDocumentFromPlainText } from "../../src/renderer/editor/tiptap/converters";

const tempDirs: string[] = [];
const databases: SqliteDatabase[] = [];

function createTestDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "moshu-chapter-save-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "test.sqlite3"));
  databases.push(db);
  runMigrations(db);
  return db;
}

function createLegacyDatabaseWithoutSaveSchema() {
  const dir = mkdtempSync(join(tmpdir(), "moshu-legacy-chapter-save-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "test.sqlite3"));
  databases.push(db);
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      volume_title TEXT,
      sort_order INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      daily_word_count INTEGER NOT NULL DEFAULT 0,
      target_word_count INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE chapter_snapshots (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      content_json TEXT NOT NULL,
      plain_text TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function createProject(repo: ProjectRepository, id: string) {
  return repo.create({
    id,
    name: id,
    rootPath: null,
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z"
  });
}

function createChapter(repo: ChapterRepository, input: { readonly chapterId: string; readonly projectId: string; readonly title: string; readonly text: string }) {
  const createdAt = "2026-05-04T00:00:00.000Z";
  return repo.create({
    id: input.chapterId,
    projectId: input.projectId,
    title: input.title,
    volumeTitle: "第一卷",
    sortOrder: repo.nextSortOrder(input.projectId),
    contentJson: createTiptapDocumentFromPlainText(input.text),
    plainText: input.text,
    wordCount: input.text.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt
  });
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("chapter save and edit flow", () => {
  it("persists edited chapter content, reloads it, and leaves sibling chapters untouched", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const first = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "旧正文" });
    const second = createChapter(chapterRepo, { chapterId: "chapter_2", projectId: "project_1", title: "第2章", text: "第二章不应被修改" });
    const service = new ChapterService(chapterRepo);

    const saved = service.saveContent({
      projectId: "project_1",
      chapterId: first.id,
      contentJson: createTiptapDocumentFromPlainText("新正文\n\n第二段"),
      plainText: "新正文\n\n第二段",
      wordCount: 7
    });

    expect(saved).toMatchObject({
      id: "chapter_1",
      projectId: "project_1",
      plainText: "新正文\n\n第二段",
      wordCount: 6
    });
    const reloaded = service.getContent({ projectId: "project_1", chapterId: first.id });
    expect(reloaded.plainText).toBe("新正文\n\n第二段");
    expect(reloaded.contentJson).toEqual(createTiptapDocumentFromPlainText("新正文\n\n第二段"));
    expect(service.getContent({ projectId: "project_1", chapterId: second.id }).plainText).toBe("第二章不应被修改");
  });

  it("recomputes saved word count in main instead of trusting the renderer payload", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "旧正文" });
    const service = new ChapterService(chapterRepo);

    const saved = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("林远abc，１２"),
      plainText: "林远abc，１２",
      wordCount: 999
    });

    expect(saved.wordCount).toBe(7);
    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).wordCount).toBe(7);
  });

  it("normalizes legacy stored word counts when reading chapters", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "母亲停下筷子。" });
    db.prepare("UPDATE chapters SET word_count = ? WHERE id = ?").run(999, chapter.id);
    const service = new ChapterService(chapterRepo);

    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).wordCount).toBe(6);
    expect(service.listChapters({ projectId: "project_1" })[0]?.wordCount).toBe(6);
  });

  it("self-heals already-open legacy chapter databases before saving content", () => {
    const db = createLegacyDatabaseWithoutSaveSchema();
    const projectRepo = new ProjectRepository(db);
    createProject(projectRepo, "project_1");
    const insertedAt = "2026-05-04T00:00:00.000Z";
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, title, sort_order, content_json, plain_text, word_count, daily_word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "chapter_legacy",
      "project_1",
      "第1章",
      0,
      JSON.stringify(createTiptapDocumentFromPlainText("旧正文")),
      "旧正文",
      3,
      0,
      insertedAt,
      insertedAt
    );

    const chapterRepo = new ChapterRepository(db);
    const service = new ChapterService(chapterRepo);
    const saved = service.saveContent({
      projectId: "project_1",
      chapterId: "chapter_legacy",
      contentJson: createTiptapDocumentFromPlainText("新正文"),
      plainText: "新正文",
      wordCount: 3,
      expectedUpdatedAt: insertedAt
    });

    expect(saved.plainText).toBe("新正文");
    expect(saved.contentUpdatedAt).toBe(saved.updatedAt);
    const columns = db.prepare("PRAGMA table_info(chapters)").all().map((row) => row.name);
    expect(columns).toContain("daily_word_count_date");
    expect(columns).toContain("content_updated_at");
  });

  it("rejects stale saves instead of overwriting newer text", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "初始正文" });
    const service = new ChapterService(chapterRepo);
    const firstSave = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("较新的正文"),
      plainText: "较新的正文",
      wordCount: 5
    });

    expect(() =>
      chapterRepo.saveContent(
        chapter.id,
        createTiptapDocumentFromPlainText("旧请求覆盖正文"),
        "旧请求覆盖正文",
        7,
        0,
        "2026-05-04",
        "2026-05-04T00:00:05.000Z",
        chapter.updatedAt
      )
    ).toThrow("章节内容已被其他操作更新");
    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).plainText).toBe(firstSave.plainText);
  });

  it("rejects stale client-version saves at the service boundary", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "初始正文" });
    const service = new ChapterService(chapterRepo);
    const firstSave = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("较新的正文"),
      plainText: "较新的正文",
      wordCount: 5
    });

    expect(() =>
      service.saveContent({
        projectId: "project_1",
        chapterId: chapter.id,
        contentJson: createTiptapDocumentFromPlainText("旧客户端正文"),
        plainText: "旧客户端正文",
        wordCount: 6,
        expectedUpdatedAt: chapter.updatedAt
      } as Parameters<ChapterService["saveContent"]>[0])
    ).toThrow("章节内容已被其他操作更新");
    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).plainText).toBe(firstSave.plainText);
  });

  it("keeps content versions strictly increasing even when saves happen in the same millisecond", () => {
    vi.useFakeTimers();
    try {
      const db = createTestDatabase();
      const projectRepo = new ProjectRepository(db);
      const chapterRepo = new ChapterRepository(db);
      createProject(projectRepo, "project_1");
      const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "初始正文" });
      const service = new ChapterService(chapterRepo);
      vi.setSystemTime(new Date(chapter.updatedAt));

      const firstSave = service.saveContent({
        projectId: "project_1",
        chapterId: chapter.id,
        contentJson: createTiptapDocumentFromPlainText("第一版正文"),
        plainText: "第一版正文",
        wordCount: 5,
        expectedUpdatedAt: chapter.updatedAt
      });
      const secondSave = service.saveContent({
        projectId: "project_1",
        chapterId: chapter.id,
        contentJson: createTiptapDocumentFromPlainText("第二版正文"),
        plainText: "第二版正文",
        wordCount: 5,
        expectedUpdatedAt: firstSave.contentUpdatedAt
      });

      expect(firstSave.contentUpdatedAt).not.toBe(chapter.updatedAt);
      expect(secondSave.contentUpdatedAt).not.toBe(firstSave.contentUpdatedAt);
      expect(() =>
        service.saveContent({
          projectId: "project_1",
          chapterId: chapter.id,
          contentJson: createTiptapDocumentFromPlainText("旧第一版覆盖"),
          plainText: "旧第一版覆盖",
          wordCount: 6,
          expectedUpdatedAt: firstSave.contentUpdatedAt
        } as Parameters<ChapterService["saveContent"]>[0])
      ).toThrow("章节内容已被其他操作更新");
      expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).plainText).toBe("第二版正文");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not treat chapter metadata edits as competing content saves", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "编辑器已加载正文" });
    const service = new ChapterService(chapterRepo);
    const loaded = service.getContent({ projectId: "project_1", chapterId: chapter.id });

    const updatedMetadata = service.updateTargetWordCount({
      projectId: "project_1",
      chapterId: chapter.id,
      targetWordCount: 3000
    });
    expect(updatedMetadata.updatedAt).not.toBe(loaded.updatedAt);

    const saved = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("编辑器已加载正文\n\n追加正文"),
      plainText: "编辑器已加载正文\n\n追加正文",
      wordCount: 13,
      expectedUpdatedAt: loaded.updatedAt
    });

    expect(saved.plainText).toBe("编辑器已加载正文\n\n追加正文");
    expect(saved.targetWordCount).toBe(3000);
  });

  it("rejects a save when the database read-back content does not match the submitted text", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "原始正文" });
    const invalidator: SummaryIndexInvalidator = {
      markChapterContentChanged: vi.fn()
    };
    const service = new ChapterService(chapterRepo, { summaryIndexInvalidator: invalidator });

    db.prepare(
      `CREATE TRIGGER corrupt_chapter_plain_text_after_save
       AFTER UPDATE ON chapters
       BEGIN
         UPDATE chapters SET plain_text = '被篡改正文' WHERE id = NEW.id;
       END`
    ).run();

    expect(() =>
      service.saveContent({
        projectId: "project_1",
        chapterId: chapter.id,
        contentJson: createTiptapDocumentFromPlainText("用户新正文"),
        plainText: "用户新正文",
        wordCount: 5
      })
    ).toThrow("章节保存后读回校验失败");
    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).plainText).toBe("原始正文");
    expect(invalidator.markChapterContentChanged).not.toHaveBeenCalled();
  });

  it("never lets save, rename, delete, target updates, or snapshots cross project boundaries", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    createProject(projectRepo, "project_2");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "项目一正文" });
    const service = new ChapterService(chapterRepo);

    expect(() =>
      service.saveContent({
        projectId: "project_2",
        chapterId: chapter.id,
        contentJson: createTiptapDocumentFromPlainText("错误项目正文"),
        plainText: "错误项目正文",
        wordCount: 6
      })
    ).toThrow("章节不属于当前项目");
    expect(() => service.renameChapter({ projectId: "project_2", chapterId: chapter.id, title: "错误标题" })).toThrow("章节不属于当前项目");
    expect(() => service.updateTargetWordCount({ projectId: "project_2", chapterId: chapter.id, targetWordCount: 9000 })).toThrow(
      "章节不属于当前项目"
    );
    expect(() => service.createSnapshot({ projectId: "project_2", chapterId: chapter.id, reason: "wrong-project" })).toThrow("章节不属于当前项目");
    expect(() => service.deleteChapter({ projectId: "project_2", chapterId: chapter.id })).toThrow("章节不属于当前项目");

    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id })).toMatchObject({
      title: "第1章",
      plainText: "项目一正文",
      targetWordCount: null
    });
  });

  it("marks summary cache stale only after a successful real content change", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "原文" });
    const invalidator: SummaryIndexInvalidator = {
      markChapterContentChanged: vi.fn()
    };
    const service = new ChapterService(chapterRepo, { summaryIndexInvalidator: invalidator });

    service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("原文"),
      plainText: "原文",
      wordCount: 2
    });
    expect(invalidator.markChapterContentChanged).not.toHaveBeenCalled();

    service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("新原文"),
      plainText: "新原文",
      wordCount: 3
    });
    expect(invalidator.markChapterContentChanged).toHaveBeenCalledTimes(1);
    expect(invalidator.markChapterContentChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: chapter.id,
        previousPlainText: "原文",
        nextPlainText: "新原文"
      })
    );
  });

  it("does not report the chapter save as failed when post-save summary invalidation fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const db = createTestDatabase();
      const projectRepo = new ProjectRepository(db);
      const chapterRepo = new ChapterRepository(db);
      createProject(projectRepo, "project_1");
      const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "原文" });
      const invalidator: SummaryIndexInvalidator = {
        markChapterContentChanged() {
          throw new Error("summary cache schema unavailable");
        }
      };
      const service = new ChapterService(chapterRepo, { summaryIndexInvalidator: invalidator });

      const saved = service.saveContent({
        projectId: "project_1",
        chapterId: chapter.id,
        contentJson: createTiptapDocumentFromPlainText("新正文"),
        plainText: "新正文",
        wordCount: 3,
        expectedUpdatedAt: chapter.updatedAt
      });

      expect(saved.plainText).toBe("新正文");
      expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).plainText).toBe("新正文");
      expect(warn).toHaveBeenCalledWith("Failed to invalidate chapter summary cache after content save", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it("daily word count follows additions, deletions, and full undo-like saves without going negative", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "一二三四" });
    const service = new ChapterService(chapterRepo);

    const added = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("一二三四五六"),
      plainText: "一二三四五六",
      wordCount: 6
    });
    expect(added.dailyWordCount).toBe(2);

    const deleted = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("一"),
      plainText: "一",
      wordCount: 1
    });
    expect(deleted.dailyWordCount).toBe(0);

    const undone = service.saveContent({
      projectId: "project_1",
      chapterId: chapter.id,
      contentJson: createTiptapDocumentFromPlainText("一二三四"),
      plainText: "一二三四",
      wordCount: 4
    });
    expect(undone.dailyWordCount).toBe(3);
  });

  it("creates a snapshot from the current saved content without changing the chapter", () => {
    const db = createTestDatabase();
    const projectRepo = new ProjectRepository(db);
    const chapterRepo = new ChapterRepository(db);
    createProject(projectRepo, "project_1");
    const chapter = createChapter(chapterRepo, { chapterId: "chapter_1", projectId: "project_1", title: "第1章", text: "保存正文" });
    const service = new ChapterService(chapterRepo);

    const snapshot = service.createSnapshot({
      projectId: "project_1",
      chapterId: chapter.id,
      reason: "manual-check"
    });

    expect(snapshot).toMatchObject({
      chapterId: chapter.id,
      plainText: "保存正文",
      reason: "manual-check"
    });
    expect(service.getContent({ projectId: "project_1", chapterId: chapter.id }).plainText).toBe("保存正文");
  });
});
