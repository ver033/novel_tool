import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ProjectService } from "../../src/main/project/project-service";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-project-create-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project creation flow", () => {
  it("creates a visible project file and applies the requested chapter target to the first chapter", () => {
    const dir = createTempDir();
    const mainDb = createDatabase(join(dir, "main.sqlite3"));
    runMigrations(mainDb);
    const service = new ProjectService(new ProjectRepository(mainDb), {
      projectFileDirectory: () => join(dir, "projects")
    });

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
    const service = new ProjectService(new ProjectRepository(mainDb), {
      projectFileDirectory: () => join(dir, "projects")
    });

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
    const service = new ProjectService(new ProjectRepository(mainDb), {
      projectFileDirectory: () => join(dir, "projects")
    });
    const first = service.createProject({ name: "星河旧梦" });

    expect(() =>
      service.createProject({
        name: "星河旧梦",
        rootPath: first.project.rootPath ?? undefined
      })
    ).toThrow("项目文件已存在");

    mainDb.close();
  });
});
