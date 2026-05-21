import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ProjectService } from "../../src/main/project/project-service";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-project-create-"));
  tempDirs.push(dir);
  return dir;
}

function trackProjectService(projectService: ProjectService): ProjectService {
  projectServices.push(projectService);
  return projectService;
}

afterEach(() => {
  for (const projectService of projectServices.splice(0)) {
    projectService.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project creation flow", () => {
  it("creates a visible project file and applies the requested chapter target to the first chapter", () => {
    const dir = createTempDir();
    const mainDb = createDatabase(join(dir, "main.sqlite3"));
    runMigrations(mainDb);
    const service = trackProjectService(
      new ProjectService(new ProjectRepository(mainDb), {
        projectFileDirectory: () => join(dir, "projects")
      })
    );

    const created = service.createProject({
      name: "星河旧梦",
      targetWordCount: 3600
    });

    expect(created.project.name).toBe("星河旧梦");
    expect(created.project.rootPath).toBe(join(dir, "projects", "星河旧梦.noveltool"));
    expect(existsSync(created.project.rootPath ?? "")).toBe(true);
    expect(created.initialChapter.targetWordCount).toBe(3600);

    mainDb.close();
  });

  it("suggests numbered paths for same-name projects in the default project directory", () => {
    const dir = createTempDir();
    const mainDb = createDatabase(join(dir, "main.sqlite3"));
    runMigrations(mainDb);
    const service = trackProjectService(
      new ProjectService(new ProjectRepository(mainDb), {
        projectFileDirectory: () => join(dir, "projects")
      })
    );

    const first = service.createProject({ name: "星河旧梦" });
    const secondSuggestion = service.getSuggestedProjectFilePath("星河旧梦");
    const second = service.createProject({ name: "星河旧梦" });

    expect(first.project.rootPath).toBe(join(dir, "projects", "星河旧梦.noveltool"));
    expect(secondSuggestion).toBe(join(dir, "projects", "星河旧梦-2.noveltool"));
    expect(second.project.rootPath).toBe(join(dir, "projects", "星河旧梦-2.noveltool"));

    mainDb.close();
  });

  it("rejects manual creation into an existing project file instead of overwriting it", () => {
    const dir = createTempDir();
    const mainDb = createDatabase(join(dir, "main.sqlite3"));
    runMigrations(mainDb);
    const service = trackProjectService(
      new ProjectService(new ProjectRepository(mainDb), {
        projectFileDirectory: () => join(dir, "projects")
      })
    );
    const first = service.createProject({ name: "星河旧梦" });

    expect(() =>
      service.createProject({
        name: "星河旧梦",
        rootPath: first.project.rootPath ?? undefined
      })
    ).toThrow("项目文件已存在");

    mainDb.close();
  });

  it("closes the active project database handle before shutdown cleanup", () => {
    const dir = createTempDir();
    const mainDb = createDatabase(join(dir, "main.sqlite3"));
    runMigrations(mainDb);
    const service = trackProjectService(
      new ProjectService(new ProjectRepository(mainDb), {
        projectFileDirectory: () => join(dir, "projects")
      })
    );

    service.createProject({ name: "星河旧梦" });
    const activeDb = service.getActiveProjectDatabase();

    service.close();

    expect(() => activeDb.prepare("SELECT 1").get()).toThrow();
    mainDb.close();
  });

  it("repairs outline tables before reusing an already open project database", () => {
    const dir = createTempDir();
    const mainDb = createDatabase(join(dir, "main.sqlite3"));
    runMigrations(mainDb);
    const service = trackProjectService(
      new ProjectService(new ProjectRepository(mainDb), {
        projectFileDirectory: () => join(dir, "projects")
      })
    );
    const created = service.createProject({ name: "星河旧梦" });
    const activeDb = service.getActiveProjectDatabase();

    activeDb.exec(`
      DROP TABLE outline_chapter_notes;
      DROP TABLE outline_event_threads;
      DROP TABLE outline_events;
      DROP TABLE outline_threads;
    `);

    const projectDb = service.getProjectDatabaseForProject(created.project.id);

    expect(projectDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outline_threads'").get()).toEqual({
      name: "outline_threads"
    });
    mainDb.close();
  });
});
