import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/main/db/database";
import { runMigrations } from "../../src/main/db/migrations";
import { ChapterRepository } from "../../src/main/db/repositories/chapter-repo";
import { ProjectRepository } from "../../src/main/db/repositories/project-repo";
import { SummaryRepository } from "../../src/main/db/repositories/summary-repo";
import { ChapterService } from "../../src/main/chapter/chapter-service";
import { ProjectService } from "../../src/main/project/project-service";
import { computeChapterContentHash, type ChapterAiSummaryPayload } from "../../src/main/shared/summary-index";
import { chapterIndexPayloadV2 } from "../helpers/summary-index-fixtures";

const tempDirs: string[] = [];
const projectServices: ProjectService[] = [];

function trackProjectService(projectService: ProjectService): ProjectService {
  projectServices.push(projectService);
  return projectService;
}

function createServices() {
  const dir = mkdtempSync(join(tmpdir(), "novel-tool-project-flow-"));
  tempDirs.push(dir);
  const db = createDatabase(join(dir, "novel-tool.sqlite3"));
  runMigrations(db);

  const projectRepo = new ProjectRepository(db);
  const projectService = trackProjectService(
    new ProjectService(projectRepo, {
      projectFileDirectory: join(dir, "projects")
    })
  );

  return {
    db,
    dir,
    chapterService: new ChapterService((projectId) =>
      new ChapterRepository(projectId ? projectService.getProjectDatabaseForProject(projectId) : projectService.getActiveProjectDatabase())
    ),
    projectService
  };
}

function recentProjectIds(projectService: ProjectService): string[] {
  return projectService.listRecentProjects().map((entry) => entry.project.id);
}

function chapterSummaryPayload(): ChapterAiSummaryPayload {
  return chapterIndexPayloadV2({
    oneLine: "旧正文摘要。",
    synopsis: "旧正文的摘要内容。",
    detail: "旧正文的摘要内容用于测试章节修改后摘要缓存会被正确标记过期，并保留中文章节事实索引结构，避免继续依赖旧摘要格式。"
  });
}

afterEach(() => {
  for (const projectService of projectServices.splice(0)) {
    projectService.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project and chapter lifecycle", () => {
  it("registers project and chapter ipc handlers from the central ipc entrypoint", () => {
    const registerIpc = readFileSync(join(process.cwd(), "src/main/ipc/register-ipc.ts"), "utf8");

    expect(registerIpc).toContain("registerProjectIpc");
    expect(registerIpc).toContain("registerChapterIpc");
    expect(registerIpc).toContain("projectService.getRuntimeActiveProject()");
  });

  it("registers settings ipc handlers from the central ipc entrypoint", () => {
    const registerIpc = readFileSync(join(process.cwd(), "src/main/ipc/register-ipc.ts"), "utf8");
    const settingsPage = readFileSync(join(process.cwd(), "src/renderer/routes/SettingsPage.tsx"), "utf8");
    const settingsIpc = readFileSync(join(process.cwd(), "src/main/ipc/settings-ipc.ts"), "utf8");
    const preloadApi = readFileSync(join(process.cwd(), "src/preload/api.ts"), "utf8");

    expect(registerIpc).toContain("registerSettingsIpc");
    expect(registerIpc).toContain("SettingsService");
    expect(settingsPage).toContain("api.settings.get");
    expect(settingsPage).toContain("api.settings.save");
    expect(settingsPage).toContain("api.settings.testConnection");
    expect(settingsPage).toContain("api.settings.listModels");
    expect(settingsPage).toMatch(/const saveSettings = async \(\) => \{[\s\S]*api\.settings\.save\(buildSaveInput\(formToSave\)\)/);
    expect(settingsPage).toMatch(/const testConnection = async \(\) => \{[\s\S]*api\.settings\.testConnection[\s\S]*api\.settings\.listModels/);
    expect(settingsPage).not.toMatch(/const testConnection = async \(\) => \{[\s\S]*api\.settings\.save\(buildSaveInput\(form\)\)/);
    expect(settingsPage).toContain("model-suggestion-list");
    expect(settingsPage).toContain("selectModel(model.id)");
    expect(settingsIpc).toContain("settingsService.listOpenRouterModels");
    expect(preloadApi).toContain("listModels");
  });

  it("creates a local project with an initial empty chapter and stores it as current", () => {
    const { db, projectService, chapterService } = createServices();

    const created = projectService.createProject({ name: "归途" });

    expect(created.project).toMatchObject({ name: "归途" });
    expect(created.project.rootPath?.endsWith("归途.noveltool")).toBe(true);
    expect(created.initialChapter).toMatchObject({
      projectId: created.project.id,
      title: "第1章"
    });
    expect(projectService.getCurrentProject()).toMatchObject({ id: created.project.id, name: "归途" });
    expect(chapterService.listChapters({ projectId: created.project.id })).toEqual([created.initialChapter]);

    db.close();
  });

  it("persists recent projects and current project across service recreation", () => {
    const { db, dir, projectService } = createServices();

    const first = projectService.createProject({ name: "第一部" });
    const second = projectService.createProject({ name: "第二部" });
    const reopenedProjectService = trackProjectService(
      new ProjectService(new ProjectRepository(db), {
        projectFileDirectory: join(dir, "projects")
      })
    );

    expect(reopenedProjectService.getCurrentProject()).toMatchObject({ id: second.project.id, name: "第二部" });
    expect(recentProjectIds(reopenedProjectService)).toEqual([second.project.id, first.project.id]);

    db.close();
  });

  it("keeps persisted current project separate from the runtime opened project", () => {
    const { db, dir, projectService } = createServices();

    const created = projectService.createProject({ name: "第一部" });
    expect(projectService.getCurrentProject()).toMatchObject({ id: created.project.id });
    expect(projectService.getRuntimeActiveProject()).toMatchObject({ id: created.project.id });

    projectService.close();
    expect(projectService.getCurrentProject()).toMatchObject({ id: created.project.id });
    expect(projectService.getRuntimeActiveProject()).toBeNull();

    const reopenedProjectService = trackProjectService(
      new ProjectService(new ProjectRepository(db), {
        projectFileDirectory: join(dir, "projects")
      })
    );

    expect(reopenedProjectService.getCurrentProject()).toMatchObject({ id: created.project.id });
    expect(reopenedProjectService.getRuntimeActiveProject()).toBeNull();

    reopenedProjectService.openProject({ projectId: created.project.id });
    expect(reopenedProjectService.getRuntimeActiveProject()).toMatchObject({ id: created.project.id });

    db.close();
  });

  it("creates unique project files when the default project name already exists", () => {
    const { db, projectService } = createServices();

    const first = projectService.createProject({ name: "我的小说" });
    const second = projectService.createProject({ name: "我的小说" });

    expect(first.project.rootPath?.endsWith("我的小说.noveltool")).toBe(true);
    expect(second.project.rootPath?.endsWith("我的小说-2.noveltool")).toBe(true);
    expect(recentProjectIds(projectService)).toEqual([second.project.id, first.project.id]);

    db.close();
  });

  it("uses the configured project directory when creating a project without an explicit path", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-tool-configured-project-dir-"));
    tempDirs.push(dir);
    const db = createDatabase(join(dir, "novel-tool.sqlite3"));
    runMigrations(db);
    const configuredDirectory = join(dir, "configured-projects");
    const projectService = trackProjectService(
      new ProjectService(new ProjectRepository(db), {
        projectFileDirectory: () => configuredDirectory
      })
    );

    const created = projectService.createProject({ name: "归途" });

    expect(created.project.rootPath).toBe(join(configuredDirectory, "归途.noveltool"));

    db.close();
  });

  it("keeps distinct project files in recent projects even when display names match", () => {
    const { db, dir, projectService } = createServices();

    const oldImported = projectService.createProject({ name: "test", rootPath: join(dir, "test-old.noveltool") });
    const latestImported = projectService.createProject({ name: "test", rootPath: join(dir, "test-latest.noveltool") });
    const oldUntitled = projectService.createProject({ name: "我的小说", rootPath: join(dir, "untitled-old.noveltool") });
    const latestUntitled = projectService.createProject({ name: "我的小说", rootPath: join(dir, "untitled-latest.noveltool") });

    expect(recentProjectIds(projectService)).toEqual([
      latestUntitled.project.id,
      oldUntitled.project.id,
      latestImported.project.id,
      oldImported.project.id
    ]);

    db.close();
  });

  it("hides legacy no-file recent rows when a same-name project file exists", () => {
    const { db, dir, projectService } = createServices();
    const createdAt = new Date().toISOString();
    const legacyImported = new ProjectRepository(db).create({
      id: "project_legacy_test",
      name: "test",
      rootPath: null,
      createdAt,
      updatedAt: createdAt
    });

    const projectFileImported = projectService.createProject({ name: "test", rootPath: join(dir, "test-latest.noveltool") });

    expect(recentProjectIds(projectService)).toEqual([projectFileImported.project.id]);
    expect(recentProjectIds(projectService)).not.toContain(legacyImported.id);

    db.close();
  });

  it("keeps unopenable app-only and missing-file recent rows with availability state", () => {
    const { db, dir, projectService } = createServices();
    const projectRepo = new ProjectRepository(db);
    const createdAt = new Date().toISOString();
    const validProject = projectService.createProject({ name: "新项目", rootPath: join(dir, "新项目.noveltool") });
    const appOnlyProject = projectRepo.create({
      id: "project_app_only",
      name: "manual_novel_test",
      rootPath: null,
      createdAt,
      updatedAt: new Date(Date.now() + 1000).toISOString()
    });
    const missingFileProject = projectRepo.create({
      id: "project_missing_file",
      name: "已删除项目",
      rootPath: join(dir, "missing.noveltool"),
      createdAt,
      updatedAt: new Date(Date.now() + 2000).toISOString()
    });

    expect(recentProjectIds(projectService)).toEqual([missingFileProject.id, appOnlyProject.id, validProject.project.id]);
    expect(projectService.listRecentProjects().map((entry) => [entry.project.id, entry.availability])).toEqual([
      [missingFileProject.id, "missing"],
      [appOnlyProject.id, "invalid_path"],
      [validProject.project.id, "available"]
    ]);
    expect(projectRepo.findById(appOnlyProject.id)).not.toBeNull();
    expect(projectRepo.findById(missingFileProject.id)).not.toBeNull();

    db.close();
  });

  it("creates, renames, reads, saves, snapshots, and deletes chapters", () => {
    const { db, projectService, chapterService } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });

    const secondChapter = chapterService.createChapter({
      projectId: project.id,
      title: "第2章 回家"
    });
    chapterService.renameChapter({ chapterId: secondChapter.id, title: "第2章 晚饭" });
    chapterService.saveContent({
      chapterId: secondChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "母亲停下筷子。" }] }] },
      plainText: "母亲停下筷子。",
      wordCount: 7
    });
    const snapshot = chapterService.createSnapshot({ chapterId: secondChapter.id, reason: "manual_snapshot" });

    expect(chapterService.getContent({ chapterId: secondChapter.id })).toMatchObject({
      id: secondChapter.id,
      title: "第2章 晚饭",
      plainText: "母亲停下筷子。",
      wordCount: 7
    });
    expect(snapshot).toMatchObject({
      chapterId: secondChapter.id,
      reason: "manual_snapshot",
      plainText: "母亲停下筷子。"
    });

    chapterService.deleteChapter({ chapterId: initialChapter.id });
    expect(chapterService.listChapters({ projectId: project.id }).map((chapter) => chapter.id)).toEqual([secondChapter.id]);

    db.close();
  });

  it("keeps saved chapter content after service recreation", () => {
    const { db, dir, projectService, chapterService } = createServices();
    const { initialChapter } = projectService.createProject({ name: "归途" });

    chapterService.saveContent({
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "林远回来了。" }] }] },
      plainText: "林远回来了。",
      wordCount: 5
    });

    const reopenedProjectService = trackProjectService(
      new ProjectService(new ProjectRepository(db), {
        projectFileDirectory: join(dir, "projects")
      })
    );
    const reopenedChapterService = new ChapterService((projectId) =>
      new ChapterRepository(projectId ? reopenedProjectService.getProjectDatabaseForProject(projectId) : reopenedProjectService.getActiveProjectDatabase())
    );
    expect(reopenedChapterService.getContent({ chapterId: initialChapter.id })).toMatchObject({
      id: initialChapter.id,
      plainText: "林远回来了。",
      wordCount: 5
    });

    db.close();
  });

  it("rejects stale chapter content saves at the repository boundary", () => {
    const { db, projectService } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });
    const chapterRepo = new ChapterRepository(projectService.getProjectDatabaseForProject(project.id));
    const original = chapterRepo.getContent(initialChapter.id);
    expect(original).not.toBeNull();

    chapterRepo.saveContent(
      initialChapter.id,
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "第一版。" }] }] },
      "第一版。",
      4,
      4,
      "2026-05-01",
      "2026-05-01T00:00:01.000Z",
      original!.updatedAt
    );

    expect(() =>
      chapterRepo.saveContent(
        initialChapter.id,
        { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "过期保存。" }] }] },
        "过期保存。",
        5,
        5,
        "2026-05-01",
        "2026-05-01T00:00:02.000Z",
        original!.updatedAt
      )
    ).toThrow("章节内容已被其他操作更新");
    expect(chapterRepo.getContent(initialChapter.id)?.plainText).toBe("第一版。");

    db.close();
  });

  it("marks an existing chapter summary stale after saved chapter text changes without running AI", () => {
    const { db, projectService } = createServices();
    const { project, initialChapter } = projectService.createProject({ name: "归途" });
    const projectDb = projectService.getProjectDatabaseForProject(project.id);
    const summaryRepo = new SummaryRepository(projectDb);
    const invalidationCalls: Array<{ readonly previousPlainText: string; readonly nextPlainText: string }> = [];
    const chapterService = new ChapterService(
      (projectId) => new ChapterRepository(projectId ? projectService.getProjectDatabaseForProject(projectId) : projectService.getActiveProjectDatabase()),
      {
        summaryIndexInvalidator: {
          markChapterContentChanged(input) {
            invalidationCalls.push({
              previousPlainText: input.previousPlainText,
              nextPlainText: input.nextPlainText
            });
            summaryRepo.markChapterStale(input.projectId, input.chapterId, computeChapterContentHash(input.nextPlainText), input.updatedAt);
          }
        }
      }
    );

    chapterService.saveContent({
      projectId: project.id,
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "旧正文。" }] }] },
      plainText: "旧正文。"
    });
    summaryRepo.upsertChapterSummary({
      id: "summary_1",
      projectId: project.id,
      chapterId: initialChapter.id,
      chapterTitle: initialChapter.title,
      chapterOrder: 1,
      contentHash: computeChapterContentHash("旧正文。"),
      summaryShort: "旧正文摘要。",
      summaryLong: "旧正文的摘要内容。",
      structured: chapterSummaryPayload(),
      tokenCount: 32,
      status: "ready",
      error: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    invalidationCalls.splice(0);

    chapterService.saveContent({
      projectId: project.id,
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "新正文。" }] }] },
      plainText: "新正文。"
    });

    expect(invalidationCalls).toEqual([{ previousPlainText: "旧正文。", nextPlainText: "新正文。" }]);
    expect(summaryRepo.getChapterSummary(project.id, initialChapter.id)).toMatchObject({
      status: "stale",
      contentHash: computeChapterContentHash("新正文。"),
      error: null
    });

    db.close();
  });

  it("uses the shared writing-unit counter when word count is omitted", () => {
    const { db, projectService, chapterService } = createServices();
    const { initialChapter } = projectService.createProject({ name: "归途" });

    chapterService.saveContent({
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "母亲停下筷子。He said ok." }] }] },
      plainText: "母亲停下筷子。He said ok."
    });

    expect(chapterService.getContent({ chapterId: initialChapter.id }).wordCount).toBe(14);

    db.close();
  });

  it("tracks today's writing increase from saved chapter content", () => {
    const { db, projectService, chapterService } = createServices();
    const { initialChapter } = projectService.createProject({ name: "归途" });

    const firstSave = chapterService.saveContent({
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "林远回来了。" }] }] },
      plainText: "林远回来了。",
      wordCount: 5
    });
    const secondSave = chapterService.saveContent({
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "林远终于回来了。" }] }] },
      plainText: "林远终于回来了。",
      wordCount: 7
    });
    const deletionSave = chapterService.saveContent({
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "林远回来。" }] }] },
      plainText: "林远回来。",
      wordCount: 4
    });
    const undoSave = chapterService.saveContent({
      chapterId: initialChapter.id,
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      plainText: "",
      wordCount: 0
    });

    expect(firstSave.dailyWordCount).toBe(5);
    expect(secondSave.dailyWordCount).toBe(7);
    expect(deletionSave.dailyWordCount).toBe(4);
    expect(undoSave.dailyWordCount).toBe(0);

    db.close();
  });

  it("persists editable chapter target word count", () => {
    const { db, projectService, chapterService } = createServices();
    const { initialChapter } = projectService.createProject({ name: "归途" });

    const updated = chapterService.updateTargetWordCount({
      chapterId: initialChapter.id,
      targetWordCount: 2500
    });

    expect(updated.targetWordCount).toBe(2500);
    expect(chapterService.getContent({ chapterId: initialChapter.id }).targetWordCount).toBe(2500);

    db.close();
  });
});
