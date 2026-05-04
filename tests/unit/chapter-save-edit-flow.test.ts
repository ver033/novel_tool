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
      wordCount: 7
    });
    const reloaded = service.getContent({ projectId: "project_1", chapterId: first.id });
    expect(reloaded.plainText).toBe("新正文\n\n第二段");
    expect(reloaded.contentJson).toEqual(createTiptapDocumentFromPlainText("新正文\n\n第二段"));
    expect(service.getContent({ projectId: "project_1", chapterId: second.id }).plainText).toBe("第二章不应被修改");
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
