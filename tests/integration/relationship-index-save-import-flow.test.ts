import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChapterService, type SummaryIndexInvalidator } from "../../src/main/chapter/chapter-service";
import { createChapterContentInvalidator } from "../../src/main/chapter/chapter-content-invalidator";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ImportJobRepository } from "../../src/main/db/repositories/import-job-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { RelationshipIndexRepository } from "../../src/main/db/repositories/relationship-index-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { TxtImporter } from "../../src/main/import/txt-importer";
import { ProjectService } from "../../src/main/project/project-service";
import type { ChapterContent } from "../../src/main/shared/types";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];
const now = "2026-05-13T01:00:00.000Z";

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-relationship-flow-"));
  tempDirs.push(dir);
  return dir;
}

function createTiptapDocumentFromPlainText(text: string): { readonly [key: string]: unknown; readonly type: string } {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : undefined }]
  };
}

function createChapter(repo: ChapterRepository, input: { readonly projectId: string; readonly chapterId: string; readonly text: string }): void {
  repo.create({
    id: input.chapterId,
    projectId: input.projectId,
    title: "第1章",
    volumeTitle: "第一卷",
    sortOrder: 0,
    contentJson: createTiptapDocumentFromPlainText(input.text),
    plainText: input.text,
    wordCount: input.text.length,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    contentUpdatedAt: now
  } satisfies ChapterContent);
}

function createImporter() {
  const dir = createTempDir();
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);
  const importJobRepo = new ImportJobRepository(db);
  const projectRepo = new ProjectRepository(db);
  const projectService = new ProjectService(projectRepo, {
    projectFileDirectory: join(dir, "projects")
  });
  projectServices.push(projectService);

  return {
    db,
    dir,
    projectService,
    importer: new TxtImporter(importJobRepo, projectRepo, projectService)
  };
}

afterEach(() => {
  for (const projectService of projectServices.splice(0)) {
    projectService.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("relationship index save/import integration", () => {
  it("keeps chapter save and summary invalidation working when relationship invalidation throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const dir = createTempDir();
      const db = createDatabase(join(dir, "novel-tool.sqlite3"));
      runMigrations(db);
      const projectRepo = new ProjectRepository(db);
      const chapterRepo = new ChapterRepository(db);
      projectRepo.create({ id: "project_1", name: "保存测试", rootPath: null, createdAt: now, updatedAt: now });
      createChapter(chapterRepo, { projectId: "project_1", chapterId: "chapter_1", text: "原文" });
      const summaryInvalidator: SummaryIndexInvalidator = {
        markChapterContentChanged: vi.fn()
      };
      const relationshipInvalidator: SummaryIndexInvalidator = {
        markChapterContentChanged: vi.fn(() => {
          throw new Error("relationship unavailable");
        })
      };
      const service = new ChapterService(chapterRepo, {
        summaryIndexInvalidator: createChapterContentInvalidator({
          summaryIndexInvalidator: summaryInvalidator,
          relationshipIndexInvalidator: relationshipInvalidator
        })
      });

      const saved = service.saveContent({
        projectId: "project_1",
        chapterId: "chapter_1",
        contentJson: createTiptapDocumentFromPlainText("新正文"),
        plainText: "新正文",
        wordCount: 3,
        expectedUpdatedAt: now
      });

      expect(saved.plainText).toBe("新正文");
      expect(summaryInvalidator.markChapterContentChanged).toHaveBeenCalledTimes(1);
      expect(relationshipInvalidator.markChapterContentChanged).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("Failed to invalidate relationship index after content save", expect.any(Error));
      db.close();
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps summary import jobs without queuing a second relationship LLM job for imported chapters", () => {
    const { db, dir, importer, projectService } = createImporter();
    const created = projectService.createProject({
      name: "旧项目",
      rootPath: join(dir, "旧项目.noveltool")
    });
    const filePath = join(dir, "追加长章.txt");
    writeFileSync(filePath, ["第二章 长章", "雨".repeat(240)].join("\n\n"), "utf8");

    const preview = importer.previewTxt({ filePath });
    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "import_into_current_project",
      projectId: created.project.id
    });

    const projectDb = projectService.getProjectDatabaseForProject(created.project.id);
    const summaryRepo = new SummaryRepository(projectDb);
    const relationshipRepo = new RelationshipIndexRepository(projectDb);
    expect(summaryRepo.claimNextSummaryJob(created.project.id, "2099-01-01T00:00:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      targetId: confirmed.chapters[0].id
    });
    expect(relationshipRepo.peekNextRelationshipJob(created.project.id, "2099-01-01T00:00:00.000Z")).toBeNull();
    expect(relationshipRepo.getIndexStatus(created.project.id)).toMatchObject({
      queued: 0,
      running: 0,
      ready: 0
    });

    db.close();
  });
});
