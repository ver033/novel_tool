import path from "node:path";
import { SummaryService } from "../ai/summary-service";
import { ChapterRepository } from "../db/repositories/chapter-repo";
import { ImportJobRepository } from "../db/repositories/import-job-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { SummaryRepository } from "../db/repositories/summary-repo";
import type { ProjectService } from "../project/project-service";
import { createId } from "../shared/ids";
import { countWritingUnits } from "../shared/text";
import type {
  ChapterContent,
  ChapterSummary,
  ImportConfirmResult,
  ImportConfirmTxtInput,
  ImportPreview,
  ImportPreviewChapter,
  ImportPreviewTxtInput,
  ImportUpdatePreviewInput,
  ProjectRecord
} from "../shared/types";
import {
  openProjectDatabase,
  readProjectRecordFromDatabaseOrNull,
  resolveImportedProjectFilePath,
  writeProjectSource
} from "../project/project-file";
import { applyImportPreviewOperations, detectTxtChapters } from "./chapter-detector";
import { readTxtFile } from "./txt-reader";

function nowIso(): string {
  return new Date().toISOString();
}

function createTiptapDocumentFromPlainText(text: string): unknown {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return {
    type: "doc",
    content: (paragraphs.length > 0 ? paragraphs : [""]).map((paragraph) => ({
      type: "paragraph",
      attrs: {
        paragraphId: createId("paragraph")
      },
      content: paragraph ? [{ type: "text", text: paragraph }] : undefined
    }))
  };
}

function chapterContentFromPreview(projectId: string, preview: ImportPreviewChapter, sortOrder: number): ChapterContent {
  const createdAt = nowIso();
  return {
    id: createId("chapter"),
    projectId,
    title: preview.title,
    volumeTitle: "第一卷",
    sortOrder,
    contentJson: createTiptapDocumentFromPlainText(preview.text),
    plainText: preview.text,
    wordCount: preview.wordCount,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt,
    updatedAt: createdAt
  };
}

export class TxtImporter {
  constructor(
    private readonly importJobRepo: ImportJobRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly projectService?: ProjectService
  ) {}

  previewTxt(input: ImportPreviewTxtInput): ImportPreview {
    const filePath = path.resolve(input.filePath);
    const read = readTxtFile(filePath);
    const chapters = detectTxtChapters(read.text);
    return this.importJobRepo.createPreview({
      filePath,
      fileName: path.basename(filePath),
      encoding: read.encoding,
      rawText: read.text,
      totalWordCount: countWritingUnits(read.text),
      chapters
    });
  }

  updatePreview(input: ImportUpdatePreviewInput): ImportPreview {
    const preview = this.importJobRepo.getPreview(input.importJobId);
    if (input.operations.length > 1) {
      throw new Error("章节调整请一次提交一个操作。");
    }
    const redetectCount = input.operations.filter((operation) => operation.type === "redetect").length;
    const chapters =
      redetectCount > 0 ? detectTxtChapters(this.importJobRepo.getRawText(input.importJobId)) : applyImportPreviewOperations(preview.chapters, input.operations);
    return this.importJobRepo.updatePreview(input.importJobId, chapters);
  }

  confirmTxtImport(input: ImportConfirmTxtInput): ImportConfirmResult {
    const preview = this.importJobRepo.getConfirmablePreview(input.importJobId);
    const projectName = input.projectName ?? path.basename(preview.fileName, path.extname(preview.fileName));
    const projectFilePath = resolveImportedProjectFilePath(preview.filePath, projectName);
    this.importJobRepo.markWriting(input.importJobId);

    const result =
      input.mode === "create_new_project"
        ? this.confirmNewProjectImport(input.importJobId, projectName, projectFilePath, preview)
        : this.confirmCurrentProjectImport(input.importJobId, input.projectId, preview);

    if (result.project.rootPath) {
      this.projectService?.openProjectFile({ filePath: result.project.rootPath });
    }

    return result;
  }

  private findExistingProject(projectId: string | undefined): ProjectRecord {
    if (!projectId) {
      throw new Error("projectId is required when importing into current project");
    }

    const project = this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    return project;
  }

  private confirmNewProjectImport(
    importJobId: string,
    projectName: string,
    projectFilePath: string,
    preview: ImportPreview
  ): ImportConfirmResult {
    const projectDb = openProjectDatabase(projectFilePath);
    try {
      const projectRepo = new ProjectRepository(projectDb);
      const chapterRepo = new ChapterRepository(projectDb);
      const summaryService = new SummaryService(new SummaryRepository(projectDb), chapterRepo);
      const existingProject = readProjectRecordFromDatabaseOrNull(projectDb);
      const result = projectRepo.transact(() => {
        const createdAt = nowIso();
        const project =
          existingProject ??
          projectRepo.create({
            id: createId("project"),
            name: projectName,
            rootPath: projectFilePath,
            createdAt,
            updatedAt: createdAt
          });
        if (project.rootPath !== projectFilePath) {
          projectRepo.updateRootPath(project.id, projectFilePath, createdAt);
        }

        const existingChapters = chapterRepo.listByProject(project.id);
        const chapters =
          existingChapters.length > 0
            ? existingChapters
            : preview.chapters.map((chapter, index) => chapterRepo.create(chapterContentFromPreview(project.id, chapter, index)));
        writeProjectSource(projectDb, { type: "txt", path: preview.filePath }, nowIso());
        const enqueuedAt = nowIso();
        for (const chapter of chapters) {
          summaryService.maybeEnqueueChapterSummary({
            projectId: project.id,
            chapterId: chapter.id,
            trigger: "import",
            now: enqueuedAt
          });
        }
        return {
          project: projectRepo.findById(project.id) ?? project,
          chapters,
          firstChapterId: chapters[0]?.id ?? null
        };
      });

      this.completeImport(importJobId, result.project);
      return {
        ...result,
        project: this.projectRepo.findById(result.project.id) ?? result.project
      };
    } finally {
      projectDb.close();
    }
  }

  private confirmCurrentProjectImport(
    importJobId: string,
    projectId: string | undefined,
    preview: ImportPreview
  ): ImportConfirmResult {
    const project = this.findExistingProject(projectId);
    if (!project.rootPath) {
      throw new Error("当前项目未绑定 .noveltool 文件，无法导入。");
    }

    const projectDb = this.projectService?.getProjectDatabaseForProject(project.id) ?? openProjectDatabase(project.rootPath);
    const shouldCloseProjectDb = !this.projectService;
    try {
      const chapterRepo = new ChapterRepository(projectDb);
      const summaryService = new SummaryService(new SummaryRepository(projectDb), chapterRepo);
      return chapterRepo.transact(() => {
        const startOrder = chapterRepo.nextSortOrder(project.id);
        const chapters = preview.chapters.map((chapter, index) => chapterRepo.create(chapterContentFromPreview(project.id, chapter, startOrder + index)));
        const enqueuedAt = nowIso();
        for (const chapter of chapters) {
          summaryService.maybeEnqueueChapterSummary({
            projectId: project.id,
            chapterId: chapter.id,
            trigger: "import",
            now: enqueuedAt
          });
        }
        this.completeImport(importJobId, project);
        return {
          project: this.projectRepo.findById(project.id) ?? project,
          chapters,
          firstChapterId: chapters[0]?.id ?? null
        };
      });
    } finally {
      if (shouldCloseProjectDb) {
        projectDb.close();
      }
    }
  }

  private completeImport(importJobId: string, project: ProjectRecord): void {
    const openedAt = nowIso();
    this.projectRepo.transact(() => {
      this.projectRepo.upsert({
        ...project,
        updatedAt: openedAt
      });
      this.projectRepo.setCurrentProject(project.id, openedAt);
      this.importJobRepo.markCompleted(importJobId, project.id);
    });
  }
}
