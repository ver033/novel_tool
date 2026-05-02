import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ImportJobRepository } from "../../src/main/db/repositories/import-job-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { TxtImporter } from "../../src/main/import/txt-importer";
import { ProjectService } from "../../src/main/project/project-service";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function trackProjectService(projectService: ProjectService): ProjectService {
  projectServices.push(projectService);
  return projectService;
}

function createImporter() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-import-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const chapterRepo = new ChapterRepository(db);
  const importJobRepo = new ImportJobRepository(db);
  const projectRepo = new ProjectRepository(db);
  const projectService = trackProjectService(
    new ProjectService(projectRepo, {
      projectFileDirectory: join(dir, "projects")
    })
  );

  return {
    db,
    dir,
    importer: new TxtImporter(importJobRepo, projectRepo, projectService),
    chapterRepo,
    projectRepo,
    projectService
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

function createLargeTxt(): string {
  const filler = "林远沿着旧路往家中走去，风从田野尽头吹来，带着炊烟与青草气。";
  return [
    "序章",
    filler.repeat(1300),
    "第一章 回家",
    filler.repeat(1300),
    "第二章 晚饭",
    filler.repeat(1300)
  ].join("\n\n");
}

function openProjectChapterRepo(projectFilePath: string): { db: ReturnType<typeof createDatabase>; chapterRepo: ChapterRepository } {
  const db = createDatabase(projectFilePath, { journalMode: "DELETE" });
  runMigrations(db);
  return {
    db,
    chapterRepo: new ChapterRepository(db)
  };
}

describe("TXT import flow", () => {
  it("previews, adjusts, and imports a 100k character TXT as a new project", () => {
    const { db, dir, importer, chapterRepo, projectRepo } = createImporter();
    const filePath = join(dir, "归途.txt");
    writeFileSync(filePath, createLargeTxt(), "utf8");

    const preview = importer.previewTxt({ filePath });
    expect(preview.fileName).toBe("归途.txt");
    expect(preview.encoding).toBeTruthy();
    expect(preview.totalWordCount).toBeGreaterThan(100000);
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(["序章", "第一章 回家", "第二章 晚饭"]);

    const adjusted = importer.updatePreview({
      importJobId: preview.importJobId,
      operations: [{ type: "rename_chapter", chapterIndex: 1, title: "第一章 归家" }]
    });
    expect(adjusted.chapters[1].title).toBe("第一章 归家");

    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "create_new_project",
      projectName: "归途"
    });

    expect(confirmed.project).toMatchObject({ name: "归途" });
    expect(confirmed.chapters.map((chapter) => chapter.title)).toEqual(["序章", "第一章 归家", "第二章 晚饭"]);
    expect(confirmed.firstChapterId).toBe(confirmed.chapters[0].id);
    expect(projectRepo.getCurrentProjectId()).toBe(confirmed.project.id);
    expect(chapterRepo.getContent(confirmed.chapters[0].id)).toBeNull();
    const projectFile = openProjectChapterRepo(confirmed.project.rootPath!);
    expect(projectFile.chapterRepo.getContent(confirmed.chapters[0].id)?.plainText.length).toBeGreaterThan(1000);
    expect(projectFile.db.prepare("SELECT job_type, status, COUNT(*) AS count FROM summary_jobs GROUP BY job_type, status").all()).toEqual([
      {
        job_type: "chapter_summary",
        status: "queued",
        count: 3
      }
    ]);
    projectFile.db.close();

    db.close();
  });

  it("imports previewed chapters into an existing project at the end", () => {
    const { db, dir, importer, projectService } = createImporter();
    const created = projectService.createProject({
      name: "旧项目",
      rootPath: join(dir, "旧项目.noveltool")
    });
    new ChapterRepository(projectService.getProjectDatabaseForProject(created.project.id)).rename(created.initialChapter.id, "第1章 旧章", new Date().toISOString());
    const filePath = join(dir, "追加.txt");
    writeFileSync(filePath, "第二章 新章\n新的内容。", "utf8");

    const preview = importer.previewTxt({ filePath });
    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "import_into_current_project",
      projectId: created.project.id
    });

    expect(confirmed.project.id).toBe(created.project.id);
    expect(confirmed.chapters.map((chapter) => chapter.title)).toEqual(["第二章 新章"]);
    expect(new ChapterRepository(projectService.getProjectDatabaseForProject(created.project.id)).listByProject(created.project.id).map((chapter) => chapter.title)).toEqual([
      "第1章 旧章",
      "第二章 新章"
    ]);

    db.close();
  });

  it("queues summary jobs only for eligible chapters appended to the current project", () => {
    const { db, dir, importer, projectService } = createImporter();
    const created = projectService.createProject({
      name: "旧项目",
      rootPath: join(dir, "旧项目.noveltool")
    });
    const filePath = join(dir, "追加长章.txt");
    writeFileSync(filePath, ["第二章 长章", "雨".repeat(620), "第三章 短章", "新线索。"].join("\n\n"), "utf8");

    const preview = importer.previewTxt({ filePath });
    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "import_into_current_project",
      projectId: created.project.id
    });

    const summaryRepo = new SummaryRepository(projectService.getProjectDatabaseForProject(created.project.id));
    expect(summaryRepo.claimNextSummaryJob(created.project.id, "2026-05-01T00:00:00.000Z")).toMatchObject({
      jobType: "chapter_summary",
      targetId: confirmed.chapters[0].id,
      priority: 8
    });
    expect(summaryRepo.claimNextSummaryJob(created.project.id, "2026-05-01T00:00:00.000Z")).toBeNull();

    db.close();
  });

  it("rejects repeated confirmation for the same import job without duplicating chapters", () => {
    const { db, dir, importer, chapterRepo } = createImporter();
    const filePath = join(dir, "归途.txt");
    writeFileSync(filePath, "第一章 回家\n林远回来了。", "utf8");

    const preview = importer.previewTxt({ filePath });
    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "create_new_project",
      projectName: "归途"
    });

    expect(() =>
      importer.confirmTxtImport({
        importJobId: preview.importJobId,
        mode: "create_new_project",
        projectName: "归途"
      })
    ).toThrow("Import job has already been confirmed");
    const projectFile = openProjectChapterRepo(confirmed.project.rootPath!);
    expect(projectFile.chapterRepo.listByProject(confirmed.project.id).map((chapter) => chapter.title)).toEqual(["第一章 回家"]);
    projectFile.db.close();

    db.close();
  });

  it("reopens the existing imported project when the same TXT file is imported again", () => {
    const { db, dir, importer, chapterRepo, projectRepo } = createImporter();
    const filePath = join(dir, "test.txt");
    writeFileSync(filePath, "第一章 回家\n林远回来了。", "utf8");

    const firstPreview = importer.previewTxt({ filePath });
    const firstImport = importer.confirmTxtImport({
      importJobId: firstPreview.importJobId,
      mode: "create_new_project",
      projectName: "test"
    });
    const secondPreview = importer.previewTxt({ filePath });
    const secondImport = importer.confirmTxtImport({
      importJobId: secondPreview.importJobId,
      mode: "create_new_project",
      projectName: "test"
    });

    expect(secondImport.project.id).toBe(firstImport.project.id);
    expect(secondImport.chapters.map((chapter) => chapter.id)).toEqual(firstImport.chapters.map((chapter) => chapter.id));
    const projectFile = openProjectChapterRepo(firstImport.project.rootPath!);
    expect(projectFile.chapterRepo.listByProject(firstImport.project.id).map((chapter) => chapter.title)).toEqual(["第一章 回家"]);
    projectFile.db.close();
    expect(projectRepo.listRecent().filter((project) => project.rootPath === join(dir, "test.noveltool"))).toHaveLength(1);

    db.close();
  });

  it("does not reuse app-only same-name rows as project content", () => {
    const { db, dir, importer, chapterRepo, projectRepo } = createImporter();
    const createdAt = new Date().toISOString();
    projectRepo.create({
      id: "project_legacy_test",
      name: "test",
      rootPath: null,
      createdAt,
      updatedAt: createdAt
    });
    const filePath = join(dir, "test.txt");
    writeFileSync(filePath, "第一章 回家\n林远回来了。", "utf8");

    const preview = importer.previewTxt({ filePath });
    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "create_new_project",
      projectName: "test"
    });

    expect(confirmed.project).toMatchObject({ name: "test", rootPath: join(dir, "test.noveltool") });
    expect(confirmed.project.id).not.toBe("project_legacy_test");
    expect(chapterRepo.listByProject("project_legacy_test")).toEqual([]);
    expect(projectRepo.listRecent().filter((project) => project.name === "test")).toHaveLength(1);

    db.close();
  });
});
