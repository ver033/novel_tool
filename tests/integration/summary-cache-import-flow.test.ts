import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ImportJobRepository } from "../../src/main/db/repositories/import-job-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { TxtImporter } from "../../src/main/import/txt-importer";
import { ProjectService } from "../../src/main/project/project-service";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-summary-flow-"));
  tempDirs.push(dir);
  return dir;
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

describe("summary cache import integration", () => {
  it("queues only chapter summary jobs for imported chapters", () => {
    const { db, dir, importer, projectService } = createImporter();
    const created = projectService.createProject({
      name: "导入项目",
      rootPath: join(dir, "导入项目.noveltool")
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
    const jobs = summaryRepo.listSummaryJobs(created.project.id);

    expect(confirmed.chapters).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobType).toBe("chapter_summary");
    expect(jobs[0]?.targetId).toBe(confirmed.chapters[0]?.id);

    db.close();
  });
});
