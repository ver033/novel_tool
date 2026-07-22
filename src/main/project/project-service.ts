import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { emptyChapterContent } from "../chapter/default-content";
import type { SqliteDatabase } from "../db/database";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { runMigrations } from "../db/migrations";
import { createId } from "../shared/ids";
import type {
  ChapterSummary,
  ProjectCreateInput,
  ProjectDeleteInput,
  ProjectOpenFileInput,
  ProjectOpenInput,
  ProjectRecord,
  ProjectRenameInput,
  RecentProjectAvailability,
  RecentProjectEntry
} from "../shared/types";
import { DEFAULT_CONTENT_LANGUAGE, initialChapterTitle, initialVolumeTitle } from "../shared/language";
import {
  isNovelToolProjectFile,
  openExistingProjectDatabase,
  openProjectDatabase,
  readProjectRecordFromDatabase,
  resolveAvailableProjectFilePath
} from "./project-file";

type CreatedProject = {
  readonly project: ProjectRecord;
  readonly initialChapter: ChapterSummary;
};

type OpenedProject = {
  readonly project: ProjectRecord;
  readonly chapters: readonly ChapterSummary[];
};

type ProjectServiceOptions = {
  readonly projectFileDirectory?: string | (() => string);
  readonly onActiveProjectDatabaseClosed?: (projectId: string) => void;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class ProjectService {
  private activeProjectDb: SqliteDatabase | null = null;
  private activeProjectFilePath: string | null = null;
  private activeProjectId: string | null = null;

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly options: ProjectServiceOptions = {}
  ) {}

  createProject(input: ProjectCreateInput): CreatedProject {
    const projectFilePath = this.resolveNewProjectFilePath(input);
    if (existsSync(projectFilePath)) {
      throw new Error("项目文件已存在，请选择新的文件名或打开已有项目。");
    }
    const projectDb = openProjectDatabase(projectFilePath);
    const projectRepo = new ProjectRepository(projectDb);
    const chapterRepo = new ChapterRepository(projectDb);

    const created = projectRepo.transact(() => {
      const existingProject = projectRepo.findByRootPath(projectFilePath);
      if (existingProject) {
        throw new Error("项目文件中已存在项目记录。");
      }

      const createdAt = nowIso();
      const contentLanguage = input.contentLanguage ?? DEFAULT_CONTENT_LANGUAGE;
      const project = projectRepo.create({
        id: createId("project"),
        name: input.name,
        rootPath: projectFilePath,
        contentLanguage,
        createdAt,
        updatedAt: createdAt
      });
      const initialChapter = chapterRepo.create({
        id: createId("chapter"),
        projectId: project.id,
        title: initialChapterTitle(contentLanguage),
        volumeTitle: initialVolumeTitle(contentLanguage),
        sortOrder: 0,
        contentJson: emptyChapterContent,
        plainText: "",
        wordCount: 0,
        dailyWordCount: 0,
        dailyWordCountDate: null,
        targetWordCount: input.targetWordCount ?? null,
        status: "draft",
        createdAt,
        updatedAt: createdAt
      });

      return { project, initialChapter };
    });

    this.registerRecentProject(created.project, nowIso());
    this.replaceActiveProject(projectDb, projectFilePath, created.project.id);
    return created;
  }

  openProject(input: ProjectOpenInput): OpenedProject {
    const project = input.projectId
      ? this.projectRepo.findById(input.projectId)
      : input.rootPath
        ? this.projectRepo.findByRootPath(path.resolve(input.rootPath))
        : null;

    if (!project) {
      throw new Error("Project not found");
    }
    if (!project.rootPath) {
      throw new Error("项目未绑定 .noveltool 文件，无法打开。");
    }

    return this.openProjectFile({ filePath: project.rootPath });
  }

  openProjectFile(input: ProjectOpenFileInput): OpenedProject {
    const filePath = path.resolve(input.filePath);
    if (!isNovelToolProjectFile(filePath)) {
      throw new Error("墨枢项目文件必须使用 .noveltool 扩展名。");
    }
    if (!existsSync(filePath)) {
      throw new Error(`项目文件不存在：${filePath}`);
    }

    const projectDb = this.activeProjectDb && this.activeProjectFilePath === filePath ? this.activeProjectDb : openExistingProjectDatabase(filePath);
    runMigrations(projectDb);
    const fileProject = readProjectRecordFromDatabase(projectDb);
    const projectRepo = new ProjectRepository(projectDb);
    const updatedAt = nowIso();
    if (fileProject.rootPath !== filePath) {
      projectRepo.updateRootPath(fileProject.id, filePath, updatedAt);
    }

    const project = {
      ...(projectRepo.findById(fileProject.id) ?? fileProject),
      rootPath: filePath,
      updatedAt
    };
    this.registerRecentProject(project, updatedAt);
    this.replaceActiveProject(projectDb, filePath, project.id);

    return {
      project: this.projectRepo.findById(project.id) ?? project,
      chapters: new ChapterRepository(projectDb).listByProject(project.id)
    };
  }

  renameProject(input: ProjectRenameInput): ProjectRecord {
    const project = this.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (!project.rootPath) {
      throw new Error("项目未绑定 .noveltool 文件，无法重命名。");
    }

    const updatedAt = nowIso();
    const projectDb = this.getProjectDatabaseForProject(project.id);
    const renamed = new ProjectRepository(projectDb).rename(project.id, input.name, updatedAt);
    return this.projectRepo.upsert({
      ...renamed,
      rootPath: project.rootPath,
      updatedAt
    });
  }

  deleteProject(input: ProjectDeleteInput): void {
    const project = this.projectRepo.findById(input.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (project.rootPath && isNovelToolProjectFile(project.rootPath) && existsSync(project.rootPath)) {
      if (this.activeProjectFilePath === project.rootPath) {
        this.closeActiveProjectDatabase();
      }
      unlinkSync(project.rootPath);
    }
    this.projectRepo.transact(() => {
      this.projectRepo.clearCurrentProject(project.id);
      this.projectRepo.delete(project.id);
    });
  }

  getCurrentProject(): ProjectRecord | null {
    const currentProjectId = this.projectRepo.getCurrentProjectId();
    return currentProjectId ? this.projectRepo.findById(currentProjectId) : null;
  }

  getRuntimeActiveProject(): ProjectRecord | null {
    return this.activeProjectId ? this.projectRepo.findById(this.activeProjectId) : null;
  }

  listRecentProjects(): RecentProjectEntry[] {
    const recentProjects: RecentProjectEntry[] = [];
    for (const project of this.projectRepo.listRecent(100)) {
      const availability = getRecentProjectAvailability(project);
      recentProjects.push({ project, availability });
      if (recentProjects.length >= 10) {
        break;
      }
    }
    return recentProjects;
  }

  getSuggestedProjectFilePath(projectName: string): string {
    const projectFileDirectory = this.resolveProjectFileDirectory();
    if (!projectFileDirectory) {
      throw new Error("创建项目需要 .noveltool 文件路径。");
    }
    return resolveAvailableProjectFilePath(projectFileDirectory, projectName);
  }

  getProjectDatabaseForProject(projectId: string): SqliteDatabase {
    if (this.activeProjectDb && this.activeProjectId === projectId) {
      runMigrations(this.activeProjectDb);
      return this.activeProjectDb;
    }

    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error("项目未绑定 .noveltool 文件，无法访问项目数据。");
    }

    const opened = this.openProjectFile({ filePath: project.rootPath });
    if (opened.project.id !== projectId) {
      throw new Error("项目文件与最近项目记录不匹配。");
    }
    if (!this.activeProjectDb) {
      throw new Error("项目文件打开失败。");
    }
    runMigrations(this.activeProjectDb);
    return this.activeProjectDb;
  }

  getActiveProjectDatabase(): SqliteDatabase {
    if (!this.activeProjectDb) {
      const current = this.getCurrentProject();
      if (current?.rootPath) {
        this.openProjectFile({ filePath: current.rootPath });
      }
    }
    if (!this.activeProjectDb) {
      throw new Error("请先打开项目文件。");
    }
    runMigrations(this.activeProjectDb);
    return this.activeProjectDb;
  }

  close(): void {
    this.closeActiveProjectDatabase();
  }

  private registerRecentProject(project: ProjectRecord, updatedAt: string): void {
    this.projectRepo.upsert({
      ...project,
      updatedAt
    });
    this.projectRepo.setCurrentProject(project.id, updatedAt);
  }

  private replaceActiveProject(projectDb: SqliteDatabase, projectFilePath: string, projectId: string): void {
    if (this.activeProjectDb && this.activeProjectDb !== projectDb) {
      this.closeActiveProjectDatabase();
    }

    this.activeProjectDb = projectDb;
    this.activeProjectFilePath = projectFilePath;
    this.activeProjectId = projectId;
  }

  private closeActiveProjectDatabase(): void {
    if (!this.activeProjectDb) {
      return;
    }
    const closedProjectId = this.activeProjectId;
    this.activeProjectDb.close();
    this.activeProjectDb = null;
    this.activeProjectFilePath = null;
    this.activeProjectId = null;
    if (closedProjectId) {
      this.options.onActiveProjectDatabaseClosed?.(closedProjectId);
    }
  }

  private resolveNewProjectFilePath(input: ProjectCreateInput): string {
    const projectFileDirectory = this.resolveProjectFileDirectory();
    const filePath = input.rootPath
      ? path.resolve(input.rootPath)
      : projectFileDirectory
        ? resolveAvailableProjectFilePath(projectFileDirectory, input.name)
        : null;
    if (!filePath) {
      throw new Error("创建项目需要 .noveltool 文件路径。");
    }
    if (!isNovelToolProjectFile(filePath)) {
      throw new Error("墨枢项目文件必须使用 .noveltool 扩展名。");
    }
    return filePath;
  }

  private resolveProjectFileDirectory(): string | undefined {
    return typeof this.options.projectFileDirectory === "function" ? this.options.projectFileDirectory() : this.options.projectFileDirectory;
  }
}

function getRecentProjectAvailability(project: ProjectRecord): RecentProjectAvailability {
  if (!project.rootPath || !isNovelToolProjectFile(project.rootPath)) {
    return "invalid_path";
  }
  return existsSync(project.rootPath) ? "available" : "missing";
}
