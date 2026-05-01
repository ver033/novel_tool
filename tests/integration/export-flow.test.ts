import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { ScratchNoteRepository } from "../../src/main/db/repositories/scratch-note-repo";
import { TxtExporter } from "../../src/main/export/txt-exporter";
import { ProjectService } from "../../src/main/project/project-service";
import { countWritingUnits } from "../../src/main/shared/text";

const tempDirs: string[] = [];

function createExporter() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-export-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const projectRepo = new ProjectRepository(db);
  const projectService = new ProjectService(projectRepo, {
    projectFileDirectory: join(dir, "projects")
  });

  return {
    db,
    dir,
    projectService,
    exporter: new TxtExporter((projectId) => new ChapterRepository(projectService.getProjectDatabaseForProject(projectId))),
    scratchRepoForProject: (projectId: string) => new ScratchNoteRepository(projectService.getProjectDatabaseForProject(projectId))
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("TXT export flow", () => {
  it("exports the current project chapters to TXT without scratchpad notes", () => {
    const { db, dir, projectService, exporter, scratchRepoForProject } = createExporter();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });
    const chapterRepo = new ChapterRepository(projectService.getProjectDatabaseForProject(project.id));
    const secondChapter = chapterRepo.create({
      id: "chapter_second",
      projectId: project.id,
      title: "第2章 夜行",
      volumeTitle: "第一卷",
      sortOrder: 1,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "夜色落下。" }] }] },
      plainText: "夜色落下。",
      wordCount: countWritingUnits("夜色落下。"),
      dailyWordCount: 0,
      dailyWordCountDate: null,
      targetWordCount: null,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    chapterRepo.saveContent(
      initialChapter.id,
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "林远回来了。" }] }] },
      "林远回来了。",
      countWritingUnits("林远回来了。"),
      0,
      new Date().toISOString().slice(0, 10),
      new Date().toISOString()
    );
    scratchRepoForProject(project.id).create({
      projectId: project.id,
      chapterId: initialChapter.id,
      content: "这条草稿纸不能出现在正文导出里。",
      pinned: true,
      sourceTaskId: null
    });

    const filePath = join(dir, "归途.txt");
    const result = exporter.exportTxt({
      projectId: project.id,
      filePath,
      range: "all_chapters",
      includeChapterTitles: true
    });

    expect(result).toMatchObject({
      filePath,
      chapterCount: 2,
      wordCount: countWritingUnits("林远回来了。") + secondChapter.wordCount
    });
    expect(readFileSync(filePath, "utf8")).toBe("第1章\n\n林远回来了。\n\n第2章 夜行\n\n夜色落下。\n");
    expect(readFileSync(filePath, "utf8")).not.toContain("草稿纸");

    db.close();
  });

  it("rejects empty projects in the exporter even when IPC is called directly", () => {
    const { db, dir, projectService, exporter } = createExporter();
    const { project, initialChapter } = projectService.createProject({ name: "空项目" });
    const chapterRepo = new ChapterRepository(projectService.getProjectDatabaseForProject(project.id));
    chapterRepo.delete(initialChapter.id);

    expect(() =>
      exporter.exportTxt({
        projectId: project.id,
        filePath: join(dir, "空项目.txt"),
        range: "all_chapters",
        includeChapterTitles: true
      })
    ).toThrow("没有可导出的章节");

    db.close();
  });
});
