import { ChapterRepository } from "../db/repositories/chapter-repo";
import { OutlineRepository, type OutlineEventCreateData } from "../db/repositories/outline-repo";
import { ProjectRepository } from "../db/repositories/project-repo";
import { assertSelectedOutlineImportFilePathAllowed } from "../security/file-access";
import { createId } from "../shared/ids";
import type {
  ChapterSummary,
  OutlineBulkImportPreview,
  OutlineBulkImportPreviewRow,
  OutlineChapterNoteRecord,
  OutlineConfirmBulkImportInput,
  OutlineCreateEventInput,
  OutlineCreateThreadInput,
  OutlineDeleteEventInput,
  OutlineDeleteThreadInput,
  OutlineEventRecord,
  OutlineGetChapterNoteInput,
  OutlineGetOverviewInput,
  OutlineImportLegacyChapterNoteInput,
  OutlineListEventsInput,
  OutlinePreviewBulkImportInput,
  OutlinePreviewImportFileInput,
  OutlineReorderEventsInput,
  OutlineSaveChapterNoteInput,
  OutlineThreadRecord,
  OutlineUndoImportBatchInput,
  OutlineUpdateEventInput,
  OutlineUpdateThreadInput,
  OutlineOverview
} from "../shared/types";
import { parseOutlineFile, parseOutlineText, type ParsedOutlineImportRow } from "./outline-import-parser";

function nowIso(): string {
  return new Date().toISOString();
}

function defaultTitle(summary: string): string {
  const trimmed = summary.trim();
  return trimmed.slice(0, 40) || "未命名场景";
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeRow(row: ParsedOutlineImportRow, chapters: readonly ChapterSummary[]): OutlineBulkImportPreviewRow {
  const chapterByTitle = new Map(chapters.map((chapter) => [normalizeName(chapter.title), chapter]));
  const chapter = row.chapterTitle ? chapterByTitle.get(normalizeName(row.chapterTitle)) : undefined;
  const warnings: string[] = [...row.warnings];
  if (row.chapterTitle && !chapter) {
    warnings.push(`未找到章节：${row.chapterTitle}`);
  }
  return {
    ...row,
    chapterId: chapter?.id ?? null,
    threadNames: uniqueStrings(row.threadNames),
    characters: uniqueStrings(row.characters),
    warnings
  };
}

export class OutlineService {
  constructor(
    private readonly repo: OutlineRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly chapterRepo: ChapterRepository
  ) {}

  getOverview(input: OutlineGetOverviewInput): OutlineOverview {
    this.ensureProject(input.projectId);
    return {
      projectId: input.projectId,
      chapters: this.chapterRepo.listByProject(input.projectId),
      threads: this.repo.listThreads(input.projectId),
      events: this.repo.listEvents({ projectId: input.projectId }),
      chapterNotes: this.repo.listChapterNotes(input.projectId)
    };
  }

  listEvents(input: OutlineListEventsInput): OutlineEventRecord[] {
    this.ensureProject(input.projectId);
    return this.repo.listEvents(input);
  }

  createEvent(input: OutlineCreateEventInput): OutlineEventRecord {
    this.ensureProject(input.projectId);
    this.ensureChapterBelongsToProject(input.projectId, input.chapterId ?? null);
    const now = nowIso();
    const eventOrder = this.repo.listEvents({ projectId: input.projectId }).length + 1;
    return this.repo.createEvent({
      id: createId("outline_event"),
      projectId: input.projectId,
      chapterId: input.chapterId ?? null,
      title: input.title.trim() || defaultTitle(input.summary),
      summary: input.summary.trim(),
      storyDate: input.storyDate ?? null,
      storyTimeLabel: input.storyTimeLabel?.trim() ?? "",
      weekdayLabel: input.weekdayLabel?.trim() ?? "",
      storyTimeOrder: input.storyTimeOrder ?? null,
      daySegment: input.daySegment,
      customDaySegment: input.customDaySegment?.trim() || null,
      location: input.location?.trim() ?? "",
      povCharacter: input.povCharacter?.trim() ?? "",
      characters: uniqueStrings(input.characters ?? []),
      goal: input.goal ?? "",
      conflict: input.conflict ?? "",
      outcome: input.outcome ?? "",
      foreshadowing: input.foreshadowing ?? "",
      notes: input.notes ?? "",
      status: input.status,
      eventOrder,
      importBatchId: null,
      threadIds: input.threadIds ?? [],
      createdAt: now,
      updatedAt: now
    });
  }

  updateEvent(input: OutlineUpdateEventInput): OutlineEventRecord {
    this.ensureProject(input.projectId);
    const current = this.repo.getEvent(input.projectId, input.eventId);
    if (!current) {
      throw new Error("大纲事件不存在。");
    }
    if (input.patch.chapterId !== undefined) {
      this.ensureChapterBelongsToProject(input.projectId, input.patch.chapterId ?? null);
    }
    return this.repo.updateEvent({
      projectId: input.projectId,
      eventId: input.eventId,
      patch: {
        ...input.patch,
        updatedAt: nowIso()
      }
    });
  }

  deleteEvent(input: OutlineDeleteEventInput): { deleted: true } {
    this.ensureProject(input.projectId);
    this.repo.deleteEvent(input.projectId, input.eventId);
    return { deleted: true };
  }

  reorderEvents(input: OutlineReorderEventsInput): { reordered: true } {
    this.ensureProject(input.projectId);
    this.repo.reorderEvents(input.projectId, input.orderedEventIds);
    return { reordered: true };
  }

  listThreads(input: { readonly projectId: string }): OutlineThreadRecord[] {
    this.ensureProject(input.projectId);
    return this.repo.listThreads(input.projectId);
  }

  createThread(input: OutlineCreateThreadInput): OutlineThreadRecord {
    this.ensureProject(input.projectId);
    return this.ensureThread(input.projectId, input.name, input.color);
  }

  updateThread(input: OutlineUpdateThreadInput): OutlineThreadRecord {
    this.ensureProject(input.projectId);
    return this.repo.updateThread({
      projectId: input.projectId,
      threadId: input.threadId,
      name: input.patch.name,
      color: input.patch.color,
      sortOrder: input.patch.sortOrder,
      updatedAt: nowIso()
    });
  }

  deleteThread(input: OutlineDeleteThreadInput): { deleted: true } {
    this.ensureProject(input.projectId);
    this.repo.deleteThread(input.projectId, input.threadId);
    return { deleted: true };
  }

  getChapterNote(input: OutlineGetChapterNoteInput): OutlineChapterNoteRecord | null {
    this.ensureProject(input.projectId);
    this.ensureChapterBelongsToProject(input.projectId, input.chapterId);
    return this.repo.getChapterNote(input.projectId, input.chapterId);
  }

  saveChapterNote(input: OutlineSaveChapterNoteInput): OutlineChapterNoteRecord {
    this.ensureProject(input.projectId);
    this.ensureChapterBelongsToProject(input.projectId, input.chapterId);
    const now = nowIso();
    const existing = this.repo.getChapterNote(input.projectId, input.chapterId);
    return this.repo.saveChapterNote({
      projectId: input.projectId,
      chapterId: input.chapterId,
      content: input.content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }

  importLegacyChapterNote(input: OutlineImportLegacyChapterNoteInput): OutlineChapterNoteRecord {
    const existing = this.getChapterNote(input);
    if (existing && existing.content.trim() && !input.overwrite) {
      throw new Error("已有章节细纲，请确认覆盖后再导入。");
    }
    return this.saveChapterNote(input);
  }

  previewBulkImport(input: OutlinePreviewBulkImportInput): OutlineBulkImportPreview {
    this.ensureProject(input.projectId);
    return this.buildPreview(input.projectId, parseOutlineText(input.rawText));
  }

  previewImportFile(input: OutlinePreviewImportFileInput): OutlineBulkImportPreview {
    this.ensureProject(input.projectId);
    const filePath = assertSelectedOutlineImportFilePathAllowed(input.filePath);
    return this.buildPreview(input.projectId, parseOutlineFile(filePath));
  }

  confirmBulkImport(input: OutlineConfirmBulkImportInput): { importedCount: number; createdThreadCount: number } {
    this.ensureProject(input.projectId);
    return this.repo.runInTransaction(() => {
      const existingThreads = new Map(this.repo.listThreads(input.projectId).map((thread) => [normalizeName(thread.name), thread]));
      const existingEventCount = this.repo.listEvents({ projectId: input.projectId }).length;
      let createdThreadCount = 0;
      const events: OutlineEventCreateData[] = input.rows.map((row, index) => {
        this.ensureChapterBelongsToProject(input.projectId, row.chapterId);
        const threadIds = row.threadNames.map((threadName) => {
          const normalized = normalizeName(threadName);
          const existing = existingThreads.get(normalized);
          if (existing) {
            return existing.id;
          }
          const created = this.ensureThread(input.projectId, threadName);
          existingThreads.set(normalized, created);
          createdThreadCount += 1;
          return created.id;
        });
        const now = nowIso();
        return {
          id: createId("outline_event"),
          projectId: input.projectId,
          chapterId: row.chapterId,
          title: defaultTitle(row.summary),
          summary: row.summary,
          storyDate: row.storyDate ?? null,
          storyTimeLabel: row.storyTimeLabel,
          weekdayLabel: row.weekdayLabel,
          storyTimeOrder: row.storyTimeOrder ?? index + 1,
          daySegment: row.daySegment,
          customDaySegment: row.customDaySegment ?? null,
          location: row.location,
          povCharacter: "",
          characters: row.characters,
          goal: "",
          conflict: "",
          outcome: "",
          foreshadowing: "",
          notes: "",
          status: row.status,
          eventOrder: existingEventCount + index + 1,
          importBatchId: input.importBatchId,
          threadIds,
          createdAt: now,
          updatedAt: now
        };
      });
      this.repo.createEventsBulk(events);
      return { importedCount: events.length, createdThreadCount };
    });
  }

  undoImportBatch(input: OutlineUndoImportBatchInput): { deletedCount: number } {
    this.ensureProject(input.projectId);
    return { deletedCount: this.repo.deleteImportBatch(input.projectId, input.importBatchId) };
  }

  private buildPreview(projectId: string, rows: readonly ParsedOutlineImportRow[]): OutlineBulkImportPreview {
    const chapters = this.chapterRepo.listByProject(projectId);
    const normalizedRows = rows.map((row) => normalizeRow(row, chapters));
    const existingThreadNames = new Set(this.repo.listThreads(projectId).map((thread) => normalizeName(thread.name)));
    const newThreadNames = uniqueStrings(normalizedRows.flatMap((row) => row.threadNames)).filter((threadName) => !existingThreadNames.has(normalizeName(threadName)));
    return {
      importBatchId: createId("outline_import"),
      rows: normalizedRows,
      newThreadNames,
      skippedRows: []
    };
  }

  private ensureThread(projectId: string, name: string, color = "#2f80ed"): OutlineThreadRecord {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("情节线名称不能为空。");
    }
    const existing = this.repo.listThreads(projectId).find((thread) => normalizeName(thread.name) === normalizeName(trimmedName));
    if (existing) {
      return existing;
    }
    const now = nowIso();
    return this.repo.createThread({
      id: createId("outline_thread"),
      projectId,
      name: trimmedName,
      color,
      sortOrder: this.repo.listThreads(projectId).length + 1,
      createdAt: now,
      updatedAt: now
    });
  }

  private ensureProject(projectId: string): void {
    if (!this.projectRepo.findById(projectId)) {
      throw new Error("项目不存在。");
    }
  }

  private ensureChapterBelongsToProject(projectId: string, chapterId: string | null | undefined): void {
    if (!chapterId) {
      return;
    }
    const chapter = this.chapterRepo.getContent(chapterId);
    if (!chapter || chapter.projectId !== projectId) {
      throw new Error("章节不属于当前项目。");
    }
  }
}
