import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ImportJobRepository } from "../../src/main/db/repositories/import-job-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { TxtImporter } from "../../src/main/import/txt-importer";
import { ProjectService } from "../../src/main/project/project-service";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function trackProjectService(projectService: ProjectService): ProjectService {
  projectServices.push(projectService);
  return projectService;
}

function createProjectFileServices() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-project-file-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const importJobRepo = new ImportJobRepository(db);
  const projectRepo = new ProjectRepository(db);

  return {
    db,
    dir,
    importer: new TxtImporter(importJobRepo, projectRepo),
    projectService: trackProjectService(new ProjectService(projectRepo))
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

describe("local project file flow", () => {
  it("creates a portable .noveltool SQLite project when importing TXT and opens it without the original app database", () => {
    const { db, dir, importer, projectService } = createProjectFileServices();
    const txtPath = join(dir, "归途.txt");
    writeFileSync(txtPath, "第一章 回家\n林远回来了。", "utf8");

    const preview = importer.previewTxt({ filePath: txtPath });
    const confirmed = importer.confirmTxtImport({
      importJobId: preview.importJobId,
      mode: "create_new_project",
      projectName: "归途"
    });

    expect(confirmed.project.rootPath).toBe(join(dir, "归途.noveltool"));
    expect(existsSync(confirmed.project.rootPath!)).toBe(true);
    expect(new ChapterRepository(db).listByProject(confirmed.project.id)).toEqual([]);

    const projectFileDb = createDatabase(confirmed.project.rootPath!);
    runMigrations(projectFileDb);
    expect(new ProjectRepository(projectFileDb).findById(confirmed.project.id)).toMatchObject({
      id: confirmed.project.id,
      name: "归途",
      rootPath: confirmed.project.rootPath
    });
    expect(new ChapterRepository(projectFileDb).listByProject(confirmed.project.id).map((chapter) => chapter.title)).toEqual(["第一章 回家"]);
    projectFileDb.close();

    const freshAppDb = createDatabase(join(dir, "fresh-app.sqlite3"));
    runMigrations(freshAppDb);
    const freshProjectService = trackProjectService(new ProjectService(new ProjectRepository(freshAppDb)));
    const openedFromFreshAppDb = freshProjectService.openProjectFile({ filePath: confirmed.project.rootPath! });
    expect(openedFromFreshAppDb.project.id).toBe(confirmed.project.id);
    expect(openedFromFreshAppDb.chapters.map((chapter) => chapter.title)).toEqual(["第一章 回家"]);
    freshAppDb.close();

    const opened = projectService.openProjectFile({ filePath: confirmed.project.rootPath! });
    expect(opened.project.id).toBe(confirmed.project.id);
    expect(opened.chapters.map((chapter) => chapter.title)).toEqual(["第一章 回家"]);

    db.close();
  });

  it("renames and deletes projects through the project service", () => {
    const { db, dir, projectService } = createProjectFileServices();
    const projectPath = join(dir, "旧名.noveltool");
    const created = projectService.createProject({ name: "旧名", rootPath: projectPath });
    expect(created.project.rootPath).toBe(projectPath);
    expect(existsSync(projectPath)).toBe(true);

    const renamed = projectService.renameProject({ projectId: created.project.id, name: "新名" });
    expect(renamed.name).toBe("新名");
    expect(projectService.listRecentProjects().map((entry) => entry.project.name)).toEqual(["新名"]);
    const projectDb = createDatabase(projectPath);
    runMigrations(projectDb);
    expect(new ProjectRepository(projectDb).findById(created.project.id)?.name).toBe("新名");
    projectDb.close();

    projectService.deleteProject({ projectId: created.project.id });
    expect(existsSync(projectPath)).toBe(false);
    expect(projectService.listRecentProjects()).toEqual([]);
    expect(() => projectService.openProject({ projectId: created.project.id })).toThrow("Project not found");

    db.close();
  });

  it("does not recreate a missing project file when opening from a recent project path", () => {
    const { db, dir, projectService } = createProjectFileServices();
    const projectPath = join(dir, "缺失.noveltool");
    const created = projectService.createProject({ name: "缺失", rootPath: projectPath });
    projectService.close();
    unlinkSync(projectPath);

    expect(() => projectService.openProjectFile({ filePath: created.project.rootPath! })).toThrow("项目文件不存在");
    expect(existsSync(projectPath)).toBe(false);

    db.close();
  });
});
